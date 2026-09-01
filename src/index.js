import { podcast } from "./podcast.config.js";
import {
  handleSpreakerCallback,
  handleSpreakerConnect,
  handleSpreakerDashboard,
  handleSpreakerMonetizationUpload
} from "./spreaker-dashboard.js";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const safeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;
const CONTENT_ROUTE_PREFIX = "/episode-content";
const EPISODE_DATA_CACHE_PREFIX = "/__cache/episode-data-v3";
const LANDING_PAGE_VISIT_PREFIX = "analytics/landing-page-visits/";
const LANDING_PAGE_EVENT_PREFIX = "analytics/landing-page-events/";
const LANDING_PAGE_PLAYBACK_PREFIX = "analytics/landing-page-playback/";
const LANDING_PAGE_DIRECTORY_EVENT_PREFIX = "analytics/landing-page-directory/";
const EPISODES_PER_PAGE = 9;
const SPOTIFY_SHOW_REDIRECT_ENDPOINTS = new Set([
  "/redirect",
  "/redirect/",
  "/spotify",
  "/spotify/"
]);
const SPOTIFY_LANDING_PAGE_ENDPOINT = "/landing-page";
const SPOTIFY_LANDING_CLICK_ENDPOINT = `${SPOTIFY_LANDING_PAGE_ENDPOINT}/click`;
const SPOTIFY_LANDING_PLAYBACK_ENDPOINT = `${SPOTIFY_LANDING_PAGE_ENDPOINT}/playback`;
const SPREAKER_PLAYER_PLAY_ENDPOINT = `${SPOTIFY_LANDING_PAGE_ENDPOINT}/spreaker-play`;
const LANDING_PAGE_TRACK_ENDPOINT = `${SPOTIFY_LANDING_PAGE_ENDPOINT}/track`;
const LANDING_PAGE_STATS_ENDPOINT = `${SPOTIFY_LANDING_PAGE_ENDPOINT}/stats`;
const COLD_AUDIENCE_EPISODE_LIMIT = 8;
const IMA_SDK_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
const BOT_USER_AGENT_PATTERN =
  /\b(bot|crawl|crawler|spider|slurp|preview|facebookexternalhit|discordbot|twitterbot|linkedinbot|slackbot|telegrambot|whatsapp|embedly|pinterest|google-inspectiontool|gptbot|chatgpt-user|ccbot|claudebot|perplexitybot|bytespider|yandex|duckduckbot|baiduspider|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|headlesschrome|lighthouse|pagespeed|pingdom|gtmetrix|uptimerobot|curl|wget|python-requests|go-http-client|java|axios|undici)\b/i;

const stripHtml = (value = "") =>
  String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"');

const truncateText = (value = "", maxLength = 180) => {
  const normalized = String(value).replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
};

const normalizeSearchText = (value = "") =>
  String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const parsePodcastDate = (value) => {
  if (!value) {
    return null;
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatPublishedDate = (value) => {
  if (!value) {
    return "Episode";
  }

  const date = parsePodcastDate(value);

  if (!date) {
    return "Episode";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
};

const formatSitemapDate = (value) => {
  if (!value) {
    return null;
  }

  const date = parsePodcastDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
};

const formatStaticPageSitemapDate = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(String(value).replace(/^Last updated:\s*/i, ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const decodeXml = (value = "") =>
  String(value)
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const xmlElement = (xml, name) => {
  const match = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
};

const xmlAttribute = (xml, name, attribute) => {
  const element = String(xml).match(new RegExp(`<${name}\\b[^>]*>`, "i"))?.[0] ?? "";
  const match = element.match(new RegExp(`${attribute}=["']([^"']*)["']`, "i"));
  return match ? decodeXml(match[1]) : "";
};

const slugify = (value) =>
  String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "episode";

const legacyEpisodeId = (title) => {
  const entries = Object.entries(podcast.spotify.legacyEpisodeIds ?? {});
  const match = entries.find(([legacyTitle]) => normalizeSearchText(legacyTitle) === normalizeSearchText(title));
  return match?.[1] ?? null;
};

const spotifyEpisodeIdsFromCreatorsPage = (html) => {
  const idsByTitle = new Map();
  const pattern =
    /"title":"((?:\\.|[^"\\])*)","spotifyUrl":"https:\\u002F\\u002Fopen\.spotify\.com\\u002Fepisode\\u002F([A-Za-z0-9]+)"/g;

  for (const match of String(html).matchAll(pattern)) {
    try {
      const title = JSON.parse(`"${match[1]}"`);
      idsByTitle.set(normalizeSearchText(title), match[2]);
    } catch {
      // Ignore malformed embedded metadata and retain the RSS item URL as a fallback.
    }
  }

  return idsByTitle;
};

const rssEpisodeFallbackId = (itemXml, title) => {
  const enclosureUrl = xmlAttribute(itemXml, "enclosure", "url");
  const playId = enclosureUrl.match(/\/podcast\/play\/(\d+)/)?.[1];

  if (playId) {
    return playId;
  }

  return xmlElement(itemXml, "guid").replace(/[^A-Za-z0-9]/g, "") || slugify(title);
};

const fetchPodcastRssEpisodes = async () => {
  const cacheSeconds = Math.max(30, podcast.spotify.cacheSeconds ?? 60);
  const cacheKey = String(Math.floor(Date.now() / (cacheSeconds * 1000)));
  const rssUrl = new URL(podcast.spotify.rssUrl);
  const creatorsUrl = new URL(podcast.spotify.creatorsUrl);
  rssUrl.searchParams.set("site-cache", cacheKey);
  creatorsUrl.searchParams.set("site-cache", cacheKey);
  const requestOptions = {
    headers: {
      accept: "application/rss+xml,application/xml,text/xml,text/html",
      "user-agent": "The Last Known Podcast Website"
    },
    cf: {
      cacheTtl: cacheSeconds,
      cacheEverything: true
    }
  };
  const [rssResponse, creatorsResponse] = await Promise.all([
    fetch(rssUrl, requestOptions),
    fetch(creatorsUrl, requestOptions).catch(() => null)
  ]);

  if (!rssResponse.ok) {
    throw new Error(`Podcast RSS feed returned ${rssResponse.status}`);
  }

  const [rssXml, creatorsHtml] = await Promise.all([
    rssResponse.text(),
    creatorsResponse?.ok ? creatorsResponse.text() : Promise.resolve("")
  ]);
  const spotifyIdsByTitle = spotifyEpisodeIdsFromCreatorsPage(creatorsHtml);
  const channelImage = xmlAttribute(rssXml, "itunes:image", "href") || podcast.heroImage;
  const itemMatches = rssXml.matchAll(/<item>([\s\S]*?)<\/item>/gi);

  return [...itemMatches]
    .map((match) => {
      const itemXml = match[1];
      const title = xmlElement(itemXml, "title").trim();

      if (!title) {
        return null;
      }

      const descriptionHtml = xmlElement(itemXml, "description");
      const description = stripHtml(descriptionHtml).trim();
      const detail = description || `${title} from ${podcast.name}.`;
      const publishedAt = xmlElement(itemXml, "pubDate");
      const rssItemUrl = xmlElement(itemXml, "link");
      const audioUrl = xmlAttribute(itemXml, "enclosure", "url");
      const audioType = xmlAttribute(itemXml, "enclosure", "type");
      const transcriptUrl = xmlAttribute(itemXml, "podcast:transcript", "url");
      const transcriptType = xmlAttribute(itemXml, "podcast:transcript", "type");
      const spreakerEpisodeId =
        rssItemUrl.match(/--(\d+)(?:[/?#]|$)/)?.[1] ||
        audioUrl.match(/\/episode\/(\d+)(?:[/?#]|$)/)?.[1] ||
        "";
      const spotifyEpisodeId = spotifyIdsByTitle.get(normalizeSearchText(title)) || "";
      const spotifyUrl = spotifyEpisodeId
        ? `https://open.spotify.com/episode/${spotifyEpisodeId}`
        : rssItemUrl;
      const fallbackId = rssEpisodeFallbackId(itemXml, title);

      return {
          id: legacyEpisodeId(title) || spotifyEpisodeId || fallbackId,
          spotifyEpisodeId,
          spreakerEpisodeId,
          slug: slugify(title),
          status: "Episode",
          title,
          summary: truncateText(detail),
          detail,
          publishedAt: formatPublishedDate(publishedAt),
          publishedDate: formatSitemapDate(publishedAt),
          href: spotifyUrl,
          spotifyUrl,
          spotifyEpisodeUrl: spotifyUrl,
          audioUrl,
          audioType,
          transcript: transcriptUrl
            ? { url: transcriptUrl, type: transcriptType || "text/plain" }
            : null,
          image: xmlAttribute(itemXml, "itunes:image", "href") || channelImage,
          mediaTypes: audioUrl ? ["AUDIO"] : [],
          body: description
            .split(/\n+/)
            .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
            .filter(Boolean)
        };
    })
    .filter(Boolean)
    .sort((left, right) => String(right.publishedDate).localeCompare(String(left.publishedDate)));
};

const loadEpisodes = async () => {
  const limit = podcast.spotify.episodeLimit ?? 50;
  const videoOverviewTitleSuffixes = podcast.spotify.videoOverviewTitleSuffixes ?? [];
  const videoOverviewTitlePrefixes = podcast.spotify.videoOverviewTitlePrefixes ?? [];
  const episodes = await fetchPodcastRssEpisodes();
  const matchedSuffix = (title) =>
    videoOverviewTitleSuffixes.find((suffix) =>
      title.toLowerCase().endsWith(String(suffix).toLowerCase())
    );
  const matchedPrefix = (title) =>
    videoOverviewTitlePrefixes.find((prefix) =>
      title.toLowerCase().startsWith(String(prefix).toLowerCase())
    );
  const isVideoOverview = (title) => Boolean(matchedSuffix(title) || matchedPrefix(title));
  const videoOverviewsByTitle = new Map();

  for (const episode of episodes) {
    const suffix = matchedSuffix(episode.title);
    const prefix = matchedPrefix(episode.title);

    if (!suffix && !prefix) continue;

    const audioEpisodeTitle = suffix
      ? episode.title.slice(0, -String(suffix).length).trim()
      : episode.title.slice(String(prefix).length).trim();
    if (episode.spotifyEpisodeUrl) {
      videoOverviewsByTitle.set(normalizeSearchText(audioEpisodeTitle), episode);
    }
  }

  return episodes
    .filter((episode) => !isVideoOverview(episode.title))
    .map((episode) => {
      const videoOverview = videoOverviewsByTitle.get(normalizeSearchText(episode.title));

      return {
        ...episode,
        spotifyVideoOverview: videoOverview
          ? {
              id: videoOverview.id,
              title: videoOverview.title,
              url: videoOverview.spotifyUrl,
              image: videoOverview.image
            }
          : null
      };
    })
    .slice(0, limit);
};

const stripTranscriptCues = (value, type) => {
  if (type === "text/plain") {
    return value;
  }

  return String(value)
    .replace(/^WEBVTT[^\n]*\n/i, "")
    .replace(/^\d+\s*$/gm, "")
    .replace(
      /^\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?[.,]\d{3}.*$/gm,
      ""
    )
    .replace(/<[^>]+>/g, "");
};

const transcriptParagraphs = (value) => {
  const normalized = String(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return [];
  }

  const existingParagraphs = normalized.split(/\n{2,}/).filter(Boolean);

  if (existingParagraphs.length > 1) {
    return existingParagraphs.map((paragraph) => paragraph.replace(/\n/g, " ").trim());
  }

  const sentences = normalized.match(/[^.!?]+[.!?]+(?:["'”’)]*)|[^.!?]+$/g) ?? [normalized];
  const paragraphs = [];
  let paragraph = "";

  for (const sentence of sentences) {
    const next = `${paragraph} ${sentence.trim()}`.trim();

    if (paragraph && next.length > 1200) {
      paragraphs.push(paragraph);
      paragraph = sentence.trim();
    } else {
      paragraph = next;
    }
  }

  if (paragraph) {
    paragraphs.push(paragraph);
  }

  return paragraphs;
};

const loadEpisodeTranscript = async (episode) => {
  if (!episode.transcript?.url) {
    return null;
  }

  const transcriptUrl = new URL(episode.transcript.url);

  if (transcriptUrl.protocol !== "https:") {
    return null;
  }

  const response = await fetch(transcriptUrl, {
    headers: {
      accept: "text/plain,text/vtt,application/x-subrip",
      "user-agent": "The Last Known Podcast Website"
    },
    cf: {
      cacheTtl: podcast.spotify.cacheSeconds,
      cacheEverything: true
    }
  });

  if (!response.ok) {
    console.error(`Podcast transcript returned ${response.status} for episode ${episode.id}`);
    return null;
  }

  const text = stripTranscriptCues(await response.text(), episode.transcript.type);
  const paragraphs = transcriptParagraphs(text);

  return paragraphs.length
    ? {
        sourceUrl: episode.transcript.url,
        paragraphs
      }
    : null;
};

const loadEpisodeCatalog = () => loadEpisodes();

const episodeDataCacheRequest = (request, episodeSlug) => {
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = `${EPISODE_DATA_CACHE_PREFIX}/${encodeURIComponent(episodeSlug)}`;
  cacheUrl.search = "";
  cacheUrl.hash = "";
  return new Request(cacheUrl, { method: "GET" });
};

const loadEpisodePageData = async (request, ctx, episodeSlug) => {
  const cache = caches.default;
  const cacheRequest = episodeDataCacheRequest(request, episodeSlug);
  const cachedResponse = await cache.match(cacheRequest);

  if (cachedResponse) {
    return cachedResponse.json();
  }

  const episodes = await loadEpisodes();
  const listEpisode = episodes.find((episode) => episode.slug === episodeSlug);

  if (!listEpisode) {
    return null;
  }

  const episode = listEpisode;
  episode.transcriptContent = await loadEpisodeTranscript(episode);

  const data = { episode, episodes };
  const response = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": `public, max-age=${podcast.spotify.cacheSeconds}`
    }
  });
  ctx.waitUntil(cache.put(cacheRequest, response));

  return data;
};

const attachmentManifestKey = (episodeId) => `episodes/${episodeId}/manifest.json`;

const emptyEpisodeContent = () => ({
  attachments: [],
  videoUrl: "",
  videoAsset: null,
  mapLocations: [],
  article: {
    title: "",
    excerpt: "",
    body: "",
    updatedAt: ""
  }
});

const normalizeArticle = (article) => ({
  title: String(article?.title ?? "").trim().slice(0, 160),
  excerpt: String(article?.excerpt ?? "").trim().slice(0, 500),
  body: String(article?.body ?? "").trim().slice(0, 80000),
  updatedAt: String(article?.updatedAt ?? "").trim().slice(0, 40)
});

const normalizeVideoAsset = (asset) => {
  if (!asset?.objectKey) {
    return null;
  }

  return {
    id: String(asset.id ?? "video"),
    objectKey: String(asset.objectKey),
    filename: sanitizeFilename(asset.filename || "episode-video.mp4"),
    contentType: String(asset.contentType || "application/octet-stream"),
    size: Number.isFinite(Number(asset.size)) ? Number(asset.size) : 0,
    uploadedAt: String(asset.uploadedAt ?? ""),
    sourceUrl: String(asset.sourceUrl ?? "").slice(0, 2000)
  };
};

const normalizeMapLocation = (location) => {
  const label = fallbackText(location?.label, "Case location").slice(0, 140);
  const address = String(location?.address ?? "").trim().slice(0, 240);
  const note = String(location?.note ?? "").trim().slice(0, 500);
  const latitude = Number.parseFloat(location?.latitude);
  const longitude = Number.parseFloat(location?.longitude);
  const hasCoordinates =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

  if (!label && !address && !hasCoordinates) {
    return null;
  }

  const fallbackId =
    `${label}-${address}-${hasCoordinates ? `${latitude}-${longitude}` : ""}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || crypto.randomUUID();

  return {
    id: String(location?.id ?? fallbackId),
    label,
    address,
    note,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null
  };
};

const normalizeMapLocations = (locations) =>
  (Array.isArray(locations) ? locations : [])
    .map(normalizeMapLocation)
    .filter(Boolean)
    .slice(0, 12);

const geocodeMapLocation = async (location, env) => {
  if (location.latitude !== null || location.longitude !== null || !location.address) {
    return { location, geocoded: false };
  }

  const geocoderUrl = new URL(env.GEOCODER_BASE_URL || "https://nominatim.openstreetmap.org/search");
  geocoderUrl.searchParams.set("format", "jsonv2");
  geocoderUrl.searchParams.set("limit", "1");
  geocoderUrl.searchParams.set("q", location.address);

  if (env.GEOCODER_EMAIL) {
    geocoderUrl.searchParams.set("email", env.GEOCODER_EMAIL);
  }

  try {
    const response = await fetch(geocoderUrl.href, {
      headers: {
        accept: "application/json",
        referer: "https://thelastknownpodcast.com/",
        "user-agent": `${podcast.name} website (${podcast.email})`
      },
      cf: {
        cacheTtl: 60 * 60 * 24 * 30,
        cacheEverything: true
      }
    });

    if (!response.ok) {
      console.error(`Geocoder returned ${response.status} for ${location.address}`);
      return { location, geocoded: false };
    }

    const results = await response.json();
    const result = Array.isArray(results) ? results[0] : null;
    const latitude = Number.parseFloat(result?.lat);
    const longitude = Number.parseFloat(result?.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { location, geocoded: false };
    }

    return {
      location: normalizeMapLocation({
        ...location,
        latitude,
        longitude
      }),
      geocoded: true
    };
  } catch (error) {
    console.error(`Unable to geocode map location: ${location.address}`, error);
    return { location, geocoded: false };
  }
};

const loadEpisodeContent = async (env, episodeId) => {
  if (!env.EPISODE_CONTENT) {
    return emptyEpisodeContent();
  }

  const object = await env.EPISODE_CONTENT.get(attachmentManifestKey(episodeId));

  if (!object) {
    return emptyEpisodeContent();
  }

  try {
    const manifest = await object.json();
    return {
      attachments: Array.isArray(manifest.attachments) ? manifest.attachments : [],
      article: normalizeArticle(manifest.article),
      mapLocations: normalizeMapLocations(manifest.mapLocations),
      videoAsset: normalizeVideoAsset(manifest.videoAsset),
      videoUrl:
        typeof manifest.videoUrl === "string"
          ? manifest.videoUrl
          : typeof manifest.youtubeUrl === "string"
            ? manifest.youtubeUrl
            : ""
    };
  } catch (error) {
    console.error(`Unable to read episode content manifest for episode ${episodeId}`, error);
    return emptyEpisodeContent();
  }
};

const saveEpisodeContent = (env, episodeId, content) =>
  env.EPISODE_CONTENT.put(
    attachmentManifestKey(episodeId),
    JSON.stringify(
      {
        version: 2,
        attachments: content.attachments ?? [],
        article: normalizeArticle(content.article),
        mapLocations: normalizeMapLocations(content.mapLocations),
        videoUrl: content.videoUrl ?? "",
        videoAsset: normalizeVideoAsset(content.videoAsset)
      },
      null,
      2
    ),
    {
      httpMetadata: { contentType: "application/json;charset=UTF-8" }
    }
  );

const loadAttachments = async (env, episodeId) =>
  (await loadEpisodeContent(env, episodeId)).attachments;

const selectVideoUrl = (configuredUrl, spotifyEpisodeUrl) => {
  try {
    const hostname = new URL(configuredUrl).hostname.toLowerCase();

    if (hostname === "creators.spotify.com" || hostname === "podcasters.spotify.com") {
      return spotifyEpisodeUrl || "";
    }
  } catch {
    // Empty and relative values fall through to the normal fallback.
  }

  return configuredUrl || spotifyEpisodeUrl || "";
};

const loadApiEpisodeCatalog = async (env) => {
  const episodes = await loadEpisodes();

  await Promise.all(
    episodes.map(async (episode) => {
      const content = await loadEpisodeContent(env, episode.id);
      episode.attachments = content.attachments;
      episode.article = content.article;
      episode.videoUrl = selectVideoUrl(content.videoUrl, episode.feedVideoUrl);
      episode.videoAsset = content.videoAsset;
      episode.mapLocations = content.mapLocations;
    })
  );

  return episodes;
};

const loadApiEpisodeDetail = async (request, ctx, env, episodeSlug) => {
  const pageData = await loadEpisodePageData(request, ctx, episodeSlug);

  if (!pageData) {
    return null;
  }

  const { episode, episodes } = pageData;
  const content = await loadEpisodeContent(env, episode.id);
  episode.attachments = content.attachments;
  episode.article = content.article;
  episode.videoUrl = selectVideoUrl(content.videoUrl, episode.feedVideoUrl);
  episode.videoAsset = content.videoAsset;
  episode.mapLocations = content.mapLocations;

  return { episode, episodes };
};

const saveAttachments = async (env, episodeId, attachments) => {
  const content = await loadEpisodeContent(env, episodeId);
  return saveEpisodeContent(env, episodeId, { ...content, attachments });
};

const buildAttachment = (episodeId, file, title, description) => {
  const id = crypto.randomUUID();
  const filename = sanitizeFilename(file.name);
  const contentType = file.type || "application/octet-stream";

  return {
    id,
    objectKey: `episodes/${episodeId}/attachments/${id}/${filename}`,
    filename,
    title,
    description,
    contentType,
    type: attachmentType(contentType),
    size: file.size,
    uploadedAt: new Date().toISOString()
  };
};

const videoFilenameFromUrl = (value) => {
  try {
    const url = new URL(value);
    return sanitizeFilename(url.pathname.split("/").filter(Boolean).pop() || "episode-video.mp4");
  } catch {
    return "episode-video.mp4";
  }
};

const videoAssetPath = (episodeId) =>
  `${CONTENT_ROUTE_PREFIX}/${encodeURIComponent(episodeId)}/video`;

const isVideoContentType = (contentType = "") =>
  contentType.toLowerCase().startsWith("video/");

const isLikelyVideoFilename = (filename = "") =>
  /\.(m4v|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(filename);

const videoContentTypeFromFilename = (filename = "") => {
  const normalized = filename.toLowerCase();

  if (normalized.endsWith(".mp4") || normalized.endsWith(".m4v")) return "video/mp4";
  if (normalized.endsWith(".mov")) return "video/quicktime";
  if (normalized.endsWith(".ogv")) return "video/ogg";
  if (normalized.endsWith(".webm")) return "video/webm";
  if (normalized.endsWith(".mpeg") || normalized.endsWith(".mpg")) return "video/mpeg";

  return "";
};

const buildVideoAsset = (episodeId, file, sourceUrl = "") => {
  const id = crypto.randomUUID();
  const filename = sanitizeFilename(file.name || "episode-video.mp4");
  const contentType = file.type || videoContentTypeFromFilename(filename) || "application/octet-stream";

  return {
    id,
    objectKey: `episodes/${episodeId}/video/${id}/${filename}`,
    filename,
    contentType,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    sourceUrl
  };
};

const buildImportedVideoAsset = (episodeId, sourceUrl, contentType, size = 0) => {
  const id = crypto.randomUUID();
  const filename = videoFilenameFromUrl(sourceUrl);

  return {
    id,
    objectKey: `episodes/${episodeId}/video/${id}/${filename}`,
    filename,
    contentType: contentType || videoContentTypeFromFilename(filename) || "application/octet-stream",
    size,
    uploadedAt: new Date().toISOString(),
    sourceUrl
  };
};

const deleteVideoAsset = (env, videoAsset) => {
  const asset = normalizeVideoAsset(videoAsset);
  return asset ? env.EPISODE_CONTENT.delete(asset.objectKey) : Promise.resolve();
};

const parseYouTubeStartSeconds = (value) => {
  const input = String(value ?? "").trim();

  if (!input) {
    return 0;
  }

  if (/^\d+$/.test(input)) {
    return Number(input);
  }

  const match = input.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);

  if (!match) {
    return 0;
  }

  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
};

const parseVideoUrl = (value) => {
  const input = String(value ?? "").trim();

  if (!input) {
    return null;
  }

  let url;

  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = url.pathname.split("/").filter(Boolean);
  let videoId = "";

  if (hostname === "youtu.be") {
    videoId = pathParts[0] ?? "";
  } else if (hostname === "youtube.com" || hostname === "m.youtube.com") {
    if (pathParts[0] === "watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else if (["embed", "shorts", "live"].includes(pathParts[0])) {
      videoId = pathParts[1] ?? "";
    }
  } else if (hostname === "youtube-nocookie.com" && pathParts[0] === "embed") {
    videoId = pathParts[1] ?? "";
  }

  if (!/^[A-Za-z0-9_-]{6,64}$/.test(videoId)) {
    return null;
  }

  const startSeconds =
    parseYouTubeStartSeconds(url.searchParams.get("start")) ||
    parseYouTubeStartSeconds(url.searchParams.get("t"));
  const canonicalUrl = new URL("https://www.youtube.com/watch");
  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  canonicalUrl.searchParams.set("v", videoId);
  embedUrl.searchParams.set("enablejsapi", "1");
  embedUrl.searchParams.set("playsinline", "1");

  if (startSeconds > 0) {
    canonicalUrl.searchParams.set("t", `${startSeconds}s`);
    embedUrl.searchParams.set("start", String(startSeconds));
  }

  return {
    url: canonicalUrl.href,
    videoId,
    embedUrl: embedUrl.href
  };
};

const sanitizeFilename = (value) => {
  const filename = String(value ?? "attachment")
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 140);

  return filename || "attachment";
};

const attachmentPath = (episodeId, attachmentId) =>
  `${CONTENT_ROUTE_PREFIX}/${encodeURIComponent(episodeId)}/${encodeURIComponent(attachmentId)}`;

const attachmentType = (contentType = "") => {
  if (
    ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(
      contentType.toLowerCase()
    )
  ) {
    return "image";
  }

  if (contentType === "application/pdf") {
    return "pdf";
  }

  return "file";
};

const formatFileSize = (bytes) => {
  const value = Number(bytes);

  if (!Number.isFinite(value) || value < 1024) {
    return `${Math.max(0, value || 0)} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const parseBasicAuth = (request) => {
  const authorization = request.headers.get("authorization") ?? "";

  if (!authorization.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");

    if (separator === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
};

const isAdmin = (request, env) => {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return false;
  }

  const credentials = parseBasicAuth(request);

  return (
    credentials?.username === env.ADMIN_USERNAME &&
    credentials?.password === env.ADMIN_PASSWORD
  );
};

const adminUnauthorized = (message = "Authentication required") =>
  new Response(message, {
    status: 401,
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "cache-control": "no-store",
      "www-authenticate": 'Basic realm="Episode content", charset="UTF-8"'
    }
  });

const adminRedirect = (request, params = "") =>
  Response.redirect(new URL(`/admin/content${params}`, request.url), 303);

const sameOriginRequest = (request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

const fallbackText = (value, fallback = "Unknown") => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
};

const isLikelyBotRequest = (request, expectedMethod = "GET") => {
  if (request.method !== expectedMethod) {
    return true;
  }

  const headers = request.headers;
  const userAgent = headers.get("user-agent") ?? "";
  const accept = headers.get("accept") ?? "";
  const botManagement = request.cf?.botManagement;

  if (!userAgent || BOT_USER_AGENT_PATTERN.test(userAgent)) {
    return true;
  }

  if (botManagement?.verifiedBot === true) {
    return true;
  }

  if (Number.isFinite(botManagement?.score) && botManagement.score <= 29) {
    return true;
  }

  return !accept.includes("text/html") && !accept.includes("*/*");
};

const getCountryCode = (request) => {
  const country = String(
    request.cf?.country ?? request.headers.get("cf-ipcountry") ?? "XX"
  ).toUpperCase();

  return /^[A-Z]{2}$/.test(country) ? country : "XX";
};

const sanitizeAnalyticsReferrer = (value) => {
  const input = String(value ?? "").trim().slice(0, 900);

  if (!input) {
    return "";
  }

  try {
    const referrer = new URL(input);

    if (!new Set(["http:", "https:"]).has(referrer.protocol)) {
      return "";
    }

    referrer.username = "";
    referrer.password = "";
    referrer.search = "";
    referrer.hash = "";
    return referrer.href.slice(0, 900);
  } catch {
    return "";
  }
};

const saveLandingPageVisit = async (
  env,
  request,
  episode,
  referrer,
  attributionSource = ""
) => {
  if (!env.EPISODE_CONTENT || isLikelyBotRequest(request, "POST")) {
    return;
  }

  const visitedAt = new Date().toISOString();
  const record = {
    episodeId: String(episode.spotifyEpisodeId || episode.id),
    episodeSlug: String(episode.slug),
    episodeTitle: String(episode.title).slice(0, 300),
    country: getCountryCode(request),
    referrer:
      attributionSource === "facebook_ad"
        ? "facebook_ad"
        : sanitizeAnalyticsReferrer(referrer),
    visitedAt
  };
  const key = `${LANDING_PAGE_VISIT_PREFIX}${visitedAt.slice(0, 10)}/${visitedAt}-${crypto.randomUUID()}.json`;

  await env.EPISODE_CONTENT.put(key, JSON.stringify(record), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: record
  });
};

const saveLandingPageEvent = async (env, request, episodeId, episodeSlug, eventType) => {
  if (!env.EPISODE_CONTENT || isLikelyBotRequest(request, "POST")) {
    return;
  }

  if (
    !/^[A-Za-z0-9]+$/.test(episodeId) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(episodeSlug) ||
    !new Set(["spotify_web_player_start", "spotify_episode_click"]).has(eventType)
  ) {
    return;
  }

  const occurredAt = new Date().toISOString();
  const record = {
    episodeId,
    episodeSlug,
    eventType,
    country: getCountryCode(request),
    occurredAt
  };
  const key = `${LANDING_PAGE_EVENT_PREFIX}${occurredAt.slice(0, 10)}/${occurredAt}-${crypto.randomUUID()}.json`;

  await env.EPISODE_CONTENT.put(key, JSON.stringify(record), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: record
  });
};

const saveLandingPlaybackSnapshot = async (env, request, input) => {
  if (!env.EPISODE_CONTENT || isLikelyBotRequest(request, "POST")) {
    return;
  }

  const episodeId = String(input.episodeId ?? "").trim();
  const episodeSlug = String(input.episodeSlug ?? "").trim();
  const sessionId = String(input.sessionId ?? "").trim();
  const snapshotReason = String(input.snapshotReason ?? "periodic").trim();

  if (
    !/^[A-Za-z0-9]+$/.test(episodeId) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(episodeSlug) ||
    !/^[A-Za-z0-9-]{8,80}$/.test(sessionId) ||
    !new Set([
      "periodic",
      "pause",
      "resume",
      "milestone",
      "completed",
      "pagehide",
      "visibility_hidden"
    ]).has(snapshotReason)
  ) {
    return;
  }

  const boundedNumber = (value, minimum, maximum) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
  };
  const occurredAt = new Date().toISOString();
  const record = {
    episodeId,
    episodeSlug,
    sessionId,
    snapshotReason,
    country: getCountryCode(request),
    highestPercent: boundedNumber(input.highestPercent, 0, 100).toFixed(2),
    activeSeconds: boundedNumber(input.activeSeconds, 0, 86400).toFixed(1),
    pauseCount: String(Math.round(boundedNumber(input.pauseCount, 0, 10000))),
    resumeCount: String(Math.round(boundedNumber(input.resumeCount, 0, 10000))),
    lastPositionMs: String(Math.round(boundedNumber(input.lastPositionMs, 0, 86400000))),
    durationMs: String(Math.round(boundedNumber(input.durationMs, 0, 86400000))),
    milestone25: input.milestone25 ? "1" : "0",
    milestone50: input.milestone50 ? "1" : "0",
    milestone75: input.milestone75 ? "1" : "0",
    milestone90: input.milestone90 ? "1" : "0",
    completed: input.completed ? "1" : "0",
    isPaused: input.isPaused ? "1" : "0",
    isBuffering: input.isBuffering ? "1" : "0",
    occurredAt
  };
  const key = `${LANDING_PAGE_PLAYBACK_PREFIX}${occurredAt.slice(0, 10)}/${occurredAt}-${crypto.randomUUID()}.json`;

  await env.EPISODE_CONTENT.put(key, JSON.stringify(record), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: record
  });
};

const handleSpotifyLandingPlayback = async (request, env, ctx) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" }
    });
  }

  if (!sameOriginRequest(request) || Number(request.headers.get("content-length") ?? 0) > 8192) {
    return new Response("Invalid request", {
      status: 403,
      headers: { "cache-control": "no-store" }
    });
  }

  let input;

  try {
    input = JSON.parse(await request.text());
  } catch {
    return new Response("Invalid playback snapshot", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  const episodeSlug = String(input?.episodeSlug ?? "").trim();
  let matchesLandingPage = false;

  try {
    const requestUrl = new URL(request.url);
    const requestReferrer = new URL(request.headers.get("referer") ?? "");
    matchesLandingPage =
      requestReferrer.origin === requestUrl.origin &&
      spotifyLandingPageSlugFromPath(requestReferrer.pathname) === episodeSlug;
  } catch {
    matchesLandingPage = false;
  }

  if (!matchesLandingPage) {
    return new Response("Invalid landing page", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  ctx.waitUntil(
    saveLandingPlaybackSnapshot(env, request, input).catch((error) => {
      console.error("Unable to save Spotify playback snapshot", error);
    })
  );

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" }
  });
};

const handleSpotifyLandingClick = (request, env, ctx) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        allow: "POST",
        "cache-control": "no-store"
      }
    });
  }

  const url = new URL(request.url);
  const destination = url.searchParams.get("destination");
  const episodeId = String(url.searchParams.get("episode") ?? "").trim();
  const episodeSlug = String(url.searchParams.get("slug") ?? "").trim();

  if (!new Set(["spotify", "app", "browser", "player"]).has(destination)) {
    return new Response("Invalid destination", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  if (episodeId && !/^[a-zA-Z0-9]+$/.test(episodeId)) {
    return new Response("Invalid episode", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  const landingEventType = {
    app: "spotify_episode_click",
    player: "spotify_web_player_start"
  }[destination];
  let matchesLandingPage = false;

  try {
    const requestReferrer = new URL(request.headers.get("referer") ?? "");
    matchesLandingPage =
      requestReferrer.origin === url.origin &&
      spotifyLandingPageSlugFromPath(requestReferrer.pathname) === episodeSlug;
  } catch {
    matchesLandingPage = false;
  }

  if (landingEventType && episodeId && episodeSlug && matchesLandingPage) {
    ctx.waitUntil(
      saveLandingPageEvent(env, request, episodeId, episodeSlug, landingEventType).catch(
        (error) => {
          console.error("Unable to save Spotify landing-page event", error);
        }
      )
    );
  }

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" }
  });
};

const notifySpotifyEpisodeRedirect = async (env, request, episode) => {
  const webhookUrl = env.IFTTT_SPOTIFY_EPISODE_REDIRECT_WEBHOOK_URL;

  if (!webhookUrl) {
    return;
  }

  const episodeId = episode.spotifyEpisodeId || episode.id;
  const spotifyEpisodeUrl =
    episode.spotifyEpisodeUrl || `https://open.spotify.com/episode/${episodeId}`;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      value1: String(episode.title).slice(0, 1000),
      value2: String(request.url).slice(0, 1000),
      value3: spotifyEpisodeUrl.slice(0, 1000)
    })
  });

  if (!response.ok) {
    throw new Error(`IFTTT redirect webhook returned ${response.status}`);
  }
};

