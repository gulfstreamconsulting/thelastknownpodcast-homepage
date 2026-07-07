#!/usr/bin/env node

import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_DOWNLOAD_DIR = "downloads/youtube-video-migration";
const VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"]);

const config = {
  siteUrl: trimTrailingSlash(process.env.SITE_URL || "http://localhost:8787"),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  downloadDir: process.env.DOWNLOAD_DIR || DEFAULT_DOWNLOAD_DIR,
  limit: Number.parseInt(process.env.LIMIT || "", 10),
  episodeId: process.env.EPISODE_ID || "",
  dryRun: process.env.DRY_RUN === "1",
  keepDownloads: process.env.KEEP_DOWNLOADS === "1",
  ytDlpBin: process.env.YT_DLP_BIN || "yt-dlp",
  curlBin: process.env.CURL_BIN || "curl"
};

if (!config.adminPassword && !config.dryRun) {
  fail("Set ADMIN_PASSWORD before uploading. Use DRY_RUN=1 to preview without uploading.");
}

try {
  await main();
} catch (error) {
  fail(error.message);
}

async function main() {
  const startedAt = Date.now();

  console.log("YouTube to R2 video migration");
  console.log(`Site URL: ${config.siteUrl}`);
  console.log(`Download directory: ${config.downloadDir}`);
  console.log(`Mode: ${config.dryRun ? "dry run" : "download and upload"}`);
  if (config.episodeId) console.log(`Episode filter: ${config.episodeId}`);
  if (Number.isFinite(config.limit) && config.limit > 0) console.log(`Limit: ${config.limit}`);

  logStep("Preparing download directory");
  await mkdir(config.downloadDir, { recursive: true });

  logStep("Loading podcast API");
  const episodes = await loadEpisodes();
  console.log(`Loaded ${episodes.length} episode${episodes.length === 1 ? "" : "s"} from API.`);

  const migrationCandidates = episodes
    .filter((episode) => episode.youtubeUrl && !episode.videoAsset)
    .filter((episode) => !config.episodeId || episode.id === config.episodeId)
    .slice(0, Number.isFinite(config.limit) && config.limit > 0 ? config.limit : undefined);

  if (!migrationCandidates.length) {
    console.log("No YouTube-backed episodes need migration.");
    return;
  }

  console.log(
    `Found ${migrationCandidates.length} episode${migrationCandidates.length === 1 ? "" : "s"} to migrate.`
  );

  for (const [index, episode] of migrationCandidates.entries()) {
    const episodeStartedAt = Date.now();

    console.log(`\n[${index + 1}/${migrationCandidates.length}] ${episode.title}`);
    console.log(`Episode ID: ${episode.id}`);
    console.log(`YouTube URL: ${episode.youtubeUrl}`);

    if (config.dryRun) {
      console.log("Dry run: skipping download and upload.");
      continue;
    }

    const downloadedPath = await downloadYouTubeVideo(episode);
    await uploadHostedVideo(episode, downloadedPath);

    if (!config.keepDownloads) {
      logStep("Removing local download");
      await rm(downloadedPath, { force: true });
      console.log("Removed local download.");
    } else {
      console.log(`Keeping local download: ${downloadedPath}`);
    }

    console.log(`Episode complete in ${formatDuration(Date.now() - episodeStartedAt)}.`);
  }

  console.log(`\nDone in ${formatDuration(Date.now() - startedAt)}.`);
}

async function loadEpisodes() {
  let response;

  try {
    response = await fetch(`${config.siteUrl}/api/podcast`, {
      headers: { accept: "application/json" }
    });
  } catch (error) {
    throw new Error(
      `Unable to reach ${config.siteUrl}/api/podcast. Is the site running and reachable? ${error.message}`
    );
  }

  if (!response.ok) {
    fail(`Unable to load podcast API from ${config.siteUrl}: HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.episodes) ? data.episodes : [];
}

async function downloadYouTubeVideo(episode) {
  const outputPrefix = path.join(config.downloadDir, `${safeFilePart(episode.id)}-video`);
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--merge-output-format",
    "mp4",
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/best",
    "-o",
    `${outputPrefix}.%(ext)s`,
    episode.youtubeUrl
  ];

  logStep("Downloading with yt-dlp");
  try {
    await run(config.ytDlpBin, args);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        [
          `Unable to find ${config.ytDlpBin}.`,
          "Install yt-dlp first, for example:",
          "  brew install yt-dlp",
          "or point the script at a custom binary:",
          "  YT_DLP_BIN=/path/to/yt-dlp npm run migrate:youtube-videos"
        ].join("\n")
      );
    }

    throw error;
  }

  const files = await readdir(config.downloadDir, { withFileTypes: true });
  const candidates = files
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(config.downloadDir, entry.name))
    .filter((filePath) => filePath.startsWith(outputPrefix))
    .filter((filePath) => VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

  if (!candidates.length) {
    fail(`yt-dlp completed but no video file was found for episode ${episode.id}.`);
  }

  candidates.sort((left, right) => right.length - left.length);
  const downloadedPath = candidates[0];
  const downloadedStats = await stat(downloadedPath);
  console.log(`Downloaded: ${downloadedPath}`);
  console.log(`Download size: ${formatBytes(downloadedStats.size)}`);
  return downloadedPath;
}

async function uploadHostedVideo(episode, videoPath) {
  const uploadUrl = `${config.siteUrl}/admin/content/media`;
  const mimeType = mimeTypeForPath(videoPath);
  const videoStats = await stat(videoPath);
  const args = [
    "--progress-bar",
    "-S",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "-u",
    `${config.adminUsername}:${config.adminPassword}`,
    "-F",
    `episodeId=${episode.id}`,
    "-F",
    `videoFile=@${videoPath};type=${mimeType}`,
    uploadUrl
  ];

  logStep("Uploading hosted video to admin API");
  console.log(`Upload size: ${formatBytes(videoStats.size)}`);
  console.log(`Upload MIME type: ${mimeType}`);
  const result = await run(config.curlBin, args, { captureStdout: true });
  const statusCode = result.stdout.trim();

  if (!["200", "303"].includes(statusCode)) {
    fail(`Upload failed for episode ${episode.id}: HTTP ${statusCode || "unknown"}`);
  }

  console.log("Uploaded and saved hosted video.");
}

function logStep(message) {
  console.log(`\n- ${message}...`);
}

function formatBytes(bytes) {
  const value = Number(bytes);

  if (!Number.isFinite(value) || value < 1024) {
    return `${Math.max(0, value || 0)} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (!minutes) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.captureStdout ? ["ignore", "pipe", "inherit"] : "inherit"
    });
    let stdout = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout });
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function mimeTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".mp4" || extension === ".m4v") return "video/mp4";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".ogv") return "video/ogg";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mpeg" || extension === ".mpg") return "video/mpeg";

  return "application/octet-stream";
}

function safeFilePart(value) {
  return String(value)
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