const notifySpreakerPlayerPlay = async (env, request, episodeId) => {
  const webhookUrl =
    env.IFTTT_SPREAKER_PLAYER_PLAY_WEBHOOK_URL || env.IFTTT_ACAST_PLAYER_PLAY_WEBHOOK_URL;

  if (!webhookUrl) {
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      value1: "spreaker_player_play",
      value2: String(episodeId || "unknown").slice(0, 1000),
      value3: String(request.headers.get("referer") || request.url).slice(0, 1000)
    })
  });

  if (!response.ok) {
    throw new Error(`IFTTT Spreaker play webhook returned ${response.status}`);
  }
};

const handleSpreakerPlayerPlay = async (request, env, ctx) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" }
    });
  }

  const requestUrl = new URL(request.url);
  let requestReferrer;

  try {
    requestReferrer = new URL(request.headers.get("referer") || "");
  } catch {
    return new Response("Invalid landing page", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  if (
    requestReferrer.origin !== requestUrl.origin ||
    requestReferrer.pathname !== SPOTIFY_LANDING_PAGE_ENDPOINT
  ) {
    return new Response("Invalid landing page", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  let input = {};
  try {
    input = await request.json();
  } catch {
    // The episode ID is optional; still notify IFTTT for a verified player event.
  }

  const episodeId = String(input?.episodeId || "unknown").slice(0, 200);
  ctx.waitUntil(
    notifySpreakerPlayerPlay(env, request, episodeId).catch((error) => {
      console.error("Spreaker player play webhook failed", error);
    })
  );

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" }
  });
};

const landingPageZoneId = (url) => {
  const rawZoneId = url.searchParams.get("zoneid");
  const zoneId = String(rawZoneId ?? "").trim();

  return /^[A-Za-z0-9._:-]{1,100}$/.test(zoneId) ? zoneId : "unattributed";
};

const saveLandingPageDirectoryEvent = async (env, request, input, referrerUrl) => {
  if (!env.EPISODE_CONTENT || isLikelyBotRequest(request, "POST")) return;

  const sessionId = String(input.sessionId ?? "").trim();
  const eventType = String(input.eventType ?? "").trim();
  const episodeId = String(input.episodeId ?? "").trim();
  const percentPlayed = Math.round(Number(input.percentPlayed));

  if (
    !/^[A-Za-z0-9-]{8,80}$/.test(sessionId) ||
    !new Set(["visit", "engaged", "acast_play", "acast_progress", "spreaker_play", "spreaker_progress"]).has(eventType) ||
    (episodeId && !/^[A-Za-z0-9._:-]{1,200}$/.test(episodeId)) ||
    (eventType.endsWith("_progress") &&
      ![10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100].includes(percentPlayed))
  ) {
    return;
  }

  const occurredAt = new Date().toISOString();
  const record = {
    sessionId,
    eventType,
    zoneId: landingPageZoneId(referrerUrl),
    episodeId,
    percentPlayed: eventType.endsWith("_progress") ? String(percentPlayed) : "",
    country: getCountryCode(request),
    occurredAt
  };
  const key = `${LANDING_PAGE_DIRECTORY_EVENT_PREFIX}${occurredAt.slice(0, 10)}/${occurredAt}-${crypto.randomUUID()}.json`;

  await env.EPISODE_CONTENT.put(key, JSON.stringify(record), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: record
  });
};

const handleLandingPageTrack = async (request, env, ctx) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" }
    });
  }

  if (!sameOriginRequest(request) || Number(request.headers.get("content-length") ?? 0) > 4096) {
    return new Response("Invalid request", {
      status: 403,
      headers: { "cache-control": "no-store" }
    });
  }

  let referrerUrl;
  try {
    referrerUrl = new URL(request.headers.get("referer") ?? "");
  } catch {
    return new Response("Invalid landing page", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  if (
    referrerUrl.origin !== new URL(request.url).origin ||
    referrerUrl.pathname !== SPOTIFY_LANDING_PAGE_ENDPOINT
  ) {
    return new Response("Invalid landing page", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return new Response("Invalid event", {
      status: 400,
      headers: { "cache-control": "no-store" }
    });
  }

  ctx.waitUntil(
    saveLandingPageDirectoryEvent(env, request, input ?? {}, referrerUrl).catch((error) => {
      console.error("Unable to save landing-page directory event", error);
    })
  );

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" }
  });
};

const landingStatsDateRange = (url) => {
  const isValidDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(today.getUTCDate() - 29);
  let from = isValidDate(url.searchParams.get("from"))
    ? url.searchParams.get("from")
    : defaultFrom.toISOString().slice(0, 10);
  let to = isValidDate(url.searchParams.get("to"))
    ? url.searchParams.get("to")
    : today.toISOString().slice(0, 10);

  if (from > to) [from, to] = [to, from];
  const earliest = new Date(`${to}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 89);
  if (from < earliest.toISOString().slice(0, 10)) {
    from = earliest.toISOString().slice(0, 10);
  }

  return { from, to };
};

const listLandingPageDirectoryEvents = async (bucket, from, to) => {
  const events = [];
  let cursor;
  let finished = false;

  do {
    const result = await bucket.list({
      prefix: LANDING_PAGE_DIRECTORY_EVENT_PREFIX,
      startAfter: cursor ? undefined : `${LANDING_PAGE_DIRECTORY_EVENT_PREFIX}${from}`,
      cursor,
      include: ["customMetadata"],
      limit: 1000
    });

    for (const object of result.objects) {
      const eventDate = object.key.slice(LANDING_PAGE_DIRECTORY_EVENT_PREFIX.length).split("/")[0];
      if (eventDate > to) {
        finished = true;
        break;
      }
      if (eventDate >= from && object.customMetadata) events.push(object.customMetadata);
    }

    cursor = !finished && result.truncated ? result.cursor : undefined;
  } while (cursor);

  return events;
};

const landingPageStatsSummary = (events) => {
  const sessions = new Map();

  for (const event of events) {
    const sessionId = String(event.sessionId ?? "");
    if (!sessionId) continue;
    const session = sessions.get(sessionId) ?? {
      zoneId: String(event.zoneId || "unattributed"),
      visited: false,
      engaged: false,
      played: false,
      highestPlaybackPercent: 0
    };

    if (event.eventType === "visit") session.visited = true;
    if (event.eventType === "engaged") session.engaged = true;
    if (event.eventType === "acast_play" || event.eventType === "spreaker_play") {
      session.played = true;
      session.engaged = true;
    }
    if (event.eventType === "acast_progress" || event.eventType === "spreaker_progress") {
      session.played = true;
      session.engaged = true;
      session.highestPlaybackPercent = Math.max(
        session.highestPlaybackPercent,
        Math.min(100, Math.max(0, Number(event.percentPlayed) || 0))
      );
    }
    sessions.set(sessionId, session);
  }

  const rows = new Map();
  for (const session of sessions.values()) {
    if (!session.visited) continue;
    const row = rows.get(session.zoneId) ?? {
      zoneId: session.zoneId,
      visits: 0,
      plays: 0,
      engaged: 0,
      playbackPercentTotal: 0
    };
    row.visits += 1;
    if (session.played) {
      row.plays += 1;
      row.playbackPercentTotal += session.highestPlaybackPercent;
    }
    if (session.engaged) row.engaged += 1;
    rows.set(session.zoneId, row);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      bounces: row.visits - row.engaged,
      playbackRate: row.visits ? (row.plays / row.visits) * 100 : 0,
      averagePlaybackPercent: row.plays ? row.playbackPercentTotal / row.plays : 0,
      bounceRate: row.visits ? ((row.visits - row.engaged) / row.visits) * 100 : 0
    }))
    .sort((left, right) => right.visits - left.visits || left.zoneId.localeCompare(right.zoneId));
};

const landingStatsRateFilter = (url, name, fallback) => {
  const value = url.searchParams.get(name);
  if (value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
};

const handleLandingPageStats = async (request, env, url) => {
  if (!isAdmin(request, env)) return adminUnauthorized();
  if (!env.EPISODE_CONTENT) {
    return new Response("EPISODE_CONTENT is not configured", { status: 503 });
  }
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" }
    });
  }

  const { from, to } = landingStatsDateRange(url);
  const minPlaybackRate = landingStatsRateFilter(url, "minPlaybackRate", 0);
  const maxPlaybackRate = landingStatsRateFilter(url, "maxPlaybackRate", 100);
  const minBounceRate = landingStatsRateFilter(url, "minBounceRate", 0);
  const maxBounceRate = landingStatsRateFilter(url, "maxBounceRate", 100);
  const minPlaybackPercent = landingStatsRateFilter(url, "minPlaybackPercent", 0);
  const maxPlaybackPercent = landingStatsRateFilter(url, "maxPlaybackPercent", 100);
  const rows = landingPageStatsSummary(
    await listLandingPageDirectoryEvents(env.EPISODE_CONTENT, from, to)
  ).filter(
    (row) =>
      row.playbackRate >= Math.min(minPlaybackRate, maxPlaybackRate) &&
      row.playbackRate <= Math.max(minPlaybackRate, maxPlaybackRate) &&
      row.averagePlaybackPercent >= Math.min(minPlaybackPercent, maxPlaybackPercent) &&
      row.averagePlaybackPercent <= Math.max(minPlaybackPercent, maxPlaybackPercent) &&
      row.bounceRate >= Math.min(minBounceRate, maxBounceRate) &&
      row.bounceRate <= Math.max(minBounceRate, maxBounceRate)
  );

  if (url.searchParams.get("export") === "zoneids") {
    const zoneIds = rows
      .map((row) => row.zoneId)
      .filter((zoneId) => zoneId !== "unattributed")
      .join("\n");

    return new Response(request.method === "HEAD" ? null : `${zoneIds}${zoneIds ? "\n" : ""}`, {
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        "content-disposition": 'attachment; filename="propellerads-excluded-zoneids.txt"',
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }

  const requestedPageSize = Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10);
  const pageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const requestedPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const currentPage = Math.min(
    pageCount,
    Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1)
  );
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const statsPageHref = (page) => {
    const params = new URLSearchParams(url.searchParams);
    params.delete("export");
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return `?${params.toString()}`;
  };

  const total = rows.reduce(
    (summary, row) => ({
      visits: summary.visits + row.visits,
      plays: summary.plays + row.plays,
      engaged: summary.engaged + row.engaged,
      playbackPercentTotal: summary.playbackPercentTotal + row.playbackPercentTotal
    }),
    { visits: 0, plays: 0, engaged: 0, playbackPercentTotal: 0 }
  );
  const totalPlaybackRate = total.visits ? (total.plays / total.visits) * 100 : 0;
  const totalAveragePlaybackPercent = total.plays
    ? total.playbackPercentTotal / total.plays
    : 0;
  const totalBounces = total.visits - total.engaged;
  const totalBounceRate = total.visits ? (totalBounces / total.visits) * 100 : 0;
  const tableRows = pageRows.length
    ? pageRows
        .map(
          (row) => `<tr>
            <th scope="row">${escapeHtml(row.zoneId === "unattributed" ? "Unattributed" : row.zoneId)}</th>
            <td>${row.visits.toLocaleString("en-US")}</td>
            <td>${row.plays.toLocaleString("en-US")}</td>
            <td>${row.playbackRate.toFixed(1)}%</td>
            <td>${row.averagePlaybackPercent.toFixed(1)}%</td>
            <td>${row.bounces.toLocaleString("en-US")}</td>
            <td>${row.bounceRate.toFixed(1)}%</td>
          </tr>`
        )
        .join("")
    : '<tr><td colspan="7" class="empty">No tracked visits match these filters.</td></tr>';
  const pagination = rows.length
    ? `<nav class="pagination" aria-label="Stats pages">
        ${currentPage > 1 ? `<a href="${escapeHtml(statsPageHref(currentPage - 1))}">Previous</a>` : '<span aria-disabled="true">Previous</span>'}
        <strong>Page ${currentPage.toLocaleString("en-US")} of ${pageCount.toLocaleString("en-US")}</strong>
        ${currentPage < pageCount ? `<a href="${escapeHtml(statsPageHref(currentPage + 1))}">Next</a>` : '<span aria-disabled="true">Next</span>'}
      </nav>`
    : "";
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Landing Page Stats | ${escapeHtml(podcast.name)}</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px 20px 64px; background: #111; color: #fff; }
      main { width: min(100%, 1080px); margin: 0 auto; }
      h1 { margin: 0 0 6px; font-size: clamp(1.8rem, 5vw, 2.6rem); }
      .subtitle, .definition { color: #aaa; line-height: 1.5; }
      form { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin: 28px 0; padding: 18px; border: 1px solid #333; border-radius: 14px; background: #191919; }
      label { display: grid; gap: 6px; color: #bbb; font-size: .8rem; font-weight: 700; text-transform: uppercase; }
      input, select, button { min-height: 44px; border-radius: 8px; font: inherit; }
      input, select { width: 150px; border: 1px solid #555; padding: 8px 10px; background: #111; color: #fff; }
      button { border: 0; padding: 9px 18px; background: #1ed760; color: #000; font-weight: 800; cursor: pointer; }
      .export { background: #fff; }
      .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 24px; }
      .card { padding: 20px; border: 1px solid #333; border-radius: 14px; background: #191919; }
      .card span { display: block; color: #aaa; font-size: .8rem; font-weight: 700; text-transform: uppercase; }
      .card strong { display: block; margin-top: 6px; font-size: 1.8rem; }
      .table-wrap { overflow-x: auto; border: 1px solid #333; border-radius: 14px; }
      .pagination { display: flex; align-items: center; justify-content: center; gap: 18px; margin: 20px 0; }
      .pagination a, .pagination span { padding: 10px 14px; border-radius: 8px; }
      .pagination a { background: #1ed760; color: #000; font-weight: 800; text-decoration: none; }
      .pagination span { color: #666; background: #191919; }
      table { width: 100%; border-collapse: collapse; background: #191919; }
      th, td { padding: 14px 16px; border-bottom: 1px solid #333; text-align: right; white-space: nowrap; }
      th:first-child { text-align: left; }
      thead th { color: #aaa; font-size: .76rem; text-transform: uppercase; }
      tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
      .empty { padding: 32px; color: #aaa; text-align: center; }
      .definition { margin-top: 18px; font-size: .9rem; }
      @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Landing Page Stats</h1>
      <p class="subtitle">Spreaker playback and bounce performance by PropellerAds zone.</p>
      <form method="get">
        <label>From <input type="date" name="from" value="${escapeHtml(from)}"></label>
        <label>To <input type="date" name="to" value="${escapeHtml(to)}"></label>
        <label>Playback min % <input type="number" name="minPlaybackRate" min="0" max="100" step="0.1" value="${minPlaybackRate}"></label>
        <label>Playback max % <input type="number" name="maxPlaybackRate" min="0" max="100" step="0.1" value="${maxPlaybackRate}"></label>
        <label>Played min % <input type="number" name="minPlaybackPercent" min="0" max="100" step="0.1" value="${minPlaybackPercent}"></label>
        <label>Played max % <input type="number" name="maxPlaybackPercent" min="0" max="100" step="0.1" value="${maxPlaybackPercent}"></label>
        <label>Bounce min % <input type="number" name="minBounceRate" min="0" max="100" step="0.1" value="${minBounceRate}"></label>
        <label>Bounce max % <input type="number" name="maxBounceRate" min="0" max="100" step="0.1" value="${maxBounceRate}"></label>
        <label>Rows per page
          <select name="pageSize">
            ${[25, 50, 100].map((size) => `<option value="${size}"${size === pageSize ? " selected" : ""}>${size}</option>`).join("")}
          </select>
        </label>
        <button type="submit">Update</button>
        <button class="export" type="submit" name="export" value="zoneids">Export zone IDs</button>
      </form>
      <section class="cards" aria-label="Summary">
        <div class="card"><span>Visits</span><strong>${total.visits.toLocaleString("en-US")}</strong></div>
        <div class="card"><span>Spreaker playback rate</span><strong>${totalPlaybackRate.toFixed(1)}%</strong></div>
        <div class="card"><span>Average played</span><strong>${totalAveragePlaybackPercent.toFixed(1)}%</strong></div>
        <div class="card"><span>Bounce rate</span><strong>${totalBounceRate.toFixed(1)}%</strong></div>
      </section>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Zone</th><th>Visits</th><th>Spreaker plays</th><th>Playback rate</th><th>Average played</th><th>Bounces</th><th>Bounce rate</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      ${rows.length ? `<p class="definition">Showing ${((currentPage - 1) * pageSize + 1).toLocaleString("en-US")}–${Math.min(currentPage * pageSize, rows.length).toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} matching zones.</p>` : ""}
      ${pagination}
      <p class="definition">Playback rate is the percentage of visits with at least one embedded-player play. Average played is the average highest progress milestone reached among playing sessions, measured every 10% plus 25% and 75%. Historical Acast events and new Spreaker events are combined. A bounce is a visit with no player play, 100-pixel scroll, or 10 seconds of active page time. Filters apply to both the table and export. The export contains one attributed PropellerAds zone ID per line; unattributed traffic is omitted. Date ranges are limited to 90 days.</p>
    </main>
  </body>
</html>`;

  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff"
    }
  });
};

const handleSpotifyLandingPage = (request, episode, analytics = {}, options = {}) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "cache-control": "no-store"
      }
    });
  }

  const episodeId = episode.spotifyEpisodeId || episode.id;
  const spotifyEpisodeUrl =
    episode.spotifyEpisodeUrl || `https://open.spotify.com/episode/${episodeId}`;
  const trackedSpotifyUrl = `${spotifyLandingPagePath(episode)}/spotify`;
  const autoRedirect = options.autoRedirect === true;
  const countryCode = analytics.countryCode || "XX";
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${escapeHtml(episode.title)} | Spotify</title>
    ${renderGoogleAnalytics(podcast.googleAnalyticsId)}
    ${renderFacebookPixel(analytics.facebookPixelId)}
    <style>
      :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #121212; color: #fff; }
      main { width: min(100%, 520px); text-align: center; }
      h1 { margin: 0 0 12px; font-size: clamp(1.75rem, 8vw, 2.5rem); }
      p { color: #b3b3b3; line-height: 1.5; }
      .intro { margin: 0 0 28px; }
      .episode-thumbnail { display: block; width: min(100%, 320px); aspect-ratio: 1; margin: 0 auto 24px; border-radius: 12px; object-fit: cover; }
      .published { margin: 0 0 8px; color: #1ed760; font-size: .78rem; font-weight: 800; text-transform: uppercase; }
      a { display: block; width: 100%; padding: 18px 24px; border-radius: 999px; font-size: 1.125rem; font-weight: 800; text-decoration: none; }
      .app { background: #1ed760; color: #000; }
      a:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <img class="episode-thumbnail" src="${escapeHtml(episode.image)}" alt="${escapeHtml(
        `${episode.title} episode artwork`
      )}">
      <p class="published">${escapeHtml(episode.publishedAt)}</p>
      <h1>${escapeHtml(episode.title)}</h1>
      <p class="intro">${
        autoRedirect
          ? "Opening this episode in Spotify&hellip;"
          : "Open this episode in Spotify."
      }</p>
      <a class="app" data-destination="app" href="${escapeHtml(
        autoRedirect ? spotifyEpisodeUrl : trackedSpotifyUrl
      )}">${autoRedirect ? "Continue to Spotify" : "Listen on Spotify"}</a>
    </main>
    <script>
      (function () {
        const trackedDestinations = new Set();
        const track = (destination) => {
          if (trackedDestinations.has(destination)) return;
          trackedDestinations.add(destination);
          const trackingUrl = "${escapeHtml(SPOTIFY_LANDING_CLICK_ENDPOINT)}?destination=" +
            encodeURIComponent(destination) + "&episode=${escapeHtml(episodeId)}" +
            "&slug=${escapeHtml(encodeURIComponent(episode.slug))}";
          const eventName = "thelastknownpodcast_landing_page_click_${escapeHtml(countryCode)}";
          const parameters = {
            country_code: "${escapeHtml(countryCode)}",
            destination: destination,
            episode_id: "${escapeHtml(episodeId)}",
            episode_title: ${safeJson(episode.title)},
            page_path: window.location.pathname
          };

          if (typeof window.gtag === "function") {
            window.gtag("event", eventName, parameters);
          }

          if (typeof window.fbq === "function") {
            window.fbq("trackCustom", eventName, parameters);
          }

          if (!navigator.sendBeacon || !navigator.sendBeacon(trackingUrl)) {
            fetch(trackingUrl, { method: "POST", keepalive: true }).catch(() => {});
          }
        };

        document.querySelector("[data-destination='app']").addEventListener("click", () => {
          track("app");
        });
      })();
    </script>
    ${
      autoRedirect
        ? `<script>
      window.addEventListener("load", function () {
        window.setTimeout(function () {
          window.location.replace(${safeJson(spotifyEpisodeUrl)});
        }, 2000);
      }, { once: true });
    </script>`
        : ""
    }
    ${renderPageViewNotification(0)}
  </body>
</html>`;

  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff"
    }
  });
};

const handleSpotifyEpisodeLandingPage = async (
  request,
  episodeSlug,
  analytics = {},
  env,
  ctx,
  options = {}
) => {
  try {
    const episodes = await loadEpisodeCatalog();
    const episode = episodes.find((item) => item.slug === episodeSlug);

    if (!episode) {
      return new Response("Episode not found", {
        status: 404,
        headers: { "cache-control": "no-store" }
      });
    }

    if (
      options.autoRedirect === true &&
      request.method === "GET" &&
      !isLikelyBotRequest(request, "GET")
    ) {
      ctx.waitUntil(
        notifySpotifyEpisodeRedirect(env, request, episode).catch((error) => {
          console.error("Spotify episode redirect webhook failed", error);
        })
      );
    }

    return handleSpotifyLandingPage(request, episode, analytics, options);
  } catch (error) {
    return new Response(`Unable to load Spotify episodes: ${error.message}`, {
      status: 502,
      headers: { "cache-control": "no-store" }
    });
  }
};

const selectColdAudienceEpisodes = (episodes) => {
  const selectedEpisodes = [];
  const selectedEpisodeIds = new Set();
  const episodesByTitle = new Map(
    episodes.map((episode) => [normalizeSearchText(episode.title), episode])
  );

  for (const title of podcast.spotify.coldAudienceEpisodeTitles ?? []) {
    const episode = episodesByTitle.get(normalizeSearchText(title));

    if (!episode || selectedEpisodeIds.has(episode.id)) {
      continue;
    }

    selectedEpisodes.push(episode);
    selectedEpisodeIds.add(episode.id);
  }

  for (const episode of episodes) {
    if (selectedEpisodes.length >= COLD_AUDIENCE_EPISODE_LIMIT) {
      break;
    }

    if (!selectedEpisodeIds.has(episode.id)) {
      selectedEpisodes.push(episode);
      selectedEpisodeIds.add(episode.id);
    }
  }

  return selectedEpisodes.slice(0, COLD_AUDIENCE_EPISODE_LIMIT);
};

const handlePublishedEpisodesLandingPage = async (request, analytics = {}, episodeSlug = "") => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "cache-control": "no-store"
      }
    });
  }

  try {
    const episodes = await loadEpisodeCatalog();
    const pageUrl = new URL(request.url);
    const isColdAudience = pageUrl.searchParams.get("audience")?.toLowerCase() === "cold";
    const attributionSource =
      pageUrl.searchParams.get("source") === "facebook_ad" ? "facebook_ad" : "";
    const countryCode = analytics.countryCode || "XX";

    if (!episodes.length) {
      return new Response("No episodes found", { status: 502 });
    }

    const selectedEpisode = episodeSlug
      ? episodes.find((episode) => episode.slug === episodeSlug)
      : null;

    if (episodeSlug && !selectedEpisode) {
      return new Response("Episode not found", {
        status: 404,
        headers: { "cache-control": "no-store" }
      });
    }

    const visibleEpisodes = selectedEpisode
      ? [selectedEpisode]
      : isColdAudience
        ? selectColdAudienceEpisodes(episodes)
        : episodes;
    const viewContentParameters = isColdAudience
      ? safeJson({
          content_name: `${podcast.name} Cold Audience Episodes`,
          content_category: "Podcast Episodes",
          page_variant: "cold_audience",
          featured_episode: visibleEpisodes[0]?.title || "",
          episode_count: visibleEpisodes.length
        })
      : "";

    const episodeSections = visibleEpisodes
      .map(
        (episode, episodeIndex) => {
          const isFeaturedColdEpisode = isColdAudience && episodeIndex === 0;
          const episodeHref = isColdAudience
            ? `${spotifyLandingPagePath(episode)}/spotify${
                attributionSource ? `?source=${encodeURIComponent(attributionSource)}` : ""
              }`
            : spotifyLandingPagePath(episode);
          const spreakerEmbedUrl = episode.spreakerEpisodeId
              ? `https://widget.spreaker.com/player?episode_id=${encodeURIComponent(
                  episode.spreakerEpisodeId
                )}&theme=dark&playlist=false&autoplay=false`
              : "";
          const episodeAction = spreakerEmbedUrl
            ? `<div class="episode-player">
                <button
                  class="episode-play-cta"
                  type="button"
                  data-spreaker-play
                  aria-label="${escapeHtml(`Play ${episode.title}`)}"
                ><span aria-hidden="true">▶</span> Play Episode</button>
                <iframe
                    class="spreaker-player"
                    data-spreaker-player
                    data-episode-id="${escapeHtml(episode.spreakerEpisodeId)}"
                    src="${escapeHtml(spreakerEmbedUrl)}"
                    loading="lazy"
                    allow="autoplay"
                    title="${escapeHtml(`${episode.title} Spreaker player`)}"
                  ></iframe>
              </div>`
            : `<a class="episode-link" href="${escapeHtml(episodeHref)}">${
                isColdAudience ? "Listen on Spotify" : "Open episode"
              }</a>`;

          return `
          <article class="episode">
            <img
              class="episode-thumbnail"
              src="${escapeHtml(episode.image)}"
              alt="${escapeHtml(`${episode.title} episode artwork`)}"
              loading="lazy"
            >
            <p class="published">${escapeHtml(episode.publishedAt)}</p>
            <h2>${escapeHtml(episode.title)}</h2>
            ${isFeaturedColdEpisode ? episodeAction : ""}
            <p class="intro">${escapeHtml(episode.summary)}</p>
            ${isFeaturedColdEpisode ? "" : episodeAction}
          </article>`;
        }
      )
      .join("");
    const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${selectedEpisode
      ? `${escapeHtml(selectedEpisode.title)} | ${escapeHtml(podcast.name)}`
      : `Listen to ${escapeHtml(podcast.name)}`}</title>
    ${renderGoogleAnalytics(podcast.googleAnalyticsId)}
    ${renderFacebookPixel(analytics.facebookPixelId)}
    <style>
      :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body { margin: 0; min-height: 100vh; padding: 48px 24px; background: #121212; color: #fff; }
      main { width: min(100%, 520px); margin: 0 auto; text-align: center; }
      h1 { margin: 0 0 12px; font-size: clamp(1.75rem, 8vw, 2.5rem); }
      .page-intro, .intro { color: #b3b3b3; line-height: 1.5; }
      .page-intro { margin: 0 0 28px; }
      .spreaker-player { display: block; width: 100%; height: 200px; margin: 0; border: 0; }
      .episode-player { width: 100%; }
      .episode-play-cta { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: 64px; margin: 0 0 14px; padding: 18px 24px; border: 0; border-radius: 999px; background: #1ed760; color: #000; font: inherit; font-size: 1.2rem; font-weight: 900; cursor: pointer; box-shadow: 0 8px 24px rgba(30, 215, 96, .22); }
      .episode-play-cta:hover { background: #3be477; transform: translateY(-1px); }
      .episode-play-cta:active { transform: translateY(0); }
      .episode-play-cta[aria-pressed="true"] { background: #fff; }
      .episode-play-cta:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      .episode { padding: 36px 0; border-top: 1px solid #404040; }
      .episode:first-of-type { border-top: 0; }
      .episode-thumbnail { display: block; width: min(100%, 320px); aspect-ratio: 1; margin: 0 auto 24px; border-radius: 12px; object-fit: cover; }
      .published { margin: 0 0 8px; color: #1ed760; font-size: .78rem; font-weight: 800; text-transform: uppercase; }
      h2 { margin: 0 0 12px; font-size: clamp(1.4rem, 6vw, 2rem); }
      .intro { margin: 0 0 28px; }
      a { text-decoration: none; }
      .episode-link { display: block; width: 100%; padding: 18px 24px; border-radius: 999px; background: #1ed760; color: #000; font-size: 1.125rem; font-weight: 800; }
      a:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      body.cold-audience { padding-top: 20px; }
      .cold-audience .page-intro { margin-bottom: 12px; }
      .cold-audience .episode:first-of-type { padding-top: 12px; }
      .cold-audience .episode:first-of-type .episode-thumbnail { display: none; }
      .cold-audience .episode:first-of-type .episode-player { margin-bottom: 18px; }
      .cold-audience .episode:first-of-type .intro { margin-bottom: 0; }
      @media (max-width: 480px) {
        body.cold-audience { padding-right: 16px; padding-left: 16px; }
        .cold-audience h1 { font-size: 1.65rem; }
      }
    </style>
  </head>
  <body${isColdAudience ? ' class="cold-audience"' : ""}>
    <main>
      <h1>${
        isColdAudience ? escapeHtml(podcast.name) : `Listen to ${escapeHtml(podcast.name)}`
      }</h1>
      <p class="page-intro">${
        isColdAudience
          ? "8 gripping true crime episodes to start with."
          : "Choose an episode and press play."
      }</p>
      ${episodeSections}
    </main>
    <script src="https://cdn.embed.ly/player-0.1.0.min.js"></script>
    <script>
      (function () {
        const players = Array.from(document.querySelectorAll("[data-spreaker-player]"));
        const milestones = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
        const statesByWindow = new Map();
        const viewContentParameters = ${viewContentParameters || "null"};
        const landingSessionId = typeof window.crypto.randomUUID === "function"
          ? window.crypto.randomUUID()
          : "session-" + Array.from(window.crypto.getRandomValues(new Uint32Array(4)), (value) =>
              value.toString(36)
            ).join("-");
        const trackedLandingEvents = new Set();
        let hasTrackedViewContent = false;
        let activeSeconds = 0;

        const trackLandingEvent = (eventType, episodeId, percentPlayed) => {
          const eventKey = eventType.startsWith("spreaker_")
            ? [eventType, String(episodeId || ""), String(percentPlayed || "")].join(":")
            : eventType;
          if (trackedLandingEvents.has(eventKey)) return;
          trackedLandingEvents.add(eventKey);
          fetch("${escapeHtml(LANDING_PAGE_TRACK_ENDPOINT)}", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionId: landingSessionId,
              eventType: eventType,
              episodeId: episodeId || "",
              percentPlayed: percentPlayed || 0
            }),
            keepalive: true
          }).catch(() => {});
        };

        const trackLandingEngagement = () => trackLandingEvent("engaged");
        trackLandingEvent("visit");

        const trackViewContent = (engagementSource) => {
          if (
            hasTrackedViewContent ||
            !viewContentParameters ||
            (typeof window.gtag !== "function" && typeof window.fbq !== "function")
          ) return;

          hasTrackedViewContent = true;
          window.removeEventListener("scroll", handleEngagedScroll);
          const parameters = {
            ...viewContentParameters,
            engagement_source: engagementSource
          };

          if (typeof window.gtag === "function") {
            window.gtag("event", "ViewContent", parameters);
          }

          if (typeof window.fbq === "function") {
            window.fbq("track", "ViewContent", parameters);
          }
        };

        const handleEngagedScroll = () => {
          if (window.scrollY >= 100) {
            trackLandingEngagement();
            trackViewContent("scroll");
          }
        };

        window.addEventListener("scroll", handleEngagedScroll, { passive: true });
        const engagementTimer = window.setInterval(() => {
          if (document.visibilityState !== "visible") return;
          activeSeconds += 1;
          if (activeSeconds >= 10) {
            trackLandingEngagement();
            window.clearInterval(engagementTimer);
          }
        }, 1000);

        const playerEventParameters = (state, action, percent) => {
          const parameters = {
            player: "spreaker",
            player_action: action,
            episode_id: state.episodeId,
            country_code: "${escapeHtml(countryCode)}",
            page_path: window.location.pathname
          };

          if (typeof percent === "number") parameters.percent_listened = percent;
          return parameters;
        };

        const trackPlayerEvent = (state, action, percent) => {
          const baseEventName = typeof percent === "number"
            ? "spreaker_player_" + percent + "_percent"
            : "spreaker_player_" + action;
          const eventName = baseEventName + "_${escapeHtml(countryCode)}";
          const parameters = playerEventParameters(state, action, percent);

          if (typeof window.gtag === "function") {
            window.gtag("event", eventName, parameters);
          }

          if (typeof window.fbq === "function") {
            window.fbq("trackCustom", eventName, parameters);
          }

          if (action === "play") {
            trackLandingEvent("spreaker_play", state.episodeId);
            fetch("${escapeHtml(SPREAKER_PLAYER_PLAY_ENDPOINT)}", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ episodeId: state.episodeId }),
              keepalive: true
            }).catch(() => {});
          }
          if (action === "progress" && typeof percent === "number") {
            trackLandingEvent("spreaker_progress", state.episodeId, percent);
          }
        };

        const checkMilestones = (state, progressPercent) => {
          if (!Number.isFinite(progressPercent) || progressPercent < 0) return;
          const percentComplete = Math.min(100, progressPercent);

          milestones.forEach((milestone) => {
            if (percentComplete >= milestone && !state.reached.has(milestone)) {
              state.reached.add(milestone);
              trackPlayerEvent(state, "progress", milestone);
            }
          });
        };

        const startProgressChecks = (state) => {
          if (state.progressTimer) return;
          const updateProgress = () => {
            state.api.getDuration((duration) => {
              const numericDuration = Number(duration);
              if (Number.isFinite(numericDuration) && numericDuration > 0) {
                state.duration = numericDuration;
              }
            });
            state.api.getCurrentTime((position) => {
              const numericPosition = Number(position);
              if (state.duration > 0 && Number.isFinite(numericPosition)) {
                checkMilestones(state, (numericPosition / state.duration) * 100);
              }
            });
          };
          updateProgress();
          state.progressTimer = window.setInterval(() => {
            updateProgress();
          }, 1000);
        };

        const stopProgressChecks = (state) => {
          if (!state.progressTimer) return;
          window.clearInterval(state.progressTimer);
          state.progressTimer = null;
        };

        players.forEach((player) => {
          if (!player.contentWindow || !window.playerjs?.Player) return;
          const state = {
            player: player,
            api: new window.playerjs.Player(player),
            playButton: player.closest(".episode")?.querySelector("[data-spreaker-play]") || null,
            episodeId: player.dataset.episodeId || "unknown",
            duration: 0,
            isPlaying: false,
            progressTimer: null,
            reached: new Set()
          };
          statesByWindow.set(player.contentWindow, state);

          state.playButton?.addEventListener("click", () => {
            statesByWindow.forEach((otherState) => {
              if (otherState !== state && otherState.isPlaying) otherState.api.pause();
            });
            state.api.play();
          });

          state.api.on("ready", () => {
            state.api.on("play", () => {
              trackViewContent("spreaker_play");
              if (!state.isPlaying) trackPlayerEvent(state, "play");
              state.isPlaying = true;
              if (state.playButton) {
                state.playButton.setAttribute("aria-pressed", "true");
                state.playButton.innerHTML = '<span aria-hidden="true">▶</span> Playing';
              }
              startProgressChecks(state);
            });
            state.api.on("pause", () => {
              if (state.isPlaying) trackPlayerEvent(state, "pause");
              state.isPlaying = false;
              if (state.playButton) {
                state.playButton.setAttribute("aria-pressed", "false");
                state.playButton.innerHTML = '<span aria-hidden="true">▶</span> Play Episode';
              }
              stopProgressChecks(state);
            });
            state.api.on("ended", () => {
              checkMilestones(state, 100);
              trackPlayerEvent(state, "ended");
              state.isPlaying = false;
              stopProgressChecks(state);
            });
          });
        });

        window.addEventListener(
          "pagehide",
          () => {
            window.removeEventListener("scroll", handleEngagedScroll);
            window.clearInterval(engagementTimer);
            statesByWindow.forEach((state) => stopProgressChecks(state));
          },
          { once: true }
        );
      })();
    </script>
    ${renderPageViewNotification()}
  </body>
</html>`;

    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return new Response(`Unable to load Spotify episodes: ${error.message}`, {
      status: 502,
      headers: { "cache-control": "no-store" }
    });
  }
};

const renderEpisodeImage = (episode, className = "episode-art") => `
  <img
    class="${escapeHtml(className)}"
    src="${escapeHtml(episode.image)}"
    alt="${escapeHtml(`${episode.title} episode artwork`)}"
    loading="lazy"
  >`;

const episodePath = (episode) => `/episodes/${episode.slug}`;
const spotifyLandingPagePath = (episode) =>
  `${SPOTIFY_LANDING_PAGE_ENDPOINT}/${encodeURIComponent(episode.slug)}`;
const episodeAnchor = (episode) => `episode-${episode.slug}`;

const spotifyLandingPageSlugFromPath = (pathname) => {
  const match = pathname.match(/^\/landing-page\/([^/]+)(?:\/spotify)?\/?$/);

  if (!match || match[1] === "click") {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

const episodeSlugFromPath = (pathname) => {
  const match = pathname.match(/^\/episodes\/([^/]+)\/?$/);

  return match?.[1] ?? null;
};

const absoluteUrl = (value, origin) => {
  if (!value) {
    return null;
  }

  return new URL(value, origin).href;
};

const parsePositiveInteger = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const serializeAttachment = (attachment, episode, origin) => ({
  id: attachment.id,
  type: attachment.type,
  title: attachment.title,
  description: attachment.description || null,
  filename: attachment.filename,
  mimeType: attachment.contentType || null,
  sizeBytes: attachment.size ?? null,
  url: absoluteUrl(attachmentPath(episode.id, attachment.id), origin)
});

const serializeMapLocation = (location) => ({
  ...location,
  mapUrl: mapSearchUrl(location),
  embedUrl: mapEmbedUrl(location) || null
});

const serializeVideo = (episode) => {
  if (episode.spotifyVideoOverview) {
    return {
      provider: "spotify",
      id: episode.spotifyVideoOverview.id,
      title: episode.spotifyVideoOverview.title,
      url: episode.spotifyVideoOverview.url,
      posterUrl: episode.spotifyVideoOverview.image
    };
  }

  if (episode.videoUrl) {
    return {
      provider: "spotify",
      url: episode.videoUrl,
      embedUrl: episode.videoUrl,
      posterUrl: absoluteUrl(episode.image, origin)
    };
  }

  return null;
};

const serializeEpisode = (episode, origin) => ({
  id: episode.id,
  slug: episode.slug,
  title: episode.title,
  summary: episode.summary,
  description: (episode.body ?? []).join("\n\n"),
  publishedAt: episode.publishedDate,
  publishedAtDisplay: episode.publishedAt,
  detailPageUrl: absoluteUrl(episodePath(episode), origin),
  spotifyLandingPageUrl: absoluteUrl(spotifyLandingPagePath(episode), origin),
  spotifyUrl: episode.spotifyUrl,
  audioUrl: episode.audioUrl,
  artworkUrl: absoluteUrl(episode.image, origin),
  player: {
    provider: "spotify",
    episodeId: episode.spotifyEpisodeId,
    embedUrl: `https://open.spotify.com/embed/episode/${episode.spotifyEpisodeId}`,
    audioUrl: episode.audioUrl,
    externalUrl: episode.spotifyUrl
  },
  transcript: episode.transcript
    ? {
        url: episode.transcript.url,
        mimeType: episode.transcript.type,
        paragraphs: episode.transcriptContent?.paragraphs ?? null,
        sourceUrl: episode.transcriptContent?.sourceUrl ?? episode.transcript.url
      }
    : null,
  article: normalizeArticle(episode.article),
  videoUrl: episode.spotifyVideoOverview?.url ?? null,
  youtubeUrl: null,
  videoAsset: null,
  video: serializeVideo(episode),
  mapLocations: normalizeMapLocations(episode.mapLocations).map(serializeMapLocation),
  attachments: (episode.attachments ?? []).map((attachment) =>
    serializeAttachment(attachment, episode, origin)
  )
});

const serializeCategory = (category, origin) => ({
  id: category.slug,
  slug: category.slug,
  label: category.label,
  description: category.description,
  episodeCount: category.episodes.length,
  url: absoluteUrl(`/?category=${encodeURIComponent(category.slug)}#cases`, origin)
});

const serializePagination = (
  totalItems,
  currentPage,
  perPage,
  selectedCategory,
  origin
) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const normalizedPage = Math.min(Math.max(1, currentPage), totalPages);
  const pageStart = (normalizedPage - 1) * perPage;
  const itemStart = totalItems ? pageStart + 1 : 0;
  const itemEnd = Math.min(pageStart + perPage, totalItems);
  const pageUrl = (page) => absoluteUrl(homepageCasesHref(selectedCategory, page), origin);

  return {
    page: normalizedPage,
    perPage,
    totalPages,
    totalItems,
    itemStart,
    itemEnd,
    previousPageUrl: normalizedPage > 1 ? pageUrl(normalizedPage - 1) : null,
    nextPageUrl: normalizedPage < totalPages ? pageUrl(normalizedPage + 1) : null
  };
};

const episodeSectionAvailability = (episode, relatedEpisodes = []) => {
  const article = normalizeArticle(episode.article);
  return {
    video: Boolean(episode.spotifyVideoOverview),
    locations: normalizeMapLocations(episode.mapLocations).length > 0,
    materials: (episode.attachments ?? []).length > 0,
    companionArticle: Boolean(article.body),
    transcript: (episode.transcriptContent?.paragraphs ?? []).length > 0,
    relatedEpisodes: relatedEpisodes.length > 0
  };
};

const serializeEpisodeJumpNav = (episode, relatedEpisodes, origin) => {
  const available = episodeSectionAvailability(episode, relatedEpisodes);
  const sections = [
    available.video ? { id: "video", label: "Video" } : null,
    available.locations ? { id: "locations", label: "Locations" } : null,
    available.materials ? { id: "materials", label: "Materials" } : null,
    available.companionArticle ? { id: "companion-article", label: "Companion article" } : null,
    available.transcript ? { id: "transcript", label: "Transcript" } : null,
    available.relatedEpisodes ? { id: "related-episodes", label: "Related episodes" } : null
  ].filter(Boolean);

  return sections.map((section) => ({
    ...section,
    anchor: `#${section.id}`,
    url: absoluteUrl(`${episodePath(episode)}#${section.id}`, origin)
  }));
};

const API_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "content-type": "application/json;charset=UTF-8",
  "x-content-type-options": "nosniff"
};

const jsonResponse = (
  data,
  status = 200,
  cacheControl = "no-store",
  headRequest = false
) =>
  new Response(headRequest ? null : JSON.stringify(data), {
    status,
    headers: {
      ...API_HEADERS,
      "cache-control": cacheControl
    }
  });

const renderPodcastApi = (episodes, origin) => ({
  apiVersion: "1.2",
  podcast: {
    name: podcast.name,
    tagline: podcast.tagline,
    description: podcast.description,
    host: podcast.host,
    email: podcast.email,
    heroImageUrl: absoluteUrl(podcast.heroImage, origin),
    websiteUrl: origin,
    links: podcast.links
      .filter((link) => link.href && link.href !== "#")
      .map((link) => ({
        label: link.label,
        url: absoluteUrl(link.href, origin)
      }))
  },
  episodes: episodes.map((episode) => serializeEpisode(episode, origin)),
  screens: {
    home: renderHomeApi(episodes, origin)
  },
  meta: {
    episodeCount: episodes.length,
    generatedAt: new Date().toISOString()
  }
});

const renderHomeApi = (
  episodes,
  origin,
  { selectedCategory = null, requestedPage = 1 } = {}
) => {
  const featuredEpisode = episodes[0] ?? null;
  const categories = buildEpisodeCategories(episodes);
  const activeCategory = categories.find((category) => category.slug === selectedCategory);
  const visibleEpisodes = activeCategory?.episodes ?? episodes;
  const pagination = serializePagination(
    visibleEpisodes.length,
    requestedPage,
    EPISODES_PER_PAGE,
    activeCategory?.slug ?? null,
    origin
  );
  const pageStart = (pagination.page - 1) * pagination.perPage;
  const paginatedEpisodes = visibleEpisodes.slice(pageStart, pageStart + pagination.perPage);

  return {
    id: "home",
    title: activeCategory ? `${activeCategory.label} Episodes` : podcast.name,
    description: activeCategory?.description ?? podcast.description,
    hero: {
      eyebrow: "True crime podcast",
      title: podcast.name,
      subtitle: podcast.tagline,
      imageUrl: absoluteUrl(podcast.heroImage, origin),
      actions: [
        {
          id: "listen",
          label: "Listen now",
          type: "anchor",
          url: absoluteUrl("/#listen", origin)
        },
        featuredEpisode
          ? {
              id: "episode-details",
              label: "Episode details",
              type: "episode",
              url: absoluteUrl(episodePath(featuredEpisode), origin),
              episodeId: featuredEpisode.id,
              episodeSlug: featuredEpisode.slug
            }
          : null,
        {
          id: "support",
          label: "Support the show",
          type: "external",
          url: DIRECT_SUPPORT_URL
        }
      ].filter(Boolean)
    },
    featuredEpisode: featuredEpisode ? serializeEpisode(featuredEpisode, origin) : null,
    categories: [
      {
        id: "all",
        slug: null,
        label: "All episodes",
        description: "Browse every case in the podcast archive.",
        episodeCount: episodes.length,
        url: absoluteUrl("/#cases", origin),
        selected: !activeCategory
      },
      ...categories.map((category) => ({
        ...serializeCategory(category, origin),
        selected: activeCategory?.slug === category.slug
      }))
    ],
    archive: {
      id: "cases",
      title: activeCategory
        ? activeCategory.label
        : "Built around timelines, records, and what can be verified.",
      selectedCategory: activeCategory ? serializeCategory(activeCategory, origin) : null,
      episodes: paginatedEpisodes.map((episode) => serializeEpisode(episode, origin)),
      pagination
    },
    sections: [
      { id: "listen", type: "featuredEpisode", title: "Latest episode" },
      { id: "categories", type: "categoryBrowser", title: "Explore by topic" },
      { id: "cases", type: "episodeArchive", title: "Case files" }
    ]
  };
};

const renderEpisodeDetailApi = (episode, episodes, origin) => {
  const relatedEpisodes = selectRelatedEpisodes(episode, episodes);
  const article = normalizeArticle(episode.article);
  const serializedEpisode = serializeEpisode(episode, origin);

  return {
    id: "episode-detail",
    title: episode.title,
    description: episode.summary,
    episode: serializedEpisode,
    breadcrumbs: [
      { label: "Home", url: absoluteUrl("/", origin) },
      { label: "Episodes", url: absoluteUrl("/#cases", origin) },
      { label: episode.title, url: absoluteUrl(episodePath(episode), origin) }
    ],
    hero: {
      eyebrow: episode.status,
      title: episode.title,
      publishedAtDisplay: episode.publishedAt ?? "Episode",
      lede: episode.detail ?? episode.summary,
      artworkUrl: serializedEpisode.artworkUrl,
      actions: [
        {
          id: "listen-spotify",
          label: "Listen on Spotify",
          type: "external",
          url: episode.spotifyUrl
        },
        {
          id: "support",
          label: "Support the show",
          type: "external",
          url: DIRECT_SUPPORT_URL
        },
        (episode.transcriptContent?.paragraphs ?? []).length
          ? {
              id: "read-transcript",
              label: "Read episode transcript",
              type: "section",
              anchor: "#transcript"
            }
          : null
      ].filter(Boolean),
      player: serializedEpisode.player
    },
    navigation: serializeEpisodeJumpNav(episode, relatedEpisodes, origin),
    sections: {
      video: serializedEpisode.video
        ? {
            id: "video",
            title: "Video overview",
            media: serializedEpisode.video
          }
        : null,
      locations: serializedEpisode.mapLocations.length
        ? {
            id: "locations",
            title: "Case locations",
            locations: serializedEpisode.mapLocations
          }
        : null,
      materials: serializedEpisode.attachments.length
        ? {
            id: "materials",
            title: "Episode materials",
            attachments: serializedEpisode.attachments
          }
        : null,
      companionArticle: article.body
        ? {
            id: "companion-article",
            title: article.title || `${episode.title} companion article`,
            excerpt: article.excerpt || null,
            bodyMarkdown: article.body,
            updatedAt: article.updatedAt || null
          }
        : null,
      transcript: (episode.transcriptContent?.paragraphs ?? []).length
        ? {
            id: "transcript",
            title: `${episode.title} transcript`,
            intro: "Episode transcript.",
            sourceUrl: episode.transcriptContent.sourceUrl,
            paragraphs: episode.transcriptContent.paragraphs
          }
        : null,
      relatedEpisodes: relatedEpisodes.length
        ? {
            id: "related-episodes",
            title: `More episodes from ${podcast.name}`,
            episodes: relatedEpisodes.map((relatedEpisode) =>
              serializeEpisode(relatedEpisode, origin)
            )
          }
        : null
    }
  };
};

const STATIC_PAGES = [
  {
    slug: "about-us",
    title: "About Us",
    description: `${podcast.name} is a true crime podcast focused on final confirmed moments, unresolved timelines, and the details that keep a case alive.`,
    kicker: "About",
    heading: `About ${podcast.name}`,
    body: [
      `${podcast.name} is operated by Gulfstream Software Consulting LLC.`,
      `${podcast.name} traces true crime stories through the last confirmed moments: the final call, the last sighting, the route home, the missed check-in, and the unresolved questions that remain after the public attention moves on.`,
      "Each episode is built to be measured and evidence-led. We focus on documented timelines, available reporting, law enforcement updates, family statements, and the context listeners need to understand what is known, what is disputed, and what is still missing.",
      `The podcast is hosted by ${podcast.host}. Our goal is to keep cases accessible, searchable, and grounded in care for the people at the center of each story.`
    ]
  },
  {
    slug: "contact-us",
    title: "Contact Us",
    description: `Contact ${podcast.name} with episode feedback, case suggestions, corrections, or media inquiries.`,
    kicker: "Contact",
    heading: "Contact Us",
    body: [
      `${podcast.name} is operated by Gulfstream Software Consulting LLC.`,
      "Send episode feedback, case suggestions, corrections, source material, or media inquiries to the address below.",
      `Email: ${podcast.email}`,
      "Please include as much context as you can, including names, dates, locations, links to public sources, and whether you are sharing a correction, a suggestion, or a personal connection to a case."
    ],
    cta: {
      label: "Email the podcast",
      href: `mailto:${podcast.email}`
    }
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    description: `Privacy policy for ${podcast.name}.`,
    kicker: "Privacy",
    heading: "Privacy Policy",
    body: [
      `${podcast.name} keeps personal data collection limited. You can browse the website without creating an account or submitting personal information.`,
      "When you contact us by email, we receive the information you choose to send, such as your name, email address, message, attachments, and any case details you include. We use that information to read, respond to, evaluate, and follow up on your message.",
      "The site may use basic analytics, hosting logs, embedded podcast players, advertising scripts, and platform services that process technical information such as pages viewed, device and browser details, IP-derived location, referral pages, and playback interactions. These services help operate the site, understand audience interest, measure media playback, prevent abuse, and support the podcast.",
      "Third-party vendors, including Google, may use cookies to serve ads based on a user's prior visits to this website or other websites. Google's use of advertising cookies enables Google and its partners to serve ads based on visits to this site and other sites on the Internet.",
      "Users may opt out of personalized advertising by visiting Google Ads Settings at https://www.google.com/settings/ads. Users may also visit https://www.aboutads.info to opt out of some third-party vendors' use of cookies for personalized advertising.",
      "If third-party ad vendors or ad networks serve ads on this site, those vendors may use cookies or similar technologies under their own privacy policies. Visitors can review those vendors' websites for more information about their data practices and available opt-out choices.",
      "We do not sell personal information that you send directly to us. We may share information when needed to operate the site, comply with law, protect rights and safety, or work with service providers that support hosting, analytics, email, advertising, and podcast distribution.",
      "To ask a privacy question or request that we delete a message you sent us, contact us at the email address listed on this site."
    ],
    updated: "Last updated: August 26, 2026"
  },
  {
    slug: "editorial-policy",
    title: "Editorial Policy",
    description: `${podcast.name} editorial standards, sourcing approach, and corrections process.`,
    kicker: "Standards",
    heading: "Editorial Policy",
    body: [
      `${podcast.name} covers true crime cases with a measured, evidence-led approach. We aim to distinguish verified facts from allegations, theories, and open questions.`,
      "Episodes and written page summaries are built from public reporting, available records, official statements, family or advocate statements, and other sources that can be reviewed or attributed. We avoid presenting speculation as fact.",
      "We try to use restrained language, avoid graphic detail unless it is necessary to understand the case, and keep attention on the people affected rather than sensationalizing violence or loss.",
      "When a case involves an ongoing investigation, charges, or court proceedings, we aim to describe allegations carefully and respect the presumption of innocence unless there has been a legal finding.",
      `Corrections, clarifications, source suggestions, and rights-holder concerns can be sent to ${podcast.email}. Please include the episode or page title, the detail at issue, supporting source links, and the correction or clarification you are requesting.`,
      "When we confirm a material error, we will update the relevant page or future coverage as appropriate. Smaller wording clarifications may be made without a separate notice."
    ]
  }
];

const staticPageByPath = (pathname) =>
  STATIC_PAGES.find((page) => pathname === `/${page.slug}` || pathname === `/${page.slug}/`) ??
  null;

const searchEpisodes = (episodes, query) => {
  const normalizedQuery = normalizeSearchText(query);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return [];
  }

  return episodes
    .map((episode, index) => {
      const title = normalizeSearchText(episode.title);
      const content = normalizeSearchText(
        `${episode.title} ${episode.summary} ${(episode.body ?? []).join(" ")}`
      );

      if (!terms.every((term) => content.includes(term))) {
        return null;
      }

      const exactTitle = title === normalizedQuery ? 100 : 0;
      const titlePhrase = title.includes(normalizedQuery) ? 50 : 0;
      const titleTerms = terms.filter((term) => title.includes(term)).length * 10;

      return { episode, score: exactTitle + titlePhrase + titleTerms - index / 1000 };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .map(({ episode }) => episode);
};

const CATEGORY_DEFINITIONS = [
  {
    slug: "missing-persons",
    label: "Missing Persons",
    description: "Disappearances, last sightings, and unresolved searches.",
    titleTerms: [
      "missing",
      "vanished",
      "last seen",
      "never left",
      "gone from"
    ],
    contentTerms: [
      "disappearance",
      "disappeared",
      "vanished",
      "remains missing",
      "remain missing",
      "has never been found",
      "have never been found",
      "disappeared without",
      "vanished without",
      "unexplained disappearance",
      "whereabouts"
    ]
  },
  {
    slug: "children-and-teens",
    label: "Children & Teens",
    description: "Cases involving children, teenagers, schools, and young victims.",
    titleTerms: ["child", "children", "girl", "boy", "school", "abby", "libby"],
    contentTerms: [
      "9 year old",
      "8 year old",
      "7 year old",
      "6 year old",
      "5 year old",
      "elementary school",
      "two teenagers",
      "young victims"
    ]
  },
  {
    slug: "unsolved-deaths",
    label: "Unsolved Deaths",
    description: "Unresolved killings, unidentified victims, and disputed deaths.",
    titleTerms: ["black dahlia", "boy in the box"],
    contentTerms: [
      "murder",
      "murdered",
      "killed",
      "killing",
      "homicide",
      "body",
      "crime scene",
      "death",
      "victim"
    ]
  },
  {
    slug: "last-known-movements",
    label: "Last Known Movements",
    description: "Timelines built around final calls, drives, sightings, and departures.",
    titleTerms: [
      "last call",
      "last seen",
      "final days",
      "final moments",
      "long drive",
      "walked",
      "crash",
      "route",
      "bridge",
      "walked"
    ],
    contentTerms: [
      "last verified",
      "final confirmed",
      "final sighting",
      "last known",
      "surveillance cameras",
      "left her home",
      "left his home",
      "drive home",
      "departure"
    ]
  },
  {
    slug: "historic-cases",
    label: "Historic Cases",
    description: "Cases whose central events took place before 1990.",
    contentTerms: [
      "1940",
      "1941",
      "1942",
      "1943",
      "1944",
      "1945",
      "1946",
      "1947",
      "1948",
      "1949",
      "1950",
      "1951",
      "1952",
      "1953",
      "1954",
      "1955",
      "1956",
      "1957",
      "1958",
      "1959",
      "1960",
      "1961",
      "1962",
      "1963",
      "1964",
      "1965",
      "1966",
      "1967",
      "1968",
      "1969",
      "1970",
      "1971",
      "1972",
      "1973",
      "1974",
      "1975",
      "1976",
      "1977",
      "1978",
      "1979",
      "1980",
      "1981",
      "1982",
      "1983",
      "1984",
      "1985",
      "1986",
      "1987",
      "1988",
      "1989"
    ]
  }
];

const episodeCategorySlugs = (episode) => {
  const title = normalizeSearchText(episode.title);
  const content = normalizeSearchText(
    `${episode.title} ${episode.summary} ${(episode.body ?? []).join(" ")}`
  );
  const slugs = CATEGORY_DEFINITIONS.filter((category) => {
    const titleMatch = (category.titleTerms ?? []).some((term) =>
      title.includes(normalizeSearchText(term))
    );
    const contentMatch = (category.contentTerms ?? []).some((term) =>
      content.includes(normalizeSearchText(term))
    );

    return titleMatch || contentMatch;
  }).map((category) => category.slug);

  return slugs.length ? slugs : ["other-investigations"];
};

const buildEpisodeCategories = (episodes) => {
  const categories = CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    episodes: episodes.filter((episode) => episodeCategorySlugs(episode).includes(category.slug))
  })).filter((category) => category.episodes.length);
  const otherEpisodes = episodes.filter((episode) =>
    episodeCategorySlugs(episode).includes("other-investigations")
  );

  if (otherEpisodes.length) {
    categories.push({
      slug: "other-investigations",
      label: "Other Investigations",
      description: "Additional cases and investigations from the podcast.",
      episodes: otherEpisodes
    });
  }

  return categories;
};

const renderSitemap = (origin, episodes) => {
  const latestPublishedDate = (items) =>
    items
      .map((item) => item.publishedDate)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const listingUrls = [];
  const listingGroups = [
    {
      categorySlug: null,
      episodes
    },
    ...buildEpisodeCategories(episodes).map((category) => ({
      categorySlug: category.slug,
      episodes: category.episodes
    }))
  ];

  for (const group of listingGroups) {
    const totalPages = Math.ceil(group.episodes.length / EPISODES_PER_PAGE);
    const lastModified = latestPublishedDate(group.episodes);

    for (let page = 1; page <= totalPages; page += 1) {
      if (!group.categorySlug && page === 1) {
        continue;
      }

      const location = new URL("/", origin);

      if (group.categorySlug) {
        location.searchParams.set("category", group.categorySlug);
      }

      if (page > 1) {
        location.searchParams.set("page", String(page));
      }

      listingUrls.push({
        location: location.href,
        lastModified
      });
    }
  }

  const homepageLastModified = latestPublishedDate(episodes);
  const urls = [
    {
      location: new URL("/", origin).href,
      lastModified: homepageLastModified
    },
    ...STATIC_PAGES.map((page) => ({
      location: new URL(`/${page.slug}`, origin).href,
      lastModified: formatStaticPageSitemapDate(page.updated)
    })),
    ...listingUrls,
    ...episodes.map((episode) => ({
      location: new URL(episodePath(episode), origin).href,
      lastModified: episode.publishedDate
    }))
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ location, lastModified }) => `  <url>
    <loc>${escapeXml(location)}</loc>${
      lastModified ? `\n    <lastmod>${escapeXml(lastModified)}</lastmod>` : ""
    }
  </url>`
  )
  .join("\n")}
</urlset>`;
};

const renderCases = (cases) =>
  cases
    .map((item) => {
      const cardHref = item.slug ? episodePath(item) : item.href;
      const tag = cardHref ? "a" : "article";
      const href = cardHref ? ` href="${escapeHtml(cardHref)}"` : "";

      return `
        <${tag} class="case-card"${href}>
          ${renderEpisodeImage(item, "case-card-image")}
          <p>${escapeHtml(item.publishedAt ?? item.status)}</p>
          <h3>${escapeHtml(item.title)}</h3>
          <span>${escapeHtml(item.detail)}</span>
        </${tag}>`;
    })
    .join("");

const renderLandingEpisodePlayers = (episodes) =>
  episodes
    .map(
      (episode, index) => `
        <article
          class="landing-episode-player"
          id="${escapeHtml(episodeAnchor(episode))}"
          aria-labelledby="${escapeHtml(episodeAnchor(episode))}-title"
        >
          <a class="landing-episode-art-link" href="${escapeHtml(episodePath(episode))}">
            ${renderEpisodeImage(episode, "landing-episode-art")}
          </a>
          <div class="landing-episode-content">
            <p class="section-kicker">${index === 0 ? "Latest episode" : escapeHtml(episode.publishedAt)}</p>
            <h2 id="${escapeHtml(episodeAnchor(episode))}-title">
              <a href="${escapeHtml(episodePath(episode))}">${escapeHtml(episode.title)}</a>
            </h2>
            <p class="episode-summary">${escapeHtml(episode.summary)}</p>
            <div class="episode-links">
              <a href="${escapeHtml(episodePath(episode))}">Episode details</a>
              <a href="${escapeHtml(episode.spotifyUrl)}">Listen on Spotify</a>
              <a href="#${escapeHtml(episodeAnchor(episode))}" aria-label="Copyable link to ${escapeHtml(episode.title)}">Direct link</a>
            </div>
          </div>
        </article>`
    )
    .join("");

const homepageCasesHref = (selectedCategory, page) => {
  const params = [];

  if (selectedCategory) {
    params.push(`category=${encodeURIComponent(selectedCategory)}`);
  }

  if (page > 1) {
    params.push(`page=${encodeURIComponent(page)}`);
  }

  return `/${params.length ? `?${params.join("&")}` : ""}#cases`;
};

const renderPagination = (currentPage, totalPages, selectedCategory) => {
  if (totalPages <= 1) {
    return "";
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return `
    <nav class="pagination" aria-label="Episode pages">
      <a class="pagination-link${currentPage === 1 ? " disabled" : ""}" href="${escapeHtml(
        homepageCasesHref(selectedCategory, Math.max(1, currentPage - 1))
      )}"${currentPage === 1 ? ' aria-disabled="true"' : ""}>Previous</a>
      <div class="pagination-pages">
        ${pages
          .map(
            (page) => `
              <a class="pagination-number${
                page === currentPage ? " active" : ""
              }" href="${escapeHtml(homepageCasesHref(selectedCategory, page))}"${
                page === currentPage ? ' aria-current="page"' : ""
              }>${escapeHtml(page)}</a>`
          )
          .join("")}
      </div>
      <a class="pagination-link${currentPage === totalPages ? " disabled" : ""}" href="${escapeHtml(
        homepageCasesHref(selectedCategory, Math.min(totalPages, currentPage + 1))
      )}"${currentPage === totalPages ? ' aria-disabled="true"' : ""}>Next</a>
    </nav>`;
};

const renderCategoryBrowser = (categories, selectedCategory, episodeCount) => `
  <section class="section category-section" id="categories">
    <p class="section-kicker">Explore by topic</p>
    <div class="category-heading">
      <h2>Follow the kind of case that interests you.</h2>
      <p>Categories are generated from each episode’s title and description on Spotify.</p>
    </div>
    <div class="category-grid">
      <a class="category-card${selectedCategory ? "" : " active"}" href="/#cases">
        <span class="category-count">${escapeHtml(episodeCount)}</span>
        <strong>All episodes</strong>
        <span>Browse every case in the podcast archive.</span>
      </a>
      ${categories
        .map(
          (category) => `
            <a class="category-card${
              selectedCategory === category.slug ? " active" : ""
            }" href="/?category=${encodeURIComponent(category.slug)}#cases">
              <span class="category-count">${escapeHtml(category.episodes.length)}</span>
              <strong>${escapeHtml(category.label)}</strong>
              <span>${escapeHtml(category.description)}</span>
            </a>`
        )
        .join("")}
    </div>
  </section>`;

const selectRelatedEpisodes = (episode, episodes, limit = 3) => {
  const currentIndex = episodes.findIndex((item) => item.id === episode.id);
  const adjacent =
    currentIndex === -1
      ? []
      : [episodes[currentIndex - 1], episodes[currentIndex + 1]].filter(Boolean);
  const remaining = episodes.filter(
    (item) => item.id !== episode.id && !adjacent.some((related) => related.id === item.id)
  );

  return [...adjacent, ...remaining].slice(0, limit);
};

const renderRelatedEpisodes = (episode, relatedEpisodes) => {
  if (!relatedEpisodes.length) {
    return "";
  }

  return `
    <section class="related-episodes" id="related-episodes" aria-labelledby="related-episodes-title">
      <p class="section-kicker">Keep exploring</p>
      <h2 id="related-episodes-title">More episodes from ${escapeHtml(podcast.name)}</h2>
      <div class="related-episode-grid">
        ${relatedEpisodes
          .map(
            (relatedEpisode) => `
              <a class="related-episode-card" href="${escapeHtml(episodePath(relatedEpisode))}">
                ${renderEpisodeImage(relatedEpisode, "related-episode-image")}
                <span>
                  <small>${escapeHtml(relatedEpisode.publishedAt)}</small>
                  <strong>${escapeHtml(relatedEpisode.title)}</strong>
                  <span>${escapeHtml(relatedEpisode.summary)}</span>
                </span>
              </a>`
          )
          .join("")}
      </div>
      <a class="all-episodes-link" href="/#cases">Browse all podcast episodes</a>
    </section>`;
};

const renderFooter = ({ disclaimer = "" } = {}) => `
  <footer class="section footer">
    <div class="footer-copy">
      <span>${escapeHtml(podcast.name)}. Hosted by ${escapeHtml(podcast.host)}.</span>
      ${disclaimer ? `<p>${escapeHtml(disclaimer)}</p>` : ""}
    </div>
    <nav class="footer-links" aria-label="Footer navigation">
      <a href="/">Home</a>
      <a href="/#cases">All episodes</a>
      <a href="/about-us">About Us</a>
      <a href="/contact-us">Contact Us</a>
      <a href="/privacy-policy">Privacy Policy</a>
      <a href="/editorial-policy">Editorial Policy</a>
      <a href="/sitemap.xml">Sitemap</a>
    </nav>
  </footer>`;

const renderSearchForm = (query = "", className = "site-search") => `
  <form class="${escapeHtml(className)}" action="/search" method="get" role="search">
    <label class="visually-hidden" for="${escapeHtml(className)}-query">Search episodes</label>
    <input
      id="${escapeHtml(className)}-query"
      name="q"
      type="search"
      value="${escapeHtml(query)}"
      placeholder="Search episodes"
      maxlength="100"
      required
    >
    <button type="submit">Search</button>
  </form>`;

const renderSiteHeader = ({ home = false, query = "" } = {}) => `
  <header class="topbar">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">LK</span>
      <span>${escapeHtml(podcast.name)}</span>
    </a>
    <nav class="nav" aria-label="Primary navigation">
      <a href="/">Home</a>
      <a href="${home ? "#cases" : "/#cases"}">All episodes</a>
      <a href="/about-us">About Us</a>
      <a href="/contact-us">Contact Us</a>
      <a href="/privacy-policy">Privacy Policy</a>
      <a href="/editorial-policy">Editorial Policy</a>
      <a href="/sitemap.xml">Sitemap</a>
    </nav>
    ${renderSearchForm(query)}
  </header>`;

const renderPlaybackTracking = (episodes, countryCode) => {
  const audioPlayers = episodes
    .filter((episode) => episode.audioUrl)
    .map((episode) => ({
      elementId: `spotify-player-${episode.id}`,
      episodeId: episode.id,
      episodeTitle: episode.title,
      provider: "spotify"
    }));
  const videoPlayers = [];
  const hostedVideoPlayers = [];

  if (!audioPlayers.length && !videoPlayers.length && !hostedVideoPlayers.length) {
    return "";
  }

  return `
    <script>
      (function () {
        var countryCode = ${safeJson(countryCode)};
        var audioPlayers = ${safeJson(audioPlayers)};
        var videoPlayers = ${safeJson(videoPlayers)};
        var hostedVideoPlayers = ${safeJson(hostedVideoPlayers)};
        var imaSdkUrl = ${safeJson(IMA_SDK_URL)};
        var adLanguage = 'en';
        var milestones = [20, 50, 75];

        function sendPlaybackEvent(type, episode, position, duration, mediaType, extraParameters) {
          var numericPosition = Number(position) || 0;
          var numericDuration = Number(duration) || 0;
          var playbackPercent =
            numericDuration > 0
              ? Math.min(100, Math.max(0, Math.round((numericPosition / numericDuration) * 100)))
              : 0;
          var eventName = 'thelastknownpodcast_' + mediaType + '_' + type + '_' + countryCode;
          var parameters = {
            event_type: type,
            country_code: countryCode,
            media_type: mediaType,
            episode_id: episode.episodeId,
            episode_title: episode.episodeTitle,
            playback_position_ms: Math.round(numericPosition),
            playback_duration_ms: Math.round(numericDuration),
            playback_percent: playbackPercent
          };

          if (extraParameters) {
            Object.keys(extraParameters).forEach(function (key) {
              parameters[key] = extraParameters[key];
            });
          }

          if (typeof window.gtag === 'function') {
            window.gtag('event', eventName, parameters);
          }

          if (typeof window.fbq === 'function') {
            window.fbq('trackCustom', eventName, parameters);
          }
        }
        function initializeNativeAudioTracking() {
          audioPlayers.forEach(function (episode) {
            var audio = document.getElementById(episode.elementId);
            if (!audio || audio.dataset.analyticsInitialized === 'true') return;

            audio.dataset.analyticsInitialized = 'true';
            var completedMilestones = {};

            function durationMs() {
              return Number(audio.duration) > 0 ? Number(audio.duration) * 1000 : 0;
            }

            function positionMs() {
              return Number(audio.currentTime) > 0 ? Number(audio.currentTime) * 1000 : 0;
            }

            function parameters(extra) {
              return Object.assign({ player_provider: episode.provider }, extra || {});
            }

            audio.addEventListener('play', function () {
              sendPlaybackEvent('play', episode, positionMs(), durationMs(), 'audio', parameters());
            });

            audio.addEventListener('pause', function () {
              if (audio.ended) return;
              sendPlaybackEvent('pause', episode, positionMs(), durationMs(), 'audio', parameters());
            });

            audio.addEventListener('timeupdate', function () {
              var duration = durationMs();
              if (duration <= 0) return;
              var position = positionMs();
              var progress = (position / duration) * 100;

              milestones.forEach(function (milestone) {
                if (completedMilestones[milestone] || progress < milestone) return;
                completedMilestones[milestone] = true;
                sendPlaybackEvent(
                  'progress_' + milestone,
                  episode,
                  position,
                  duration,
                  'audio',
                  parameters({ progress_percent: milestone })
                );
              });
            });

            audio.addEventListener('ended', function () {
              sendPlaybackEvent(
                'ended',
                episode,
                positionMs(),
                durationMs(),
                'audio',
                parameters({ progress_percent: 100 })
              );
            });
          });
        }

        function loadImaSdk(callback) {
          if (window.google && window.google.ima) {
            callback();
            return;
          }

          var existingScript = document.querySelector('script[data-ima-sdk]');

          if (existingScript) {
            existingScript.addEventListener('load', callback, { once: true });
            return;
          }

          var script = document.createElement('script');
          script.src = imaSdkUrl;
          script.async = true;
          script.dataset.imaSdk = 'true';
          script.addEventListener('load', callback, { once: true });
          document.head.appendChild(script);
        }

        function vastUrlWithLanguage(value) {
          try {
            var url = new URL(value, window.location.href);
            url.searchParams.set('hl', adLanguage);
            url.searchParams.set('lang', adLanguage);
            url.searchParams.set('language', adLanguage);
            return url.href;
          } catch (_error) {
            return value;
          }
        }

        function initializeVastAds() {
          if (!hostedVideoPlayers.length) return;

          hostedVideoPlayers.forEach(function (episode) {
            var video = document.getElementById(episode.elementId);
            var adContainer = document.getElementById(episode.adContainerId);
            var videoPlayer = adContainer ? adContainer.closest('.video-player') : null;
            var skipButton = videoPlayer ? videoPlayer.querySelector('[data-video-ad-skip]') : null;
            var startButton = videoPlayer ? videoPlayer.querySelector('[data-video-ad-start]') : null;
            var isMobileBrowser = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
              (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);

            if (
              !video ||
              !adContainer ||
              !video.dataset.vastAdTag ||
              video.dataset.vastInitialized === 'true'
            ) {
              return;
            }

            video.dataset.vastInitialized = 'true';
            var completedAdBreaks = {
              preroll: false,
              midroll: false,
              postroll: false
            };
            var failedAdBreaks = {
              preroll: false,
              midroll: false,
              postroll: false
            };
            var adPlaying = false;
            var currentAdBreak = "";
            var adsLoader = null;
            var adsManager = null;
            var adDisplayContainer = null;
            var adDisplayContainerInitialized = false;
            var skipTimer = 0;
            var adRequestTimer = 0;
            var suppressNextPlayAd = false;

            function initializeAdDisplayContainer() {
              if (!window.google || !window.google.ima) {
                return false;
              }

              if (
                window.google.ima.settings &&
                typeof window.google.ima.settings.setDisableCustomPlaybackForIOS10Plus === 'function'
              ) {
                window.google.ima.settings.setDisableCustomPlaybackForIOS10Plus(false);
              }

              if (!adDisplayContainer) {
                adDisplayContainer = new window.google.ima.AdDisplayContainer(adContainer, video);
              }

              if (!adDisplayContainerInitialized) {
                adDisplayContainer.initialize();
                adDisplayContainerInitialized = true;
              }

              return true;
            }

            function prepareAdsForUserGesture() {
              if (adDisplayContainerInitialized) return;

              loadImaSdk(function () {
                initializeAdDisplayContainer();
              });
            }

            function adSlotSize() {
              return {
                width: adContainer.offsetWidth || video.clientWidth || 640,
                height: adContainer.offsetHeight || video.clientHeight || 360
              };
            }

            function resizeAdManager() {
              if (!adsManager || typeof adsManager.resize !== 'function') return;

              var size = adSlotSize();
              adsManager.resize(size.width, size.height, window.google.ima.ViewMode.NORMAL);
            }

            function forceAdLayerPaint() {
              adContainer.classList.add('painting');
              window.requestAnimationFrame(function () {
                resizeAdManager();
                adContainer.classList.remove('painting');
                window.requestAnimationFrame(resizeAdManager);
              });
            }

            function finishAd(resumeContent, adCompleted) {
              if (!adPlaying && !currentAdBreak) return;

              adPlaying = false;
              if (adCompleted && currentAdBreak) {
                completedAdBreaks[currentAdBreak] = true;
              } else if (currentAdBreak) {
                failedAdBreaks[currentAdBreak] = true;
              }
              currentAdBreak = "";
              window.clearTimeout(skipTimer);
              window.clearTimeout(adRequestTimer);
              video.dataset.vastAdPlaying = 'false';
              adContainer.classList.remove('active');
              adContainer.classList.remove('painting');
              if (skipButton) {
                skipButton.classList.remove('visible');
              }

              if (adsManager && typeof adsManager.destroy === 'function') {
                adsManager.destroy();
              }
              if (adsLoader && typeof adsLoader.destroy === 'function') {
                adsLoader.destroy();
              }
              adsManager = null;
              adsLoader = null;

              if (resumeContent) {
                suppressNextPlayAd = true;
                video.play().catch(function () {});
              }
            }

            function requestAd(adBreak, resumeContent, event) {
              if (adPlaying || completedAdBreaks[adBreak]) return;

              if (!window.google || !window.google.ima) {
                loadImaSdk(function () {
                  requestAd(adBreak, resumeContent, event);
                });
                return;
              }

              if (
                window.google.ima.settings &&
                typeof window.google.ima.settings.setLocale === 'function'
              ) {
                window.google.ima.settings.setLocale(adLanguage);
              }
              if (
                window.google.ima.settings &&
                typeof window.google.ima.settings.setDisableCustomPlaybackForIOS10Plus === 'function'
              ) {
                window.google.ima.settings.setDisableCustomPlaybackForIOS10Plus(false);
              }

              adPlaying = true;
              currentAdBreak = adBreak;
              video.dataset.vastAdPlaying = 'true';
              video.pause();
              adContainer.classList.add('active');

              if (!initializeAdDisplayContainer()) {
                finishAd(resumeContent, false);
                return;
              }

              adRequestTimer = window.setTimeout(function () {
                finishAd(resumeContent, false);
              }, 8000);
              if (skipButton) {
                skipButton.classList.remove('visible');
              }

              adsLoader = new window.google.ima.AdsLoader(adDisplayContainer);

              adsLoader.addEventListener(
                window.google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
                function (adsManagerLoadedEvent) {
                  window.clearTimeout(adRequestTimer);
                  adsManager = adsManagerLoadedEvent.getAdsManager(video);
                  adsManager.addEventListener(window.google.ima.AdEvent.Type.LOADED, forceAdLayerPaint);
                  adsManager.addEventListener(window.google.ima.AdEvent.Type.STARTED, function () {
                    forceAdLayerPaint();
                    window.clearTimeout(skipTimer);
                    if (skipButton) {
                      skipTimer = window.setTimeout(function () {
                        if (adPlaying) {
                          skipButton.classList.add('visible');
                        }
                      }, 15000);
                    }
                  });
                  adsManager.addEventListener(
                    window.google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED,
                    function () {
                      video.pause();
                    }
                  );
                  adsManager.addEventListener(
                    window.google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED,
                    function () {
                      finishAd(resumeContent, true);
                    }
                  );
                  adsManager.addEventListener(window.google.ima.AdEvent.Type.ALL_ADS_COMPLETED, function () {
                    finishAd(resumeContent, true);
                  });
                  adsManager.addEventListener(window.google.ima.AdErrorEvent.Type.AD_ERROR, function () {
                    finishAd(resumeContent, false);
                  });

                  try {
                    var size = adSlotSize();
                    adsManager.init(size.width, size.height, window.google.ima.ViewMode.NORMAL);
                    forceAdLayerPaint();
                    adsManager.start();
                    window.setTimeout(forceAdLayerPaint, 100);
                    window.setTimeout(forceAdLayerPaint, 500);
                  } catch (_error) {
                    finishAd(resumeContent, false);
                  }
                },
                false
              );

              adsLoader.addEventListener(
                window.google.ima.AdErrorEvent.Type.AD_ERROR,
                function () {
                  finishAd(resumeContent, false);
                },
                false
              );

              var adsRequest = new window.google.ima.AdsRequest();
              adsRequest.adTagUrl = vastUrlWithLanguage(video.dataset.vastAdTag);
              var size = adSlotSize();
              adsRequest.linearAdSlotWidth = size.width;
              adsRequest.linearAdSlotHeight = size.height;
              adsRequest.nonLinearAdSlotWidth = adsRequest.linearAdSlotWidth;
              adsRequest.nonLinearAdSlotHeight = Math.max(90, Math.round(adsRequest.linearAdSlotHeight / 3));
              if (typeof adsRequest.setAdWillAutoPlay === 'function') {
                adsRequest.setAdWillAutoPlay(false);
              }
              if (typeof adsRequest.setAdWillPlayMuted === 'function') {
                adsRequest.setAdWillPlayMuted(false);
              }
              adsLoader.requestAds(adsRequest);

              if (event && typeof event.preventDefault === 'function') {
                event.preventDefault();
              }
            }

            if (startButton) {
              startButton.addEventListener('click', function (event) {
                event.preventDefault();
                if (startButton) startButton.hidden = true;
                initializeAdDisplayContainer();
                requestAd('preroll', true, event);
              });
            }
            video.addEventListener('pointerdown', prepareAdsForUserGesture, { passive: true, capture: true });
            video.addEventListener('touchstart', prepareAdsForUserGesture, { passive: true, capture: true });
            video.addEventListener('click', prepareAdsForUserGesture, { passive: true, capture: true });
            video.addEventListener('play', function (event) {
              if (suppressNextPlayAd) {
                suppressNextPlayAd = false;
                return;
              }
              requestAd('preroll', true, event);
            });
            video.addEventListener('timeupdate', function () {
              if (
                isMobileBrowser ||
                adPlaying ||
                completedAdBreaks.midroll ||
                (!completedAdBreaks.preroll && !failedAdBreaks.preroll)
              ) {
                return;
              }
              if (!Number(video.duration) || video.duration <= 0) return;

              if ((Number(video.currentTime) / Number(video.duration)) >= 0.5) {
                requestAd('midroll', true);
              }
            });
            video.addEventListener('ended', function () {
              requestAd('postroll', false);
            });
            if (skipButton) {
              skipButton.addEventListener('click', function () {
                finishAd(currentAdBreak !== 'postroll', true);
              });
            }
          });

          loadImaSdk(function () {});
        }

        function initializeNativeVideoTracking() {
          if (!hostedVideoPlayers.length) return;

          hostedVideoPlayers.forEach(function (episode) {
            var video = document.getElementById(episode.elementId);
            if (!video || video.dataset.analyticsInitialized === 'true') return;

            video.dataset.analyticsInitialized = 'true';
            var completedMilestones = {};

            function durationMs() {
              return Number(video.duration) > 0 ? Number(video.duration) * 1000 : 0;
            }

            function positionMs() {
              return Number(video.currentTime) > 0 ? Number(video.currentTime) * 1000 : 0;
            }

            video.addEventListener('play', function () {
              if (video.dataset.vastAdPlaying === 'true') return;
              sendPlaybackEvent('play', episode, positionMs(), durationMs(), 'video', {
                player_provider: episode.provider
              });
            });

            video.addEventListener('pause', function () {
              if (video.dataset.vastAdPlaying === 'true' || video.ended) return;
              sendPlaybackEvent('pause', episode, positionMs(), durationMs(), 'video', {
                player_provider: episode.provider
              });
            });

            video.addEventListener('timeupdate', function () {
              var duration = durationMs();
              if (duration <= 0 || video.dataset.vastAdPlaying === 'true') return;

              var position = positionMs();
              var progress = (position / duration) * 100;

              milestones.forEach(function (milestone) {
                if (completedMilestones[milestone] || progress < milestone) return;

                completedMilestones[milestone] = true;
                sendPlaybackEvent(
                  'progress_' + milestone,
                  episode,
                  position,
                  duration,
                  'video',
                  { progress_percent: milestone, player_provider: episode.provider }
                );
              });
            });

            video.addEventListener('ended', function () {
              sendPlaybackEvent('ended', episode, positionMs(), durationMs(), 'video', {
                progress_percent: 100,
                player_provider: episode.provider
              });
            });
          });
        }

        function initializeYouTubeTracking() {
          if (!videoPlayers.length) return;

          videoPlayers.forEach(function (episode) {
            var element = document.getElementById(episode.elementId);
            if (!element || element.dataset.analyticsInitialized === 'true') return;

            element.dataset.analyticsInitialized = 'true';
            var completedMilestones = {};
            var progressTimer = 0;
            var player = new window.YT.Player(episode.elementId, {
              events: {
                onStateChange: function (event) {
                  var state = event.data;
                  var position = Number(player.getCurrentTime && player.getCurrentTime()) * 1000 || 0;
                  var duration = Number(player.getDuration && player.getDuration()) * 1000 || 0;

                  if (state === window.YT.PlayerState.PLAYING) {
                    sendPlaybackEvent('play', episode, position, duration, 'video');
                    window.clearInterval(progressTimer);
                    progressTimer = window.setInterval(function () {
                      var currentPosition = Number(player.getCurrentTime && player.getCurrentTime()) * 1000 || 0;
                      var currentDuration = Number(player.getDuration && player.getDuration()) * 1000 || 0;

                      if (currentDuration <= 0) return;

                      var progress = (currentPosition / currentDuration) * 100;

                      milestones.forEach(function (milestone) {
                        if (completedMilestones[milestone] || progress < milestone) return;

                        completedMilestones[milestone] = true;
                        sendPlaybackEvent(
                          'progress_' + milestone,
                          episode,
                          currentPosition,
                          currentDuration,
                          'video',
                          { progress_percent: milestone }
                        );
                      });
                    }, 1000);
                    return;
                  }

                  if (state === window.YT.PlayerState.PAUSED) {
                    window.clearInterval(progressTimer);
                    sendPlaybackEvent('pause', episode, position, duration, 'video');
                    return;
                  }

                  if (state === window.YT.PlayerState.ENDED) {
                    window.clearInterval(progressTimer);
                    sendPlaybackEvent(
                      'ended',
                      episode,
                      position,
                      duration,
                      'video',
                      { progress_percent: 100 }
                    );
                  }
                }
              }
            });
          });
        }

        function loadYouTubeApi() {
          if (!videoPlayers.length) return;

          if (window.YT && typeof window.YT.Player === 'function') {
            initializeYouTubeTracking();
            return;
          }

          var existingCallback = window.onYouTubeIframeAPIReady;
          window.onYouTubeIframeAPIReady = function () {
            if (typeof existingCallback === 'function') {
              existingCallback();
            }

            initializeYouTubeTracking();
          };

          if (document.querySelector('script[data-youtube-iframe-api]')) return;

          var script = document.createElement('script');
          script.src = 'https://www.youtube.com/iframe_api';
          script.async = true;
          script.dataset.youtubeIframeApi = 'true';
          document.head.appendChild(script);
        }

        initializeNativeAudioTracking();
        initializeNativeVideoTracking();
        loadYouTubeApi();
      })();
    </script>`;
};

const renderEpisodeJumpNavTracking = (episode, countryCode) => `
  <script>
    (function () {
      var countryCode = ${safeJson(countryCode)};
      var episode = ${safeJson({
        episodeId: episode.id,
        episodeTitle: episode.title
      })};
      var jumpNav = document.querySelector('.episode-jump-nav');
      if (!jumpNav || jumpNav.dataset.analyticsInitialized === 'true') return;

      jumpNav.dataset.analyticsInitialized = 'true';
      jumpNav.addEventListener('click', function (event) {
        var link = event.target.closest('a[data-jump-section]');
        if (!link || !jumpNav.contains(link)) return;

        var eventName = 'thelastknownpodcast_episode_jump_nav_click_' + countryCode;
        var parameters = {
          country_code: countryCode,
          episode_id: episode.episodeId,
          episode_title: episode.episodeTitle,
          jump_section: link.dataset.jumpSection || link.textContent.trim(),
          jump_target: link.dataset.jumpTarget || link.getAttribute('href') || ''
        };

        if (typeof window.gtag === 'function') {
          window.gtag('event', eventName, parameters);
        }

        if (typeof window.fbq === 'function') {
          window.fbq('trackCustom', eventName, parameters);
        }
      });
    })();
  </script>`;

const renderPageViewNotification = (delayMs = 3000) => `
  <script>
    (function () {
      function reportPageView() {
        if (document.visibilityState !== 'visible') return;

        var viewedPath = (window.location.pathname + window.location.search).slice(0, 900);
        var referrer = String(document.referrer || '').slice(0, 900);
        var endpoint = '/analytics/page-view?path=' + encodeURIComponent(viewedPath) +
          '&referrer=' + encodeURIComponent(referrer);

        fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          keepalive: true,
          headers: { 'content-type': 'text/plain;charset=UTF-8' }
        }).catch(function () {});
      }

      var delayMs = ${Math.max(0, Number(delayMs) || 0)};

      if (delayMs === 0) {
        reportPageView();
      } else {
        window.addEventListener('load', function () {
          window.setTimeout(reportPageView, delayMs);
        }, { once: true });
      }
    })();
  </script>`;

const renderAttachments = (episode) => {
  if (!episode.attachments?.length) {
    return "";
  }

  const items = episode.attachments
    .map((attachment) => {
      const url = attachmentPath(episode.id, attachment.id);
      const description = attachment.description
        ? `<p>${escapeHtml(attachment.description)}</p>`
        : "";

      if (attachment.type === "image") {
        return `
          <figure class="attachment-card attachment-image">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
              <img src="${escapeHtml(url)}" alt="${escapeHtml(
                attachment.description || attachment.title
              )}" loading="lazy">
            </a>
            <figcaption>
              <h3>${escapeHtml(attachment.title)}</h3>
              ${description}
              <a class="attachment-link" href="${escapeHtml(url)}" download>Download image</a>
            </figcaption>
          </figure>`;
      }

      if (attachment.type === "pdf") {
        const pdfPreviewUrl = `${url}#page=1&toolbar=0&navpanes=0`;

        return `
          <article class="attachment-card attachment-pdf">
            <div class="pdf-preview" aria-label="${escapeHtml(`${attachment.title} first page preview`)}">
              <iframe
                src="${escapeHtml(pdfPreviewUrl)}"
                title="${escapeHtml(`${attachment.title} first page preview`)}"
                loading="lazy"
              ></iframe>
            </div>
            <div class="attachment-file">
              <p class="attachment-type">PDF document</p>
              <h3>${escapeHtml(attachment.title)}</h3>
              ${description}
              <p class="attachment-meta">${escapeHtml(attachment.filename)} · ${escapeHtml(
                formatFileSize(attachment.size)
              )}</p>
              <a class="button secondary-dark" href="${escapeHtml(
                url
              )}" target="_blank" rel="noopener">View PDF</a>
            </div>
          </article>`;
      }

      const label = attachment.type === "pdf" ? "View PDF" : "Download file";

      return `
        <article class="attachment-card attachment-file">
          <p class="attachment-type">${escapeHtml(
            attachment.type === "pdf" ? "PDF document" : "Episode file"
          )}</p>
          <h3>${escapeHtml(attachment.title)}</h3>
          ${description}
          <p class="attachment-meta">${escapeHtml(attachment.filename)} · ${escapeHtml(
            formatFileSize(attachment.size)
          )}</p>
          <a class="button secondary-dark" href="${escapeHtml(url)}"${
            attachment.type === "pdf" ? ' target="_blank" rel="noopener"' : " download"
          }>${label}</a>
        </article>`;
    })
    .join("");

  return `
    <section class="episode-attachments" id="materials" aria-labelledby="episode-materials-title">
      <p class="section-kicker">Supporting material</p>
      <h2 id="episode-materials-title">Episode materials</h2>
      <div class="attachment-grid">${items}</div>
    </section>`;
};

const renderVideoOverview = (episode) => {
  const video = episode.spotifyVideoOverview;

  if (!video) {
    return "";
  }

  return `
    <section class="episode-video" id="video" aria-labelledby="video-overview-title">
      <p class="section-kicker">Watch</p>
      <h2 id="video-overview-title">Video overview</h2>
      <a class="spotify-video-overview" href="${escapeHtml(video.url)}">
        <img src="${escapeHtml(video.image || episode.image)}" alt="" loading="lazy">
        <span>
          <strong>${escapeHtml(video.title)}</strong>
          <span>Watch on Spotify</span>
        </span>
      </a>
    </section>`;
};

const renderInlineMarkdown = (value) => {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
};

const renderMarkdownBlocks = (value) => {
  const lines = String(value ?? "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let paragraph = [];
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }

    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) {
      return;
    }

    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{2,3})\s+(.+)$/);

    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInlineMarkdown(line.slice(2).trim())}</blockquote>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);

    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join("");
};

const renderEpisodeArticle = (episode) => {
  const article = normalizeArticle(episode.article);

  if (!article.body) {
    return "";
  }

  return `
    <section class="episode-article" id="companion-article" aria-labelledby="episode-article-title">
      <p class="section-kicker">Companion article</p>
      <h2 id="episode-article-title">${escapeHtml(article.title || `${episode.title} companion article`)}</h2>
      <p class="article-context">This companion article expands on themes, context, or related questions from the episode.</p>
      ${article.updatedAt ? `<p class="article-updated">Last updated ${escapeHtml(article.updatedAt)}</p>` : ""}
      ${article.excerpt ? `<p class="article-excerpt">${escapeHtml(article.excerpt)}</p>` : ""}
      <div class="article-body">
        ${renderMarkdownBlocks(article.body)}
      </div>
      <a class="back-to-top" href="#episode-title">Back to top</a>
    </section>`;
};

const renderEpisodeJumpNav = (episode, relatedEpisodes = []) => {
  const article = normalizeArticle(episode.article);
  const links = [
    episode.spotifyVideoOverview ? { href: "#video", label: "Video" } : null,
    normalizeMapLocations(episode.mapLocations).length ? { href: "#locations", label: "Locations" } : null,
    episode.attachments?.length ? { href: "#materials", label: "Materials" } : null,
    article.body ? { href: "#companion-article", label: "Companion article" } : null,
    episode.transcriptContent?.paragraphs?.length ? { href: "#transcript", label: "Transcript" } : null,
    relatedEpisodes.length ? { href: "#related-episodes", label: "Related episodes" } : null
  ].filter(Boolean);

  if (!links.length) {
    return "";
  }

  return `
    <nav class="episode-jump-nav" aria-label="Episode sections">
      <span>On this page</span>
      <div>
        ${links
          .map(
            (link) =>
              `<a href="${escapeHtml(link.href)}" data-jump-section="${escapeHtml(
                link.label
              )}" data-jump-target="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`
          )
          .join("")}
      </div>
    </nav>`;
};

const mapSearchUrl = (location) => {
  if (location.latitude !== null && location.longitude !== null) {
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
      location.latitude
    )}&mlon=${encodeURIComponent(location.longitude)}#map=14/${encodeURIComponent(
      location.latitude
    )}/${encodeURIComponent(location.longitude)}`;
  }

  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(
    location.address || location.label
  )}`;
};

const mapEmbedUrl = (location) => {
  if (location.latitude === null || location.longitude === null) {
    return "";
  }

  const latitude = location.latitude;
  const longitude = location.longitude;
  const latitudeDelta = 0.018;
  const longitudeDelta = 0.026;
  const bbox = [
    longitude - longitudeDelta,
    latitude - latitudeDelta,
    longitude + longitudeDelta,
    latitude + latitudeDelta
  ].join(",");

  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bbox
  )}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`;
};

const renderEpisodeMap = (episode) => {
  const locations = normalizeMapLocations(episode.mapLocations);

  if (!locations.length) {
    return "";
  }

  const primaryLocation = locations.find(
    (location) => location.latitude !== null && location.longitude !== null
  );
  const embedUrl = primaryLocation ? mapEmbedUrl(primaryLocation) : "";

  return `
    <section class="episode-map" id="locations" aria-labelledby="episode-map-title">
      <p class="section-kicker">Locations</p>
      <h2 id="episode-map-title">Case locations</h2>
      ${
        embedUrl
          ? `<div class="map-frame">
              <iframe
                src="${escapeHtml(embedUrl)}"
                title="${escapeHtml(`${episode.title} case location map`)}"
                loading="lazy"
              ></iframe>
            </div>`
          : ""
      }
      <div class="map-location-list">
        ${locations
          .map(
            (location) => `
              <article class="map-location">
                <h3>${escapeHtml(location.label)}</h3>
                ${
                  location.address
                    ? `<p>${escapeHtml(location.address)}</p>`
                    : ""
                }
                ${
                  location.note
                    ? `<p>${escapeHtml(location.note)}</p>`
                    : ""
                }
                <a href="${escapeHtml(mapSearchUrl(location))}" target="_blank" rel="noopener">Open map</a>
              </article>`
          )
          .join("")}
      </div>
    </section>`;
};

const LOCATION_STOP_WORDS = new Set([
  "And",
  "But",
  "Case",
  "Episode",
  "Facebook",
  "Friday",
  "Monday",
  "Podcast",
  "Saturday",
  "Sunday",
  "Thursday",
  "Tuesday",
  "Wednesday",
  "YouTube"
]);

const inferLocationSuggestions = (episode) => {
  const text = [
    episode.title,
    episode.summary,
    ...(episode.body ?? []),
    ...(episode.transcriptContent?.paragraphs ?? [])
  ]
    .join("\n")
    .replace(/\s+/g, " ");
  const candidates = new Map();
  const patterns = [
    /\b(?:in|near|from|at|around|outside|inside|through|toward|towards|between)\s+([A-Z][A-Za-z.'-]+(?:\s+(?:and|of|the|[A-Z][A-Za-z.'-]+)){0,5}(?:,\s*[A-Z]{2})?)/g,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3},\s*[A-Z]{2})\b/g
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1]
        .replace(/[.;:!?)]*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const firstWord = candidate.split(/\s+/)[0];

      if (
        candidate.length < 4 ||
        candidate.length > 120 ||
        LOCATION_STOP_WORDS.has(firstWord) ||
        /^\d+$/.test(candidate)
      ) {
        continue;
      }

      const key = candidate.toLowerCase();
      candidates.set(key, candidate);
    }
  }

  return [...candidates.values()].slice(0, 12);
};

const renderTranscript = (episode) => {
  if (!episode.transcriptContent?.paragraphs?.length) {
    return "";
  }

  const visibleParagraphs = episode.transcriptContent.paragraphs.slice(0, 3);
  const remainingParagraphs = episode.transcriptContent.paragraphs.slice(3);
  const transcriptPreview = visibleParagraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

  return `
    <section class="episode-transcript" id="transcript" aria-labelledby="transcript-title">
      <p class="section-kicker">Full text</p>
      <h2 id="transcript-title">${escapeHtml(episode.title)} transcript</h2>
      <p class="transcript-intro">Episode transcript.</p>
      <div class="transcript-preview">
        ${transcriptPreview}
      </div>
      ${
        remainingParagraphs.length
          ? `<details class="transcript-details">
              <summary>Read full transcript</summary>
              <div class="transcript-copy">
                ${remainingParagraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
              </div>
            </details>`
          : ""
      }
      <a class="transcript-source" href="${escapeHtml(
        episode.transcriptContent.sourceUrl
      )}" target="_blank" rel="noopener">View original transcript</a>
      <a class="back-to-top" href="#episode-title">Back to top</a>
    </section>`;
};

const renderGoogleAnalytics = (measurementId) => {
  if (!measurementId) {
    return "";
  }

  const safeMeasurementId = escapeHtml(measurementId);

  return `
    <script async src="https://www.googletagmanager.com/gtag/js?id=${safeMeasurementId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${safeMeasurementId}');
    </script>`;
};

const renderFacebookPixel = (pixelId) => {
  if (!pixelId) {
    return "";
  }

  const safePixelId = safeJson(String(pixelId));

  return `
    <script>
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
      (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', ${safePixelId});
      fbq('track', 'PageView');
    </script>`;
};

const renderHead = ({
  title,
  description,
  image = podcast.heroImage,
  facebookPixelId = "",
  extraHead = ""
}) => `
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer-when-downgrade" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    ${extraHead}
    ${renderGoogleAnalytics(podcast.googleAnalyticsId)}
    ${renderFacebookPixel(facebookPixelId)}
    <style>${styles}</style>
  </head>`;

const styles = `
  :root {
    color-scheme: dark;
    --ink: #101215;
    --coal: #191d20;
    --paper: #f4efe7;
    --muted: #b9b0a4;
    --teal: #426d71;
    --rust: #9d3f36;
    --gold: #d4ad67;
    --line: rgba(244, 239, 231, 0.18);
  }

  * {
    box-sizing: border-box;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  body {
    margin: 0;
    min-width: 320px;
    background: var(--ink);
    color: var(--paper);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.5;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  .site-shell {
    min-height: 100vh;
    background:
      linear-gradient(90deg, rgba(16, 18, 21, 0.96) 0%, rgba(16, 18, 21, 0.78) 45%, rgba(16, 18, 21, 0.2) 100%),
      image-set(url("${escapeHtml(podcast.heroImage)}") 1x);
    background-position: center;
    background-size: cover;
  }

  .page-shell {
    min-height: 100vh;
    background:
      linear-gradient(90deg, rgba(16, 18, 21, 0.98) 0%, rgba(16, 18, 21, 0.9) 58%, rgba(16, 18, 21, 0.5) 100%),
      image-set(url("${escapeHtml(podcast.heroImage)}") 1x);
    background-position: center;
    background-size: cover;
  }

  .topbar,
  .hero,
  .section {
    width: min(1120px, calc(100% - 40px));
    margin: 0 auto;
  }

  .topbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(220px, 270px);
    align-items: center;
    gap: 14px 24px;
    padding: 22px 0;
    border-bottom: 1px solid var(--line);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    font-size: 0.92rem;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    flex: 0 0 38px;
    border: 1px solid rgba(212, 173, 103, 0.55);
    background: rgba(16, 18, 21, 0.56);
    color: var(--gold);
    font-family: Georgia, serif;
    font-size: 1.05rem;
  }

  .nav {
    display: flex;
    grid-column: 1 / -1;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    color: var(--muted);
    font-size: 0.92rem;
  }

  .nav a {
    white-space: nowrap;
  }

  .nav a:hover {
    color: var(--paper);
  }

  .site-search {
    display: flex;
    width: min(270px, 100%);
    min-width: 190px;
    justify-self: end;
  }

  .site-search input,
  .search-page-form input {
    min-width: 0;
    flex: 1;
    border: 1px solid rgba(244, 239, 231, 0.28);
    background: rgba(16, 18, 21, 0.68);
    color: var(--paper);
    font: inherit;
  }

  .site-search input {
    padding: 9px 11px;
    border-right: 0;
  }

  .site-search button,
  .search-page-form button {
    border: 1px solid var(--gold);
    background: var(--gold);
    color: var(--ink);
    cursor: pointer;
    font: inherit;
    font-weight: 900;
  }

  .site-search button {
    padding: 0 12px;
  }

  .site-search input::placeholder,
  .search-page-form input::placeholder {
    color: #c8bfb3;
  }

  .hero {
    display: grid;
    min-height: calc(100vh - 84px);
    padding: 68px 0 54px;
    align-items: center;
  }

  .episode-hero {
    display: grid;
    grid-template-columns: minmax(0, 0.82fr) minmax(320px, 0.58fr);
    gap: 42px;
    min-height: auto;
    padding: 64px 0;
    align-items: start;
  }

  .episode-hero h1 {
    font-size: clamp(2.65rem, 6vw, 5.6rem);
    line-height: 0.98;
  }

  .episode-hero .lede {
    max-width: 680px;
    line-height: 1.55;
  }

  .search-hero {
    min-height: auto;
    padding: 70px 0;
  }

  .search-hero h1 {
    font-size: clamp(3rem, 7vw, 6rem);
  }

  .hero-copy {
    width: min(680px, 100%);
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 20px;
    color: var(--gold);
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .eyebrow::before {
    content: "";
    width: 34px;
    height: 1px;
    background: var(--rust);
  }

  h1 {
    margin: 0;
    max-width: 760px;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(3.2rem, 8vw, 7rem);
    line-height: 0.92;
    letter-spacing: 0;
  }

  .lede {
    max-width: 600px;
    margin: 24px 0 0;
    color: #ddd5ca;
    font-size: clamp(1.05rem, 2vw, 1.35rem);
  }

  .episode-published {
    margin: 18px 0 0;
    color: var(--gold);
    font-size: 0.86rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .back-link {
    display: inline-flex;
    margin-bottom: 22px;
    color: var(--muted);
    font-weight: 800;
  }

  .back-link:hover {
    color: var(--paper);
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 34px;
  }

  .button {
    display: inline-flex;
    min-height: 46px;
    align-items: center;
    justify-content: center;
    padding: 0 20px;
    border: 1px solid transparent;
    background: var(--paper);
    color: var(--ink);
    font-weight: 800;
  }

  .button.secondary {
    border-color: var(--line);
    background: rgba(16, 18, 21, 0.54);
    color: var(--paper);
  }

  main {
    background: #f7f2ea;
    color: #171717;
  }

  .section {
    padding: 64px 0;
  }

  .episode-layout {
    display: grid;
    grid-template-columns: minmax(0, 0.68fr) minmax(320px, 1fr);
    gap: 36px;
    align-items: start;
  }

  .episode-player-list {
    display: grid;
    gap: 28px;
    margin-top: 30px;
  }

  .landing-episode-player {
    display: grid;
    grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
    gap: 30px;
    padding: 28px;
    scroll-margin-top: 24px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
  }

  .landing-episode-player:target {
    border-color: var(--rust);
    box-shadow: 0 0 0 4px rgba(157, 63, 54, 0.14), 0 18px 48px rgba(20, 15, 12, 0.14);
  }

  .landing-episode-art-link {
    align-self: start;
  }

  .landing-episode-art {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    object-fit: cover;
  }

  .landing-episode-content {
    min-width: 0;
  }

  .landing-episode-content h2 {
    font-size: clamp(1.75rem, 3.5vw, 2.8rem);
  }

  .episode-links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    margin: 16px 0;
    color: var(--rust);
    font-weight: 800;
  }

  .featured-art {
    width: min(100%, 320px);
    aspect-ratio: 1;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: 0 18px 48px rgba(20, 15, 12, 0.14);
  }

  .episode-detail-layout {
    max-width: 820px;
  }

  .episode-jump-nav {
    position: sticky;
    top: 0;
    z-index: 4;
    display: flex;
    width: min(1120px, calc(100% - 40px));
    align-items: center;
    gap: 14px;
    margin: 0 auto;
    padding: 14px 0;
    border-bottom: 1px solid #d8cab7;
    background: #f7f2ea;
    color: #332d28;
  }

  .episode-jump-nav span {
    flex: 0 0 auto;
    color: var(--rust);
    font-size: 0.78rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .episode-jump-nav div {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .episode-jump-nav a {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    padding: 0 12px;
    border: 1px solid #d8cab7;
    border-radius: 999px;
    background: #fffaf2;
    font-size: 0.88rem;
    font-weight: 900;
  }

  .episode-jump-nav a:hover {
    border-color: rgba(157, 63, 54, 0.58);
    color: var(--rust);
  }

  .episode-body {
    color: #332d28;
    font-size: 1.08rem;
  }

  .episode-body p {
    margin: 0 0 18px;
  }

  .episode-article {
    margin-top: 42px;
    margin-bottom: 42px;
    padding-bottom: 42px;
    padding-top: 36px;
    border-top: 1px solid #d8cab7;
    border-bottom: 1px solid #d8cab7;
  }

  .article-context {
    margin: 12px 0 0;
    color: #61584f;
    font-size: 0.98rem;
    line-height: 1.6;
  }

  .article-updated {
    margin: 10px 0 0;
    color: #61584f;
    font-size: 0.88rem;
    font-weight: 800;
  }

  .article-excerpt {
    margin: 18px 0 0;
    color: #4d453d;
    font-size: 1.08rem;
    font-weight: 800;
    line-height: 1.7;
  }

  .article-body {
    margin-top: 28px;
    color: #332d28;
    font-size: 1.08rem;
    line-height: 1.82;
  }

  .article-body h2,
  .article-body h3 {
    margin: 34px 0 14px;
  }

  .article-body p,
  .article-body ul,
  .article-body blockquote {
    margin: 0 0 20px;
  }

  .article-body ul {
    padding-left: 24px;
  }

  .article-body blockquote {
    padding: 16px 18px;
    border-left: 4px solid var(--rust);
    background: #fffaf2;
    color: #4d453d;
  }

  .article-body a {
    color: var(--rust);
    font-weight: 900;
    text-decoration: underline;
    text-decoration-thickness: 1px;
  }

  .breadcrumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 22px;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .breadcrumbs a {
    font-weight: 800;
  }

  .breadcrumbs a:hover {
    color: var(--paper);
  }

  .episode-video {
    margin-bottom: 42px;
    padding-bottom: 42px;
    border-bottom: 1px solid #d8cab7;
  }

  .episode-map {
    margin-bottom: 42px;
    padding-bottom: 42px;
    border-bottom: 1px solid #d8cab7;
  }

  .map-frame {
    width: 100%;
    aspect-ratio: 16 / 9;
    margin-top: 22px;
    overflow: hidden;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #e7dccd;
    box-shadow: 0 18px 48px rgba(20, 15, 12, 0.14);
  }

  .map-frame iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }

  .map-location-list {
    display: grid;
    gap: 14px;
    margin-top: 18px;
  }

  .map-location {
    padding: 16px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
  }

  .map-location h3 {
    margin: 0 0 8px;
  }

  .map-location p {
    margin: 0 0 8px;
    color: #61584f;
  }

  .map-location a {
    color: var(--rust);
    font-weight: 900;
  }

  .video-player {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    margin-top: 22px;
    overflow: hidden;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #101215;
    box-shadow: 0 18px 48px rgba(20, 15, 12, 0.14);
  }

  .spotify-video-overview {
    display: grid;
    grid-template-columns: minmax(120px, 220px) 1fr;
    gap: 22px;
    align-items: center;
    margin-top: 22px;
    padding: 18px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
    color: var(--ink);
    text-decoration: none;
    box-shadow: 0 18px 48px rgba(20, 15, 12, 0.14);
  }

  .spotify-video-overview img {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 6px;
    object-fit: cover;
  }

  .spotify-video-overview > span {
    display: grid;
    gap: 10px;
  }

  .spotify-video-overview strong {
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.25rem, 3vw, 2rem);
  }

  .spotify-video-overview span span {
    color: #1b7f3a;
    font-weight: 900;
  }

  .video-player iframe,
  .video-player video {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: #101215;
  }

  .spotify-video-overview-link {
    position: absolute;
    inset: 0;
    display: block;
    color: inherit;
    text-decoration: none;
  }

  .spotify-video-overview-link img {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    object-fit: cover;
  }

  .spotify-video-overview-link .button {
    position: absolute;
    left: 50%;
    bottom: 24px;
    z-index: 1;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .video-player-hosted {
    isolation: isolate;
  }

  .video-ad-container {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: block;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    background: #101215;
    transform: translateZ(0);
  }

  .video-ad-container.active {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
  }

  .video-ad-container.painting {
    transform: translate3d(0, 0, 0) scale(1.0001);
  }

  .video-ad-container iframe,
  .video-ad-container video,
  .video-ad-container > div,
  .video-ad-container > div > div {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  .video-ad-skip {
    position: absolute;
    right: 14px;
    bottom: 14px;
    z-index: 10;
    display: inline-flex;
    opacity: 0;
    pointer-events: none;
    min-height: 40px;
    align-items: center;
    padding: 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.72);
    border-radius: 4px;
    background: rgba(16, 18, 21, 0.9);
    color: white;
    cursor: pointer;
    font: inherit;
    font-weight: 900;
  }

  .video-ad-skip.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .video-ad-start {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
    border: 0;
    background: rgba(16, 18, 21, 0.42);
    color: white;
    cursor: pointer;
    font: inherit;
    font-size: 1.05rem;
    font-weight: 900;
  }

  .video-ad-start span {
    font-size: 1.4rem;
  }

  .video-ad-start[hidden] {
    display: none;
  }

  .episode-attachments {
    margin-bottom: 42px;
    padding-bottom: 42px;
    border-bottom: 1px solid #d8cab7;
  }

  .episode-transcript {
    margin-top: 48px;
    padding-top: 42px;
    border-top: 1px solid #d8cab7;
  }

  .transcript-intro {
    color: #61584f;
  }

  .transcript-preview {
    margin-top: 22px;
    color: #332d28;
    font-size: 1.02rem;
    line-height: 1.8;
  }

  .transcript-preview p {
    margin: 0 0 18px;
  }

  .transcript-details {
    margin-top: 22px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
  }

  .transcript-details summary {
    padding: 18px;
    color: var(--rust);
    cursor: pointer;
    font-weight: 900;
  }

  .transcript-details[open] summary {
    border-bottom: 1px solid #d8cab7;
  }

  .transcript-copy {
    max-height: 760px;
    overflow-y: auto;
    padding: 22px;
    color: #332d28;
  }

  .transcript-copy p {
    margin: 0 0 18px;
  }

  .transcript-source {
    display: inline-flex;
    margin-top: 16px;
    color: var(--rust);
    font-weight: 900;
  }

  .back-to-top {
    display: inline-flex;
    margin-top: 18px;
    color: var(--rust);
    font-weight: 900;
  }

  .attachment-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-top: 26px;
  }

  .attachment-card {
    overflow: hidden;
    margin: 0;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
  }

  .attachment-card h3 {
    margin: 0 0 8px;
    font-size: 1.18rem;
  }

  .attachment-card p {
    margin: 0 0 14px;
    color: #61584f;
  }

  .attachment-image img {
    display: block;
    width: 100%;
    max-height: 440px;
    object-fit: contain;
    background: #e7dccd;
  }

  .pdf-preview {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 5;
    overflow: hidden;
    border-bottom: 1px solid #d8cab7;
    background: #e7dccd;
  }

  .pdf-preview iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: white;
  }

  .attachment-image figcaption,
  .attachment-file {
    padding: 18px;
  }

  .attachment-type {
    color: var(--rust) !important;
    font-size: 0.76rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .attachment-meta {
    font-size: 0.86rem;
  }

  .attachment-link {
    color: var(--rust);
    font-weight: 800;
  }

  .related-episodes {
    width: min(1120px, calc(100% - 40px));
    margin: 0 auto;
    padding: 0 0 64px;
  }

  .related-episode-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-top: 26px;
  }

  .related-episode-card {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
  }

  .related-episode-card:hover {
    border-color: rgba(157, 63, 54, 0.48);
    box-shadow: 0 14px 32px rgba(20, 15, 12, 0.1);
  }

  .related-episode-image {
    width: 92px;
    height: 92px;
    border-radius: 6px;
    object-fit: cover;
  }

  .related-episode-card > span {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  .related-episode-card small {
    color: var(--teal);
    font-weight: 900;
    text-transform: uppercase;
  }

  .related-episode-card strong {
    line-height: 1.25;
  }

  .related-episode-card > span > span {
    display: -webkit-box;
    overflow: hidden;
    color: #61584f;
    font-size: 0.88rem;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .all-episodes-link {
    display: inline-flex;
    margin-top: 20px;
    color: var(--rust);
    font-weight: 900;
  }

  .secondary-dark {
    border-color: #c9b9a5;
    background: transparent;
    color: #201c19;
  }

  .admin-shell {
    min-height: 100vh;
    padding: 40px 20px;
    background: #f7f2ea;
    color: #171717;
  }

  .admin-panel {
    width: min(920px, 100%);
    margin: 0 auto 24px;
    padding: 28px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
  }

  .admin-panel h1 {
    color: #171717;
    font-size: clamp(2.4rem, 6vw, 4.6rem);
  }

  .admin-form {
    display: grid;
    gap: 16px;
    margin-top: 28px;
  }

  .admin-form label {
    display: grid;
    gap: 7px;
    font-weight: 800;
  }

  .admin-form input,
  .admin-form select,
  .admin-form textarea {
    width: 100%;
    padding: 12px;
    border: 1px solid #bba991;
    border-radius: 5px;
    background: white;
    color: #171717;
    font: inherit;
  }

  .admin-form textarea {
    min-height: 110px;
    resize: vertical;
  }

  .admin-form fieldset {
    display: grid;
    gap: 14px;
    margin: 8px 0 0;
    padding: 18px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
  }

  .admin-form legend {
    padding: 0 8px;
    font-weight: 900;
  }

  .admin-file-slot {
    display: grid;
    gap: 12px;
    padding: 16px 0;
    border-top: 1px solid #e5d9c9;
  }

  .admin-file-slot:first-of-type {
    border-top: 0;
    padding-top: 4px;
  }

  .admin-checkbox {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 800;
  }

  .admin-checkbox input {
    width: auto;
  }

  .admin-form .admin-large-textarea {
    min-height: 420px;
    line-height: 1.6;
  }

  .admin-field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .admin-suggestion-panel {
    margin-top: 22px;
    padding: 16px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #f7f2ea;
  }

  .admin-suggestion-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
  }

  .suggestion-button {
    min-height: 38px;
    padding: 0 12px;
    border: 1px solid #bba991;
    border-radius: 4px;
    background: #fffaf2;
    color: var(--rust);
    cursor: pointer;
    font: inherit;
    font-weight: 900;
  }

  .admin-notice {
    padding: 12px 14px;
    border-left: 4px solid var(--teal);
    background: #e4eeec;
  }

  .admin-episode {
    padding: 20px 0;
    border-top: 1px solid #d8cab7;
  }

  .admin-episode:first-child {
    border-top: 0;
  }

  .admin-attachment {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 20px;
    align-items: center;
    padding: 12px 0;
  }

  .danger-button {
    min-height: 38px;
    border: 1px solid #9d3f36;
    border-radius: 4px;
    background: transparent;
    color: #8a3029;
    cursor: pointer;
    font: inherit;
    font-weight: 800;
  }

  .episode-meta {
    display: grid;
    gap: 14px;
    padding: 20px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
  }

  .episode-play-panel {
    display: grid;
    gap: 14px;
    align-self: center;
    padding: 18px;
    border: 1px solid rgba(244, 239, 231, 0.22);
    border-radius: 8px;
    background: rgba(16, 18, 21, 0.72);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
  }

  .episode-meta-image {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    object-fit: cover;
  }

  .episode-play-panel .episode-meta-image {
    max-height: 260px;
  }

  .episode-play-panel .section-kicker {
    margin: 0;
    color: var(--gold);
  }

  .episode-play-panel .button {
    width: 100%;
  }

  .episode-play-panel .transcript-button {
    border-color: rgba(244, 239, 231, 0.3);
    background: transparent;
    color: var(--paper);
  }

  .episode-meta p {
    margin: 0;
    color: #61584f;
  }

  .section-kicker {
    margin: 0 0 10px;
    color: var(--rust);
    font-size: 0.78rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(2rem, 4vw, 3.4rem);
    line-height: 1;
    letter-spacing: 0;
  }

  .episode-summary {
    margin: 18px 0 0;
    color: #554d45;
    font-size: 1.05rem;
  }

  .case-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 28px;
  }

  .category-section {
    padding-bottom: 22px;
  }

  .category-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.55fr);
    gap: 30px;
    align-items: end;
  }

  .category-heading p {
    margin: 0;
    color: #61584f;
  }

  .category-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    margin-top: 28px;
  }

  .category-card {
    display: grid;
    gap: 8px;
    min-height: 180px;
    padding: 20px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
    transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }

  .category-card:hover,
  .category-card.active {
    border-color: rgba(157, 63, 54, 0.58);
    box-shadow: 0 16px 36px rgba(20, 15, 12, 0.1);
    transform: translateY(-2px);
  }

  .category-card.active {
    background: #f3e4d7;
  }

  .category-count {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: var(--teal);
    color: white;
    font-size: 0.8rem;
    font-weight: 900;
  }

  .category-card strong {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.28rem;
  }

  .category-card > span:last-child {
    color: #61584f;
    font-size: 0.92rem;
  }

  .case-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
  }

  .pagination-summary {
    margin: 14px 0 0;
    color: #61584f;
  }

  .pagination {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 32px;
  }

  .pagination-pages {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .pagination-link,
  .pagination-number {
    display: inline-flex;
    min-width: 42px;
    min-height: 42px;
    align-items: center;
    justify-content: center;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
    color: #332d28;
    font-weight: 900;
  }

  .pagination-link {
    padding: 0 16px;
  }

  .pagination-link:hover,
  .pagination-number:hover,
  .pagination-number.active {
    border-color: rgba(157, 63, 54, 0.58);
    background: #f3e4d7;
    color: var(--rust);
  }

  .pagination-link.disabled {
    opacity: 0.46;
    pointer-events: none;
  }

  .clear-category {
    color: var(--rust);
    font-weight: 900;
  }

  .case-card {
    display: block;
    min-height: 360px;
    padding: 14px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
    color: inherit;
    transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }

  .case-card-image {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    margin-bottom: 16px;
    border-radius: 6px;
    object-fit: cover;
    background: #e7dccd;
  }

  a.case-card:hover {
    border-color: rgba(157, 63, 54, 0.48);
    box-shadow: 0 18px 42px rgba(20, 15, 12, 0.12);
    transform: translateY(-2px);
  }

  .case-card p {
    margin: 0 0 18px;
    color: var(--teal);
    font-size: 0.76rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .case-card h3 {
    margin: 0 0 10px;
    font-size: 1.18rem;
  }

  .case-card span {
    color: #61584f;
  }

  .search-results-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
  }

  .search-results-heading p {
    margin: 0;
    color: #61584f;
  }

  .search-page-form {
    display: flex;
    width: min(620px, 100%);
    margin-top: 28px;
  }

  .search-page-form input {
    padding: 14px;
    border-color: #bba991;
    background: white;
    color: #171717;
  }

  .search-page-form button {
    padding: 0 20px;
  }

  .search-empty {
    margin-top: 28px;
    padding: 24px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
    color: #61584f;
  }

  .static-page {
    max-width: 860px;
    padding-top: 64px;
    padding-bottom: 64px;
  }

  .static-page h1 {
    max-width: 760px;
    color: #201b17;
    font-size: clamp(2.6rem, 6vw, 5rem);
  }

  .static-page-content {
    margin-top: 28px;
    color: #332d28;
    font-size: 1.08rem;
    line-height: 1.8;
  }

  .static-page-content p {
    margin: 0 0 20px;
  }

  .static-page-updated {
    color: #61584f;
    font-weight: 800;
  }

  .static-page-content .button {
    width: auto;
    margin-top: 10px;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding-top: 30px;
    border-top: 1px solid #d8cab7;
    color: #61584f;
    font-size: 0.95rem;
  }

  .footer-copy {
    max-width: 560px;
  }

  .footer-copy p {
    margin: 8px 0 0;
    line-height: 1.6;
  }

  .footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }

  .footer-links a:hover {
    color: var(--rust);
  }

  @media (max-width: 820px) {
    .site-shell {
      background:
        linear-gradient(180deg, rgba(16, 18, 21, 0.92) 0%, rgba(16, 18, 21, 0.74) 55%, rgba(16, 18, 21, 0.42) 100%),
        image-set(url("${escapeHtml(podcast.heroImage)}") 1x);
      background-position: 62% center;
      background-size: cover;
    }

    .topbar {
      grid-template-columns: minmax(0, 1fr) minmax(210px, 320px);
    }

    .nav {
      width: 100%;
      justify-content: flex-start;
      gap: 10px 14px;
      order: 3;
      font-size: 0.86rem;
    }

    .site-search {
      width: min(320px, 48vw);
      order: 2;
    }

    .hero {
      min-height: 720px;
      align-items: end;
      padding-top: 44px;
    }

    .episode-hero {
      min-height: auto;
      padding: 44px 0 54px;
    }

    .episode-layout,
    .landing-episode-player,
    .episode-hero,
    .case-grid,
    .category-grid,
    .attachment-grid,
    .related-episode-grid {
      grid-template-columns: 1fr;
    }

    .landing-episode-art {
      width: min(100%, 260px);
    }

    .spotify-video-overview {
      grid-template-columns: 1fr;
    }

    .episode-jump-nav {
      align-items: start;
      flex-direction: column;
    }

    .episode-jump-nav div {
      width: 100%;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .episode-jump-nav a {
      flex: 0 0 auto;
      white-space: nowrap;
    }

    .category-heading {
      grid-template-columns: 1fr;
    }

    .admin-field-grid {
      grid-template-columns: 1fr;
    }

    .footer {
      display: grid;
    }
  }

  @media (max-width: 520px) {
    .topbar {
      grid-template-columns: 1fr;
    }

    .brand,
    .nav,
    .site-search {
      grid-column: 1;
      width: 100%;
    }

    .nav {
      order: 2;
    }

    .site-search {
      width: 100%;
      min-width: 0;
      order: 3;
    }

    .topbar,
    .hero,
    .section,
    .related-episodes {
      width: min(100% - 28px, 1120px);
    }

    h1 {
      font-size: 3.2rem;
    }

    .hero-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .button {
      width: 100%;
    }

    .search-results-heading {
      display: grid;
    }

    .case-heading {
      display: grid;
    }
  }
`;

const renderStaticPage = (page, analytics = {}) => `<!doctype html>
<html lang="en">
  ${renderHead({
    title: `${page.title} | ${podcast.name}`,
    description: page.description,
    facebookPixelId: analytics.facebookPixelId
  })}
  <body>
    <div class="page-shell">
      ${renderSiteHeader()}

      <section class="hero episode-hero" aria-labelledby="static-page-title">
        <div class="hero-copy">
          <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a href="/">Home</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">${escapeHtml(page.title)}</span>
          </nav>
          <p class="eyebrow">${escapeHtml(page.kicker)}</p>
          <h1 id="static-page-title">${escapeHtml(page.heading)}</h1>
          <p class="lede">${escapeHtml(page.description)}</p>
        </div>
      </section>
    </div>

    <main>
      <article class="section static-page">
        <p class="section-kicker">${escapeHtml(page.kicker)}</p>
        <h1>${escapeHtml(page.heading)}</h1>
        <div class="static-page-content">
          ${page.updated ? `<p class="static-page-updated">${escapeHtml(page.updated)}</p>` : ""}
          ${page.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
          ${
            page.cta
              ? `<p><a class="button" href="${escapeHtml(page.cta.href)}">${escapeHtml(
                  page.cta.label
                )}</a></p>`
              : ""
          }
        </div>
      </article>
      ${renderFooter()}
    </main>
    ${renderPageViewNotification()}
  </body>
</html>`;

const renderPage = (
  episodes,
  featuredEpisode = episodes[0],
  categories = buildEpisodeCategories(episodes),
  selectedCategory = null,
  requestedPage = 1,
  analytics = {},
  showAllEpisodePlayers = false
) => {
  const activeCategory = categories.find((category) => category.slug === selectedCategory);
  const visibleEpisodes = activeCategory?.episodes ?? episodes;
  const totalPages = Math.max(1, Math.ceil(visibleEpisodes.length / EPISODES_PER_PAGE));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const pageStart = (currentPage - 1) * EPISODES_PER_PAGE;
  const paginatedEpisodes = visibleEpisodes.slice(pageStart, pageStart + EPISODES_PER_PAGE);
  const firstVisibleEpisode = visibleEpisodes.length ? pageStart + 1 : 0;
  const lastVisibleEpisode = Math.min(pageStart + paginatedEpisodes.length, visibleEpisodes.length);
  const landingFeaturedEpisode = showAllEpisodePlayers
    ? visibleEpisodes[0] ?? featuredEpisode
    : featuredEpisode;
  const pageTitle = activeCategory
    ? `${activeCategory.label} Episodes | ${podcast.name}`
    : podcast.name;
  const title = currentPage > 1 && !showAllEpisodePlayers
    ? `${pageTitle} | Page ${currentPage}`
    : pageTitle;

  return `<!doctype html>
<html lang="en">
  ${renderHead({
    title,
    description: activeCategory?.description ?? podcast.description,
    facebookPixelId: analytics.facebookPixelId,
    extraHead: '<meta name="msvalidate.01" content="2C1F3DCBA6D63B5423690DD0F356E1A1" />'
  })}
  <body>
    <div class="site-shell">
      ${renderSiteHeader({ home: true })}

      <section class="hero" aria-labelledby="page-title">
        <div class="hero-copy">
          <p class="eyebrow">True crime podcast</p>
          <h1 id="page-title">${escapeHtml(podcast.name)}</h1>
          <p class="lede">${escapeHtml(podcast.tagline)}</p>
          <div class="hero-actions">
            <a class="button" href="${showAllEpisodePlayers
              ? `#${escapeHtml(episodeAnchor(landingFeaturedEpisode))}`
              : "#listen"
            }">Listen now</a>
            <a class="button secondary" href="${escapeHtml(episodePath(landingFeaturedEpisode))}">Episode details</a>
          </div>
        </div>
      </section>
    </div>

    <main>
      ${showAllEpisodePlayers ? "" : `
      <section class="section episode-layout" id="listen">
        <div>
          <a href="${escapeHtml(episodePath(featuredEpisode))}">
            ${renderEpisodeImage(featuredEpisode, "featured-art")}
          </a>
        </div>
        <div>
          <p class="section-kicker">Latest episode</p>
          <h2>
            <a href="${escapeHtml(episodePath(featuredEpisode))}">
              ${escapeHtml(featuredEpisode.title)}
            </a>
          </h2>
          <p class="episode-summary">${escapeHtml(featuredEpisode.summary)}</p>
        </div>
      </section>`}

      ${renderCategoryBrowser(categories, activeCategory?.slug ?? null, episodes.length)}

      <section class="section" id="cases">
        <p class="section-kicker">Case files</p>
        <div class="case-heading">
          <div>
            <h2>${
              activeCategory
                ? escapeHtml(activeCategory.label)
                : "Built around timelines, records, and what can be verified."
            }</h2>
            <p class="pagination-summary">${showAllEpisodePlayers
              ? `Showing all ${escapeHtml(visibleEpisodes.length)} episodes`
              : `Showing ${escapeHtml(firstVisibleEpisode)}-${escapeHtml(lastVisibleEpisode)} of ${escapeHtml(visibleEpisodes.length)} episodes`
            }</p>
          </div>
          ${
            activeCategory
              ? '<a class="clear-category" href="/#cases">View all episodes</a>'
              : ""
          }
        </div>
        ${showAllEpisodePlayers
          ? `<div class="episode-player-list">${renderLandingEpisodePlayers(visibleEpisodes)}</div>`
          : `<div class="case-grid">${renderCases(paginatedEpisodes)}</div>
             ${renderPagination(currentPage, totalPages, activeCategory?.slug ?? null)}`
        }
      </section>

      ${renderFooter()}
    </main>

    ${renderPageViewNotification()}
    ${renderPlaybackTracking(
      showAllEpisodePlayers ? visibleEpisodes : [featuredEpisode],
      analytics.countryCode
    )}
  </body>
</html>`;
};

const renderEpisodePage = (episode, episodes, analytics = {}) => {
  const relatedEpisodes = selectRelatedEpisodes(episode, episodes);
  const videoOverview = renderVideoOverview(episode);
  const episodeMap = renderEpisodeMap(episode);
  const attachments = renderAttachments(episode);
  const companionArticle = renderEpisodeArticle(episode);
  const transcript = renderTranscript(episode);

  return `<!doctype html>
<html lang="en">
  ${renderHead({
    title: `${episode.title} | ${podcast.name}`,
    description: episode.summary,
    image: episode.image,
    facebookPixelId: analytics.facebookPixelId
  })}
  <body>
    <div class="page-shell">
      ${renderSiteHeader()}

      <section class="hero episode-hero" aria-labelledby="episode-title">
        <div class="hero-copy">
          <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a href="/">Home</a>
            <span aria-hidden="true">/</span>
            <a href="/#cases">Episodes</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">${escapeHtml(episode.title)}</span>
          </nav>
          <p class="eyebrow">${escapeHtml(episode.status)}</p>
          <h1 id="episode-title">${escapeHtml(episode.title)}</h1>
          <p class="episode-published">Published ${escapeHtml(episode.publishedAt ?? "Episode")}</p>
          <p class="lede">${escapeHtml(episode.detail ?? episode.summary)}</p>
        </div>
        <aside class="episode-play-panel" aria-label="Listen to this episode">
          ${renderEpisodeImage(episode, "episode-meta-image")}
          <p class="section-kicker">${escapeHtml(episode.publishedAt ?? "Episode")}</p>
          <a class="button" href="${escapeHtml(episode.href)}">Listen on Spotify</a>
          ${
            episode.transcriptContent
              ? '<a class="button transcript-button" href="#transcript">Read episode transcript</a>'
              : ""
          }
        </aside>
      </section>
    </div>

    <main>
      ${renderEpisodeJumpNav(episode, relatedEpisodes)}
      <article class="section episode-detail-layout">
        ${videoOverview}
        ${episodeMap}
        ${attachments}
        ${companionArticle}
        ${transcript}
      </article>
      ${renderRelatedEpisodes(episode, relatedEpisodes)}
      ${renderFooter({
        disclaimer: "We do not glorify violent crime or offenders."
      })}
    </main>

    ${renderPageViewNotification()}
    ${renderEpisodeJumpNavTracking(episode, analytics.countryCode)}
  </body>
</html>`;
};

const renderSearchPage = (query, results, analytics = {}) => {
  const hasQuery = query.length > 0;
  const resultLabel = `${results.length} episode${results.length === 1 ? "" : "s"} found`;

  return `<!doctype html>
<html lang="en">
  ${renderHead({
    title: hasQuery ? `Search results for "${query}" | ${podcast.name}` : `Search | ${podcast.name}`,
    description: hasQuery
      ? `Search results for ${query} from ${podcast.name}.`
      : `Search podcast episodes from ${podcast.name}.`
  })}
  <body>
    <div class="page-shell">
      ${renderSiteHeader({ query })}
      <section class="hero search-hero" aria-labelledby="search-title">
        <div class="hero-copy">
          <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a href="/">Home</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Search</span>
          </nav>
          <p class="eyebrow">Episode search</p>
          <h1 id="search-title">Search the case files</h1>
          ${renderSearchForm(query, "search-page-form")}
        </div>
      </section>
    </div>
    <main>
      <section class="section">
        <div class="search-results-heading">
          <div>
            <p class="section-kicker">Search results</p>
            <h2>${hasQuery ? `Results for "${escapeHtml(query)}"` : "Find an episode"}</h2>
          </div>
          ${hasQuery ? `<p>${escapeHtml(resultLabel)}</p>` : ""}
        </div>
        ${
          results.length
            ? `<div class="case-grid">${renderCases(results)}</div>`
            : `<div class="search-empty">${
                hasQuery
                  ? `No episodes matched “${escapeHtml(query)}”. Try a person, location, or case name.`
                  : "Enter a person, location, or case name to search all episodes."
              }</div>`
        }
      </section>
      ${renderFooter()}
    </main>
    ${renderPageViewNotification()}
  </body>
</html>`;
};

const renderAdminPage = (episodes, contentByEpisode, notice = "", locationSuggestionData = null) => {
  const episodeOptions = episodes
    .map(
      (episode) =>
        `<option value="${escapeHtml(episode.id)}"${
          locationSuggestionData?.episode?.id === episode.id ? " selected" : ""
        }>${escapeHtml(episode.title)}</option>`
    )
    .join("");
  const renderUploadSlot = (index) => {
    const slotNumber = index + 1;

    return `
      <div class="admin-file-slot">
        <label>
          File ${slotNumber}
          <input type="file" name="file">
        </label>
        <label>
          Display title
          <input name="attachmentTitle" maxlength="140">
        </label>
        <label>
          Description
          <textarea name="attachmentDescription" maxlength="2000"></textarea>
        </label>
      </div>`;
  };
  const uploadSlots = Array.from({ length: 3 }, (_, index) => renderUploadSlot(index)).join("");

  const contentLists = episodes
    .filter((episode) => {
      const content = contentByEpisode.get(episode.id);
      return (
        content?.videoUrl ||
        content?.videoAsset ||
        content?.attachments?.length ||
        content?.mapLocations?.length ||
        normalizeArticle(content?.article).body
      );
    })
    .map((episode) => {
      const content = contentByEpisode.get(episode.id) ?? emptyEpisodeContent();
      const video = parseVideoUrl(content.videoUrl);
      const hostedVideo = normalizeVideoAsset(content.videoAsset);
      const article = normalizeArticle(content.article);
      const articleOverview = article.body
        ? `
            <div class="admin-attachment">
              <div>
                <strong>${escapeHtml(article.title || "Episode article")}</strong>
                <div>${escapeHtml(article.excerpt || `${article.body.slice(0, 140)}...`)}</div>
                ${article.updatedAt ? `<div>Updated ${escapeHtml(article.updatedAt)}</div>` : ""}
              </div>
              <form method="post" action="/admin/content/article">
                <input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}">
                <input type="hidden" name="title" value="">
                <input type="hidden" name="excerpt" value="">
                <input type="hidden" name="body" value="">
                <input type="hidden" name="updatedAt" value="">
                <button class="danger-button" type="submit">Remove</button>
              </form>
            </div>`
        : "";
      const videoOverview = hostedVideo || content.videoUrl
        ? `
            <div class="admin-attachment">
              <div>
                <strong>${
                  hostedVideo
                    ? "Hosted video overview"
                    : video
                      ? "YouTube video overview"
                      : "Unsupported video overview URL"
                }</strong>
                <div><a href="${escapeHtml(
                  hostedVideo ? videoAssetPath(episode.id) : video?.url ?? content.videoUrl
                )}" target="_blank" rel="noopener">${
                  hostedVideo
                    ? escapeHtml(`${hostedVideo.filename} · ${formatFileSize(hostedVideo.size)}`)
                    : escapeHtml(video?.url ?? content.videoUrl)
                }</a></div>
                ${
                  !hostedVideo && !video
                    ? "<div>Replace this with a YouTube link, hosted video, or remove it.</div>"
                    : ""
                }
              </div>
              <form method="post" action="/admin/content/video">
                <input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}">
                <input type="hidden" name="videoUrl" value="">
                <button class="danger-button" type="submit">Remove</button>
              </form>
            </div>`
        : "";
      const mapLocations = normalizeMapLocations(content.mapLocations)
        .map(
          (location) => `
            <div class="admin-attachment">
              <div>
                <strong>${escapeHtml(location.label)}</strong>
                <div>${escapeHtml(location.address || "Coordinates only")}</div>
                ${
                  location.latitude !== null && location.longitude !== null
                    ? `<div>${escapeHtml(location.latitude)}, ${escapeHtml(location.longitude)}</div>`
                    : ""
                }
              </div>
              <form method="post" action="/admin/content/map/delete">
                <input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}">
                <input type="hidden" name="locationId" value="${escapeHtml(location.id)}">
                <button class="danger-button" type="submit">Remove</button>
              </form>
            </div>`
        )
        .join("");
      const attachments = content.attachments
        .map(
          (attachment) => `
            <div class="admin-attachment">
              <div>
                <strong>${escapeHtml(attachment.title)}</strong>
                <div>${escapeHtml(attachment.filename)} · ${escapeHtml(
                  formatFileSize(attachment.size)
                )}</div>
              </div>
              <form method="post" action="/admin/content/delete">
                <input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}">
                <input type="hidden" name="attachmentId" value="${escapeHtml(attachment.id)}">
                <button class="danger-button" type="submit">Delete</button>
              </form>
            </div>`
        )
        .join("");

      return `
        <section class="admin-episode">
          <h3>${escapeHtml(episode.title)}</h3>
          ${articleOverview}
          ${videoOverview}
          ${mapLocations}
          ${attachments}
        </section>`;
    })
    .join("");
  const locationSuggestions = locationSuggestionData
    ? `
        <div class="admin-suggestion-panel">
          <h3>Transcript suggestions for ${escapeHtml(locationSuggestionData.episode.title)}</h3>
          ${
            locationSuggestionData.suggestions.length
              ? `<div class="admin-suggestion-list">
                  ${locationSuggestionData.suggestions
                    .map(
                      (suggestion) => `
                        <form method="post" action="/admin/content/map">
                          <input type="hidden" name="episodeId" value="${escapeHtml(
                            locationSuggestionData.episode.id
                          )}">
                          <input type="hidden" name="label" value="${escapeHtml(suggestion)}">
                          <input type="hidden" name="address" value="${escapeHtml(suggestion)}">
                          <input type="hidden" name="note" value="Suggested from transcript text. Verify before publishing as a case location.">
                          <button class="suggestion-button" type="submit">${escapeHtml(suggestion)}</button>
                        </form>`
                    )
                    .join("")}
                </div>`
              : "<p>No likely location phrases were found in this episode transcript.</p>"
          }
        </div>`
    : "";

  return `<!doctype html>
<html lang="en">
  ${renderHead({
    title: `Episode content | ${podcast.name}`,
    description: "Manage supporting content for podcast episodes."
  })}
  <body>
    <main class="admin-shell">
      <section class="admin-panel">
        <a class="back-link" href="/">Back to site</a>
        <a class="back-link" href="/admin/spreaker">Spreaker dashboard</a>
        <p class="section-kicker">Administration</p>
        <h1>Episode content</h1>
        <p>Manage companion articles, episode media, and map locations.</p>
        ${notice ? `<p class="admin-notice">${escapeHtml(notice)}</p>` : ""}
        <h2>Add a companion article</h2>
        <p>Use this for broader background, themes, or related context. It does not need to mirror the transcript.</p>
        <form class="admin-form" method="post" action="/admin/content/article">
          <label>
            Episode
            <select name="episodeId" required>${episodeOptions}</select>
          </label>
          <label>
            Companion article title
            <input name="title" maxlength="160" placeholder="Background and context">
          </label>
          <label>
            Companion article excerpt
            <textarea name="excerpt" maxlength="500" placeholder="Short introduction shown above the article body"></textarea>
          </label>
          <label>
            Companion article body (Markdown)
            <textarea class="admin-large-textarea" name="body" maxlength="80000" placeholder="Paste the blog post here. Supports ## headings, links, lists, blockquotes, bold, and italic."></textarea>
          </label>
          <label>
            Updated date
            <input name="updatedAt" maxlength="40" placeholder="July 1, 2026">
          </label>
          <button class="button" type="submit">Save article</button>
        </form>
      </section>
      <section class="admin-panel">
        <p class="section-kicker">Episode media</p>
        <h2>Add media in one pass</h2>
        <p>Choose one episode, then save its hosted video, YouTube fallback, and supporting files together.</p>
        <form class="admin-form" method="post" action="/admin/content/media" enctype="multipart/form-data">
          <label>
            Episode
            <select name="episodeId" required>${episodeOptions}</select>
          </label>
          <label>
            Hosted video file (maximum ${escapeHtml(formatFileSize(MAX_VIDEO_UPLOAD_BYTES))})
            <input type="file" name="videoFile" accept="video/*">
          </label>
          <label>
            YouTube overview URL fallback
            <input
              type="url"
              name="videoUrl"
              placeholder="https://www.youtube.com/watch?v=..."
            >
          </label>
          <label class="admin-checkbox">
            <input type="checkbox" name="removeVideo" value="1">
            Remove existing video overview
          </label>
          <fieldset>
            <legend>Supporting files, maximum ${escapeHtml(formatFileSize(MAX_UPLOAD_BYTES))} each</legend>
            <div data-upload-slots>
              ${uploadSlots}
            </div>
            <button class="button secondary" type="button" data-add-upload>Add another file</button>
          </fieldset>
          <button class="button" type="submit">Save episode media</button>
        </form>
      </section>
      <section class="admin-panel">
        <p class="section-kicker">Video import</p>
        <h2>Copy a video URL to R2</h2>
        <p>This copies URLs that return video bytes directly. YouTube watch URLs need a downloader service before the Worker can import them.</p>
        <form class="admin-form" method="post" action="/admin/content/video/import">
          <label>
            Episode
            <select name="episodeId" required>${episodeOptions}</select>
          </label>
          <label>
            Video source URL
            <input
              type="url"
              name="sourceUrl"
              placeholder="https://example.com/video.mp4"
              required
            >
          </label>
          <button class="button" type="submit">Copy video to R2</button>
        </form>
      </section>
      <section class="admin-panel">
        <p class="section-kicker">Map locations</p>
        <h2>Add a case location</h2>
        <p>Leave latitude and longitude blank to geocode the address when saving.</p>
        <form class="admin-form" method="get" action="/admin/content">
          <label>
            Find suggestions from transcript
            <select name="suggestEpisodeId" required>${episodeOptions}</select>
          </label>
          <button class="button secondary-dark" type="submit">Scan transcript</button>
        </form>
        ${locationSuggestions}
        <form class="admin-form" method="post" action="/admin/content/map">
          <label>
            Episode
            <select name="episodeId" required>${episodeOptions}</select>
          </label>
          <label>
            Location label
            <input name="label" maxlength="140" placeholder="Last confirmed sighting" required>
          </label>
          <label>
            Address or place
            <input name="address" maxlength="240" placeholder="City, state, landmark, or street address">
          </label>
          <div class="admin-field-grid">
            <label>
              Latitude
              <input name="latitude" inputmode="decimal" placeholder="39.9612">
            </label>
            <label>
              Longitude
              <input name="longitude" inputmode="decimal" placeholder="-82.9988">
            </label>
          </div>
          <label>
            Note
            <textarea name="note" maxlength="500" placeholder="Why this location matters to the episode"></textarea>
          </label>
          <button class="button" type="submit">Save map location</button>
        </form>
      </section>
      <section class="admin-panel">
        <p class="section-kicker">Current content</p>
        <h2>Episode videos and files</h2>
        ${contentLists || "<p>No episode content has been added yet.</p>"}
      </section>
    </main>
    <template id="upload-slot-template">
      ${renderUploadSlot(0)}
    </template>
    <script>
      (function () {
        var addButton = document.querySelector('[data-add-upload]');
        var slots = document.querySelector('[data-upload-slots]');
        var template = document.getElementById('upload-slot-template');

        if (!addButton || !slots || !template) return;

        addButton.addEventListener('click', function () {
          var nextNumber = slots.querySelectorAll('.admin-file-slot').length + 1;
          var fragment = template.content.cloneNode(true);
          var firstLabel = fragment.querySelector('label');

          if (firstLabel && firstLabel.firstChild) {
            firstLabel.firstChild.textContent = 'File ' + nextNumber;
          }

          slots.appendChild(fragment);
        });
      })();
    </script>
    ${renderPageViewNotification()}
  </body>
</html>`;
};

const serveAttachment = async (request, env, pathname) => {
  if (!env.EPISODE_CONTENT) {
    return new Response("Content storage is not configured", { status: 503 });
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" }
    });
  }

  const match = pathname.match(/^\/episode-content\/([^/]+)\/([^/]+)\/?$/);

  if (!match) {
    return new Response("Not found", { status: 404 });
  }

  const episodeId = decodeURIComponent(match[1]);
  const attachmentId = decodeURIComponent(match[2]);
  const content = await loadEpisodeContent(env, episodeId);
  const attachment =
    attachmentId === "video"
      ? normalizeVideoAsset(content.videoAsset)
      : content.attachments.find((item) => item.id === attachmentId);

  if (!attachment) {
    return new Response("Not found", { status: 404 });
  }

  const range = request.headers.get("range");
  const object = await env.EPISODE_CONTENT.get(
    attachment.objectKey,
    range ? { range: request.headers } : undefined
  );

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "sandbox; default-src 'none'");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("accept-ranges", "bytes");
  headers.set(
    "content-disposition",
    `${
      attachment.type === "image" ||
      attachment.type === "pdf" ||
      isVideoContentType(attachment.contentType)
        ? "inline"
        : "attachment"
    }; filename="${attachment.filename.replaceAll('"', "")}"`
  );

  if (range && object.range) {
    headers.set(
      "content-range",
      `bytes ${object.range.offset}-${object.range.end ?? object.range.offset + object.range.length - 1}/${object.size}`
    );
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: range && object.range ? 206 : 200,
    headers
  });
};

const handleAdminPage = async (request, env, url) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized(
      env.ADMIN_USERNAME && env.ADMIN_PASSWORD
        ? "Authentication required"
        : "Set the ADMIN_USERNAME Worker variable and ADMIN_PASSWORD Worker secret before using this tool."
    );
  }

  const episodes = await loadEpisodes();
  const contentEntries = await Promise.all(
    episodes.map(async (episode) => [episode.id, await loadEpisodeContent(env, episode.id)])
  );
  const suggestEpisodeId = String(url.searchParams.get("suggestEpisodeId") ?? "").trim();
  let locationSuggestionData = null;

  if (suggestEpisodeId) {
    const listEpisode = episodes.find((episode) => episode.id === suggestEpisodeId);

    if (listEpisode) {
      const suggestionEpisode = listEpisode;
      suggestionEpisode.transcriptContent = await loadEpisodeTranscript(suggestionEpisode);
      locationSuggestionData = {
        episode: suggestionEpisode,
        suggestions: inferLocationSuggestions(suggestionEpisode)
      };
    }
  }
  const notices = {
    saved: "Episode media saved.",
    articleSaved: "Article saved.",
    articleRemoved: "Article removed.",
    uploaded: "Content uploaded successfully.",
    deleted: "Content deleted.",
    videoImported: "Video copied to R2.",
    videoImportUnsupported: "That URL does not return a video file directly. YouTube watch URLs need a downloader service before this Worker can copy them.",
    mapSaved: "Map location saved.",
    mapSavedNoGeocode: "Map location saved, but no coordinates were found. Add latitude and longitude manually to show an embedded map.",
    mapRemoved: "Map location removed.",
    videoSaved: "Video overview saved.",
    videoRemoved: "Video overview removed.",
    missing: "The selected episode or file could not be found."
  };

  return new Response(
    renderAdminPage(
      episodes,
      new Map(contentEntries),
      notices[url.searchParams.get("status")],
      locationSuggestionData
    ),
    {
      headers: {
        "content-type": "text/html;charset=UTF-8",
        "cache-control": "no-store"
      }
    }
  );
};

const handleUpload = async (request, env) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized();
  }

  if (!sameOriginRequest(request)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  if (!env.EPISODE_CONTENT) {
    return new Response("Content storage is not configured", { status: 503 });
  }

  const form = await request.formData();
  const episodeId = String(form.get("episodeId") ?? "").trim();
  const title = String(form.get("title") ?? "").trim().slice(0, 140);
  const description = String(form.get("description") ?? "").trim().slice(0, 2000);
  const file = form.get("file");

  if (!episodeId || !title || !(file instanceof File) || file.size === 0) {
    return new Response("Episode, title, and file are required", { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return new Response(`Files must be ${formatFileSize(MAX_UPLOAD_BYTES)} or smaller`, {
      status: 413
    });
  }

  const episodes = await loadEpisodes();

  if (!episodes.some((episode) => episode.id === episodeId)) {
    return adminRedirect(request, "?status=missing");
  }

  const attachment = buildAttachment(episodeId, file, title, description);

  await env.EPISODE_CONTENT.put(attachment.objectKey, file.stream(), {
    httpMetadata: { contentType: attachment.contentType },
    customMetadata: { episodeId, attachmentId: attachment.id }
  });

  try {
    const attachments = await loadAttachments(env, episodeId);
    await saveAttachments(env, episodeId, [...attachments, attachment]);
  } catch (error) {
    await env.EPISODE_CONTENT.delete(attachment.objectKey);
    throw error;
  }

  return adminRedirect(request, "?status=uploaded");
};

const handleArticle = async (request, env) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized();
  }

  if (!sameOriginRequest(request)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  if (!env.EPISODE_CONTENT) {
    return new Response("Content storage is not configured", { status: 503 });
  }

  const form = await request.formData();
  const episodeId = String(form.get("episodeId") ?? "").trim();
  const article = normalizeArticle({
    title: form.get("title"),
    excerpt: form.get("excerpt"),
    body: form.get("body"),
    updatedAt: form.get("updatedAt")
  });

  if (!episodeId) {
    return adminRedirect(request, "?status=missing");
  }

  const episodes = await loadEpisodes();

  if (!episodes.some((episode) => episode.id === episodeId)) {
    return adminRedirect(request, "?status=missing");
  }

  const content = await loadEpisodeContent(env, episodeId);
  await saveEpisodeContent(env, episodeId, {
    ...content,
    article
  });

  return adminRedirect(request, article.body ? "?status=articleSaved" : "?status=articleRemoved");
};

const handleMediaBundle = async (request, env) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized();
  }

  if (!sameOriginRequest(request)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  if (!env.EPISODE_CONTENT) {
    return new Response("Content storage is not configured", { status: 503 });
  }

  const form = await request.formData();
  const episodeId = String(form.get("episodeId") ?? "").trim();
  const videoInput = String(form.get("videoUrl") ?? "").trim();
  const videoFile = form.get("videoFile");
  const hasVideoFile = videoFile instanceof File && videoFile.size > 0;
  const removeVideo = form.get("removeVideo") === "1";
  const video = videoInput ? parseVideoUrl(videoInput) : null;

  if (!episodeId) {
    return new Response("Episode is required", { status: 400 });
  }

  if (videoInput && !video) {
    return new Response("A valid YouTube URL is required", { status: 400 });
  }

  if (hasVideoFile && videoInput) {
    return new Response("Upload a hosted video file or save a YouTube URL, not both", { status: 400 });
  }

  if (removeVideo && (hasVideoFile || videoInput)) {
    return new Response("Remove the existing video or save a replacement, not both", { status: 400 });
  }

  if (hasVideoFile) {
    if (videoFile.size > MAX_VIDEO_UPLOAD_BYTES) {
      return new Response(`Videos must be ${formatFileSize(MAX_VIDEO_UPLOAD_BYTES)} or smaller`, {
        status: 413
      });
    }

    if (!isVideoContentType(videoFile.type) && !isLikelyVideoFilename(videoFile.name)) {
      return new Response("Upload a video file such as MP4, WebM, MOV, or M4V", { status: 400 });
    }
  }

  const episodes = await loadEpisodes();

  if (!episodes.some((episode) => episode.id === episodeId)) {
    return adminRedirect(request, "?status=missing");
  }

  const files = form.getAll("file");
  const titles = form.getAll("attachmentTitle");
  const descriptions = form.getAll("attachmentDescription");
  const attachmentsToUpload = [];

  for (const [index, file] of files.entries()) {
    if (!(file instanceof File) || file.size === 0) {
      continue;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return new Response(`Files must be ${formatFileSize(MAX_UPLOAD_BYTES)} or smaller`, {
        status: 413
      });
    }

    const title = String(titles[index] ?? "").trim().slice(0, 140);
    const description = String(descriptions[index] ?? "").trim().slice(0, 2000);

    if (!title) {
      return new Response("Each uploaded file needs a display title", { status: 400 });
    }

    attachmentsToUpload.push({
      file,
      attachment: buildAttachment(episodeId, file, title, description)
    });
  }

  const uploadedAttachments = [];
  let uploadedVideoAsset = null;
  let previousVideoAsset = null;

  try {
    for (const { file, attachment } of attachmentsToUpload) {
      await env.EPISODE_CONTENT.put(attachment.objectKey, file.stream(), {
        httpMetadata: { contentType: attachment.contentType },
        customMetadata: { episodeId, attachmentId: attachment.id }
      });
      uploadedAttachments.push(attachment);
    }

    if (hasVideoFile) {
      uploadedVideoAsset = buildVideoAsset(episodeId, videoFile);
      await env.EPISODE_CONTENT.put(uploadedVideoAsset.objectKey, videoFile.stream(), {
        httpMetadata: { contentType: uploadedVideoAsset.contentType },
        customMetadata: { episodeId, videoAssetId: uploadedVideoAsset.id }
      });
    }

    const content = await loadEpisodeContent(env, episodeId);
    previousVideoAsset = normalizeVideoAsset(content.videoAsset);
    const replacingVideo = removeVideo || video || uploadedVideoAsset;
    const nextVideoUrl = removeVideo || uploadedVideoAsset ? "" : video ? video.url : content.videoUrl;
    const nextVideoAsset = uploadedVideoAsset
      ? uploadedVideoAsset
      : replacingVideo
        ? null
        : content.videoAsset;

    await saveEpisodeContent(env, episodeId, {
      ...content,
      videoUrl: nextVideoUrl,
      videoAsset: nextVideoAsset,
      attachments: [...content.attachments, ...uploadedAttachments]
    });

    if (previousVideoAsset && replacingVideo) {
      await deleteVideoAsset(env, previousVideoAsset);
    }
  } catch (error) {
    await Promise.all(
      [
        ...uploadedAttachments.map((attachment) => env.EPISODE_CONTENT.delete(attachment.objectKey)),
        uploadedVideoAsset ? env.EPISODE_CONTENT.delete(uploadedVideoAsset.objectKey) : null
      ].filter(Boolean)
    );
    throw error;
  }

  return adminRedirect(request, "?status=saved");
};

const handleVideoOverview = async (request, env) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized();
  }

  if (!sameOriginRequest(request)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  if (!env.EPISODE_CONTENT) {
    return new Response("Content storage is not configured", { status: 503 });
  }

  const form = await request.formData();
  const episodeId = String(form.get("episodeId") ?? "").trim();
  const videoInput = String(form.get("videoUrl") ?? form.get("youtubeUrl") ?? "").trim();
  const video = videoInput ? parseVideoUrl(videoInput) : null;

  if (!episodeId || (videoInput && !video)) {
    return new Response("A valid YouTube URL is required", { status: 400 });
  }

  const episodes = await loadEpisodes();

  if (!episodes.some((episode) => episode.id === episodeId)) {
    return adminRedirect(request, "?status=missing");
  }

  const content = await loadEpisodeContent(env, episodeId);
  const previousVideoAsset = normalizeVideoAsset(content.videoAsset);
  await saveEpisodeContent(env, episodeId, {
    ...content,
    videoUrl: video?.url ?? "",
    videoAsset: null
  });

  if (previousVideoAsset) {
    await deleteVideoAsset(env, previousVideoAsset);
  }

  return adminRedirect(
    request,
    video ? "?status=videoSaved" : "?status=videoRemoved"
  );
};

const handleVideoImport = async (request, env) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized();
  }

  if (!sameOriginRequest(request)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  if (!env.EPISODE_CONTENT) {
    return new Response("Content storage is not configured", { status: 503 });
  }

  const form = await request.formData();
  const episodeId = String(form.get("episodeId") ?? "").trim();
  const sourceInput = String(form.get("sourceUrl") ?? "").trim();

  if (!episodeId || !sourceInput) {
    return new Response("Episode and video source URL are required", { status: 400 });
  }

  let sourceUrl;

  try {
    sourceUrl = new URL(sourceInput);
  } catch {
    return new Response("A valid video source URL is required", { status: 400 });
  }

  if (sourceUrl.protocol !== "https:") {
    return new Response("Video source URL must use HTTPS", { status: 400 });
  }

  if (parseVideoUrl(sourceUrl.href)) {
    return adminRedirect(request, "?status=videoImportUnsupported");
  }

  const episodes = await loadEpisodes();

  if (!episodes.some((episode) => episode.id === episodeId)) {
    return adminRedirect(request, "?status=missing");
  }

  const response = await fetch(sourceUrl.href, {
    headers: {
      accept: "video/*,application/octet-stream;q=0.8,*/*;q=0.1",
      "user-agent": `${podcast.name} video importer (${podcast.email})`
    }
  });

  if (!response.ok || !response.body) {
    return new Response(`Unable to fetch video source: ${response.status}`, { status: 502 });
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "";
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  const filename = videoFilenameFromUrl(sourceUrl.href);

  if (!isVideoContentType(contentType) && !isLikelyVideoFilename(filename)) {
    return adminRedirect(request, "?status=videoImportUnsupported");
  }

  if (contentLength > MAX_VIDEO_UPLOAD_BYTES) {
    return new Response(`Videos must be ${formatFileSize(MAX_VIDEO_UPLOAD_BYTES)} or smaller`, {
      status: 413
    });
  }

  const importedVideoAsset = buildImportedVideoAsset(
    episodeId,
    sourceUrl.href,
    contentType || "application/octet-stream",
    contentLength
  );

  try {
    await env.EPISODE_CONTENT.put(importedVideoAsset.objectKey, response.body, {
      httpMetadata: { contentType: importedVideoAsset.contentType },
      customMetadata: { episodeId, videoAssetId: importedVideoAsset.id, sourceUrl: sourceUrl.href }
    });

    const content = await loadEpisodeContent(env, episodeId);
    const previousVideoAsset = normalizeVideoAsset(content.videoAsset);

    await saveEpisodeContent(env, episodeId, {
      ...content,
      videoUrl: "",
      videoAsset: importedVideoAsset
    });

    if (previousVideoAsset) {
      await deleteVideoAsset(env, previousVideoAsset);
    }
  } catch (error) {
    await env.EPISODE_CONTENT.delete(importedVideoAsset.objectKey);
    throw error;
  }

  return adminRedirect(request, "?status=videoImported");
};

const handleMapLocation = async (request, env) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized();
  }

  if (!sameOriginRequest(request)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  if (!env.EPISODE_CONTENT) {
    return new Response("Content storage is not configured", { status: 503 });
  }

  const form = await request.formData();
  const episodeId = String(form.get("episodeId") ?? "").trim();
  const location = normalizeMapLocation({
    label: form.get("label"),
    address: form.get("address"),
    latitude: form.get("latitude"),
    longitude: form.get("longitude"),
    note: form.get("note")
  });

  if (!episodeId || !location || (!location.address && location.latitude === null)) {
    return new Response("Episode and either an address or coordinates are required", { status: 400 });
  }

  const episodes = await loadEpisodes();

  if (!episodes.some((episode) => episode.id === episodeId)) {
    return adminRedirect(request, "?status=missing");
  }

  const content = await loadEpisodeContent(env, episodeId);
  const mapLocations = normalizeMapLocations(content.mapLocations);
  const geocodedLocation = await geocodeMapLocation(location, env);

  await saveEpisodeContent(env, episodeId, {
    ...content,
    mapLocations: [...mapLocations, geocodedLocation.location]
  });

  return adminRedirect(
    request,
    geocodedLocation.geocoded || geocodedLocation.location.latitude !== null
      ? "?status=mapSaved"
      : "?status=mapSavedNoGeocode"
  );
};

const handleDeleteMapLocation = async (request, env) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized();
  }

  if (!sameOriginRequest(request)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  if (!env.EPISODE_CONTENT) {
    return new Response("Content storage is not configured", { status: 503 });
  }

  const form = await request.formData();
  const episodeId = String(form.get("episodeId") ?? "").trim();
  const locationId = String(form.get("locationId") ?? "").trim();

  if (!episodeId || !locationId) {
    return adminRedirect(request, "?status=missing");
  }

  const content = await loadEpisodeContent(env, episodeId);
  const mapLocations = normalizeMapLocations(content.mapLocations);
  const nextMapLocations = mapLocations.filter((location) => location.id !== locationId);

  if (nextMapLocations.length === mapLocations.length) {
    return adminRedirect(request, "?status=missing");
  }

  await saveEpisodeContent(env, episodeId, {
    ...content,
    mapLocations: nextMapLocations
  });

  return adminRedirect(request, "?status=mapRemoved");
};

const handleDelete = async (request, env) => {
  if (!isAdmin(request, env)) {
    return adminUnauthorized();
  }

  if (!sameOriginRequest(request)) {
    return new Response("Invalid request origin", { status: 403 });
  }

  const form = await request.formData();
  const episodeId = String(form.get("episodeId") ?? "").trim();
  const attachmentId = String(form.get("attachmentId") ?? "").trim();
  const attachments = await loadAttachments(env, episodeId);
  const attachment = attachments.find((item) => item.id === attachmentId);

  if (!attachment) {
    return adminRedirect(request, "?status=missing");
  }

  await saveAttachments(
    env,
    episodeId,
    attachments.filter((item) => item.id !== attachmentId)
  );
  await env.EPISODE_CONTENT.delete(attachment.objectKey);

  return adminRedirect(request, "?status=deleted");
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cacheControl = `public, max-age=${podcast.spotify.cacheSeconds}`;
    const apiEpisodeMatch = url.pathname.match(/^\/api\/episodes\/([^/]+)\/?$/);
    const spotifyLandingPageMatch = url.pathname.match(
      /^\/landing-page\/([^/]+)(\/spotify)?\/?$/
    );
    const isApiRequest =
      url.pathname === "/api/podcast" ||
      url.pathname === "/api/podcast/" ||
      url.pathname === "/api/home" ||
      url.pathname === "/api/home/" ||
      Boolean(apiEpisodeMatch);
    const analytics = {
      countryCode: getCountryCode(request),
      facebookPixelId: env.FACEBOOK_PIXEL_ID || ""
    };

    if (SPOTIFY_SHOW_REDIRECT_ENDPOINTS.has(url.pathname)) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, HEAD" }
        });
      }

      return new Response(null, {
        status: 302,
        headers: {
          location: podcast.spotify.showUrl,
          "cache-control": "public, max-age=3600"
        }
      });
    }

    if (url.pathname === SPOTIFY_LANDING_PLAYBACK_ENDPOINT) {
      try {
        return await handleSpotifyLandingPlayback(request, env, ctx);
      } catch (error) {
        console.error("Spotify landing-page playback tracking failed", error);
        return new Response(null, { status: 204 });
      }
    }

    if (url.pathname === SPOTIFY_LANDING_CLICK_ENDPOINT) {
      try {
        return handleSpotifyLandingClick(request, env, ctx);
      } catch (error) {
        console.error("Spotify landing-page click failed", error);
        return new Response(null, { status: 204 });
      }
    }

    if (url.pathname === SPREAKER_PLAYER_PLAY_ENDPOINT) {
      try {
        return await handleSpreakerPlayerPlay(request, env, ctx);
      } catch (error) {
        console.error("Spreaker player play tracking failed", error);
        return new Response(null, { status: 204 });
      }
    }

    if (url.pathname === LANDING_PAGE_TRACK_ENDPOINT) {
      try {
        return await handleLandingPageTrack(request, env, ctx);
      } catch (error) {
        console.error("Landing-page directory tracking failed", error);
        return new Response(null, { status: 204 });
      }
    }

    if (url.pathname === LANDING_PAGE_STATS_ENDPOINT) {
      try {
        return await handleLandingPageStats(request, env, url);
      } catch (error) {
        console.error("Landing-page stats failed", error);
        return new Response("Unable to load landing-page stats", {
          status: 500,
          headers: { "cache-control": "no-store" }
        });
      }
    }

    if (url.pathname === SPOTIFY_LANDING_PAGE_ENDPOINT) {
      return handlePublishedEpisodesLandingPage(request, analytics);
    }

    if (spotifyLandingPageMatch) {
      let episodeSlug;

      try {
        episodeSlug = decodeURIComponent(spotifyLandingPageMatch[1]);
      } catch {
        return new Response("Invalid episode", { status: 400 });
      }

      return handleSpotifyEpisodeLandingPage(request, episodeSlug, analytics, env, ctx, {
        autoRedirect: Boolean(spotifyLandingPageMatch[2])
      });
    }

    if (request.method === "OPTIONS" && isApiRequest) {
      return new Response(null, { status: 204, headers: API_HEADERS });
    }

    if (url.pathname.startsWith("/assets/") || url.pathname === "/hero.png") {
      return env.ASSETS.fetch(request);
    }

    try {
      if (url.pathname === "/analytics/page-view") {
        if (request.method !== "POST") {
          return new Response("Method not allowed", {
            status: 405,
            headers: { allow: "POST" }
          });
        }

        if (request.headers.get("origin") !== url.origin) {
          return new Response("Forbidden", { status: 403 });
        }

        const viewedPath = String(url.searchParams.get("path") ?? "");

        if (!viewedPath.startsWith("/") || viewedPath.length > 900) {
          return new Response("Invalid page path", { status: 400 });
        }

        const pageUrl = new URL(viewedPath, url.origin);

        if (pageUrl.origin !== url.origin) {
          return new Response("Invalid page origin", { status: 400 });
        }

        const landingEpisodeSlug = spotifyLandingPageSlugFromPath(pageUrl.pathname);

        if (landingEpisodeSlug) {
          const episodes = await loadEpisodeCatalog();
          const landingEpisode = episodes.find((episode) => episode.slug === landingEpisodeSlug);

          if (landingEpisode) {
            const referrer = String(url.searchParams.get("referrer") ?? "");
            const attributionSource =
              pageUrl.searchParams.get("source") === "facebook_ad" ? "facebook_ad" : "";
            ctx.waitUntil(
              saveLandingPageVisit(
                env,
                request,
                landingEpisode,
                referrer,
                attributionSource
              )
            );
          }
        }

        return new Response(null, { status: 204 });
      }

      if (isApiRequest && !["GET", "HEAD"].includes(request.method)) {
        return jsonResponse(
          { error: { code: "method_not_allowed", message: "Use GET for this endpoint." } },
          405
        );
      }

      if (isApiRequest) {
        if (url.pathname === "/api/home" || url.pathname === "/api/home/") {
          const episodes = await loadApiEpisodeCatalog(env);
          const selectedCategory = String(url.searchParams.get("category") ?? "").trim();
          const requestedPage = parsePositiveInteger(url.searchParams.get("page"), 1);

          return jsonResponse(
            {
              apiVersion: "1.2",
              screen: renderHomeApi(episodes, url.origin, {
                selectedCategory,
                requestedPage
              }),
              meta: {
                episodeCount: episodes.length,
                generatedAt: new Date().toISOString()
              }
            },
            200,
            cacheControl,
            request.method === "HEAD"
          );
        }

        if (apiEpisodeMatch) {
          const episodeSlug = decodeURIComponent(apiEpisodeMatch[1]);
          const pageData = await loadApiEpisodeDetail(request, ctx, env, episodeSlug);

          if (!pageData) {
            return jsonResponse(
              {
                error: {
                  code: "episode_not_found",
                  message: "No episode was found for that slug."
                }
              },
              404,
              "no-store",
              request.method === "HEAD"
            );
          }

          return jsonResponse(
            {
              apiVersion: "1.2",
              screen: renderEpisodeDetailApi(pageData.episode, pageData.episodes, url.origin),
              meta: {
                generatedAt: new Date().toISOString()
              }
            },
            200,
            cacheControl,
            request.method === "HEAD"
          );
        }

        const episodes = await loadApiEpisodeCatalog(env);
        return jsonResponse(
          renderPodcastApi(episodes, url.origin),
          200,
          cacheControl,
          request.method === "HEAD"
        );
      }

      if (url.pathname.startsWith(`${CONTENT_ROUTE_PREFIX}/`)) {
        return serveAttachment(request, env, url.pathname);
      }

      if (
        (url.pathname === "/admin/spreaker" || url.pathname === "/admin/spreaker/") &&
        ["GET", "HEAD"].includes(request.method)
      ) {
        if (!isAdmin(request, env)) return adminUnauthorized();
        return handleSpreakerDashboard(request, env, url);
      }

      if (url.pathname === "/admin/spreaker/connect" && request.method === "GET") {
        if (!isAdmin(request, env)) return adminUnauthorized();
        return handleSpreakerConnect(request, env);
      }

      if (url.pathname === "/admin/spreaker/oauth/callback" && request.method === "GET") {
        if (!isAdmin(request, env)) return adminUnauthorized();
        return handleSpreakerCallback(request, env, url);
      }

      if (url.pathname === "/admin/spreaker/monetization" && request.method === "POST") {
        if (!isAdmin(request, env)) return adminUnauthorized();
        return handleSpreakerMonetizationUpload(request, env);
      }

      if (url.pathname === "/admin/content" && request.method === "GET") {
        return handleAdminPage(request, env, url);
      }

      if (url.pathname === "/admin/content/upload" && request.method === "POST") {
        return handleUpload(request, env);
      }

      if (url.pathname === "/admin/content/media" && request.method === "POST") {
        return handleMediaBundle(request, env);
      }

      if (url.pathname === "/admin/content/article" && request.method === "POST") {
        return handleArticle(request, env);
      }

      if (
        (url.pathname === "/admin/content/video" || url.pathname === "/admin/content/youtube") &&
        request.method === "POST"
      ) {
        return handleVideoOverview(request, env);
      }

      if (url.pathname === "/admin/content/video/import" && request.method === "POST") {
        return handleVideoImport(request, env);
      }

      if (url.pathname === "/admin/content/map" && request.method === "POST") {
        return handleMapLocation(request, env);
      }

      if (url.pathname === "/admin/content/map/delete" && request.method === "POST") {
        return handleDeleteMapLocation(request, env);
      }

      if (url.pathname === "/admin/content/delete" && request.method === "POST") {
        return handleDelete(request, env);
      }

      if (url.pathname === "/sitemap.xml" && ["GET", "HEAD"].includes(request.method)) {
        const episodes = await loadEpisodes();
        const sitemap = renderSitemap(url.origin, episodes);

        return new Response(request.method === "HEAD" ? null : sitemap, {
          headers: {
            "content-type": "application/xml;charset=UTF-8",
            "cache-control": cacheControl,
            "x-content-type-options": "nosniff"
          }
        });
      }

      if (url.pathname === "/search" && request.method === "GET") {
        const query = String(url.searchParams.get("q") ?? "").trim().slice(0, 100);
        const episodes = await loadEpisodeCatalog();
        const results = searchEpisodes(episodes, query);

        return new Response(renderSearchPage(query, results, analytics), {
          headers: {
            "content-type": "text/html;charset=UTF-8",
            "cache-control": cacheControl,
            "x-robots-tag": "noindex, follow"
          }
        });
      }

      const staticPage = staticPageByPath(url.pathname);

      if (staticPage && ["GET", "HEAD"].includes(request.method)) {
        return new Response(request.method === "HEAD" ? null : renderStaticPage(staticPage, analytics), {
          headers: {
            "content-type": "text/html;charset=UTF-8",
            "cache-control": cacheControl
          }
        });
      }

      const episodeSlug = episodeSlugFromPath(url.pathname);

      if (episodeSlug) {
        const pageData = await loadEpisodePageData(request, ctx, episodeSlug);

        if (!pageData) {
          return new Response("Not found", { status: 404 });
        }

        const { episode, episodes } = pageData;
        const episodeContent = await loadEpisodeContent(env, episode.id);
        episode.attachments = episodeContent.attachments;
        episode.article = episodeContent.article;
        episode.videoUrl = selectVideoUrl(episodeContent.videoUrl, episode.feedVideoUrl);
        episode.videoAsset = episodeContent.videoAsset;
        episode.mapLocations = episodeContent.mapLocations;
        return new Response(renderEpisodePage(episode, episodes, analytics), {
          headers: {
            "content-type": "text/html;charset=UTF-8",
            "cache-control": cacheControl
          }
        });
      }

      if (url.pathname !== "/") {
        return new Response("Not found", { status: 404 });
      }

      const episodes = await loadEpisodeCatalog();

      if (episodes.length === 0) {
        return new Response("No episodes found", { status: 502 });
      }

      const featuredEpisode = episodes[0];
      const categories = buildEpisodeCategories(episodes);
      const selectedCategory = String(url.searchParams.get("category") ?? "").trim();
      const requestedPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

      return new Response(
        renderPage(episodes, featuredEpisode, categories, selectedCategory, currentPage, analytics),
        {
          headers: {
            "content-type": "text/html;charset=UTF-8",
            "cache-control": cacheControl
          }
        }
      );
    } catch (error) {
      if (isApiRequest) {
        return jsonResponse(
          {
            error: {
              code: "upstream_error",
              message: "Unable to load podcast data."
            }
          },
          502
        );
      }

      return new Response(`Unable to load Spotify episodes: ${error.message}`, {
        status: 502,
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    }
  }
};
