import { podcast } from "./podcast.config.js";

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

const SPREAKER_API_BASE = "https://api.spreaker.com/v2";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const CONTENT_ROUTE_PREFIX = "/episode-content";
const EPISODE_DATA_CACHE_PREFIX = "/__cache/episode-data";
const EPISODES_PER_PAGE = 9;

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

const formatPublishedDate = (value) => {
  if (!value) {
    return "Episode";
  }

  const date = new Date(`${value.replace(" ", "T")}Z`);

  if (Number.isNaN(date.getTime())) {
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

  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const fetchSpreakerJson = async (path) => {
  const apiUrl = path.startsWith("http") ? path : `${SPREAKER_API_BASE}${path}`;
  const response = await fetch(apiUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "The Last Known Podcast Website"
    },
    cf: {
      cacheTtl: podcast.spreaker.cacheSeconds,
      cacheEverything: true
    }
  });

  if (!response.ok) {
    throw new Error(`Spreaker API returned ${response.status}`);
  }

  return response.json();
};

const selectTranscript = (episode) => {
  const transcripts = Array.isArray(episode.transcripts_generated)
    ? episode.transcripts_generated
    : [];
  const preferredTypes = ["text/plain", "text/vtt", "application/x-subrip"];

  for (const transcriptType of preferredTypes) {
    const transcript = transcripts.find((item) => item.transcript_type === transcriptType);

    if (transcript?.transcript_url) {
      return {
        url: transcript.transcript_url,
        type: transcript.transcript_type
      };
    }
  }

  return episode.transcript_url
    ? {
        url: episode.transcript_url,
        type: episode.transcript_type || "text/plain"
      }
    : null;
};

const normalizeEpisode = (episode) => {
  const description = stripHtml(episode.description_html ?? episode.description ?? "");
  const summary = truncateText(description || `${episode.title} from ${podcast.name}.`);

  return {
    id: String(episode.episode_id),
    slug: episode.slug || String(episode.episode_id),
    status: "Episode",
    title: episode.title,
    summary,
    detail: summary,
    publishedAt: formatPublishedDate(episode.published_at),
    publishedDate: formatSitemapDate(episode.published_at),
    href: episode.site_url,
    spreakerUrl: episode.site_url,
    spreakerResource: `episode_id=${episode.episode_id}`,
    transcript: selectTranscript(episode),
    image: episode.image_original_url ?? episode.image_url ?? podcast.heroImage,
    body: description
      .split(/\n+/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter(Boolean)
  };
};

const loadEpisodes = async () => {
  const limit = podcast.spreaker.episodeLimit ?? 50;
  let nextUrl = `/shows/${podcast.spreaker.showId}/episodes?limit=${encodeURIComponent(limit)}`;
  const episodes = [];

  while (nextUrl) {
    const data = await fetchSpreakerJson(nextUrl);
    episodes.push(...(data.response?.items ?? []));
    nextUrl = data.response?.next_url ?? null;
  }

  return episodes.map(normalizeEpisode);
};

const loadEpisodeDetails = async (episodeId) => {
  const data = await fetchSpreakerJson(`/episodes/${episodeId}`);
  return normalizeEpisode(data.response.episode);
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

  if (transcriptUrl.protocol !== "https:" || transcriptUrl.hostname !== "transcription.spreaker.com") {
    return null;
  }

  const response = await fetch(transcriptUrl, {
    headers: {
      accept: "text/plain,text/vtt,application/x-subrip",
      "user-agent": "The Last Known Podcast Website"
    },
    cf: {
      cacheTtl: podcast.spreaker.cacheSeconds,
      cacheEverything: true
    }
  });

  if (!response.ok) {
    console.error(`Spreaker transcript returned ${response.status} for episode ${episode.id}`);
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

  let episode = listEpisode;

  try {
    episode = await loadEpisodeDetails(listEpisode.id);
  } catch (error) {
    console.error(`Unable to load details for episode ${listEpisode.id}`, error);
  }

  episode.transcriptContent = await loadEpisodeTranscript(episode);

  const data = { episode, episodes };
  const response = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": `public, max-age=${podcast.spreaker.cacheSeconds}`
    }
  });
  ctx.waitUntil(cache.put(cacheRequest, response));

  return data;
};

const attachmentManifestKey = (episodeId) => `episodes/${episodeId}/manifest.json`;

const emptyEpisodeContent = () => ({
  attachments: [],
  videoUrl: ""
});

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
        videoUrl: content.videoUrl ?? ""
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

const loadApiEpisodeCatalog = async (env) => {
  const episodes = await loadEpisodes();

  await Promise.all(
    episodes.map(async (episode) => {
      const content = await loadEpisodeContent(env, episode.id);
      episode.attachments = content.attachments;
      episode.videoUrl = content.videoUrl;
    })
  );

  return episodes;
};

const saveAttachments = async (env, episodeId, attachments) => {
  const content = await loadEpisodeContent(env, episodeId);
  return saveEpisodeContent(env, episodeId, { ...content, attachments });
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

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return null;
  }

  if (!url.hostname) {
    return null;
  }

  return {
    url: url.href
  };
};

const videoContentType = (url) => {
  const pathname = new URL(url).pathname.toLowerCase();

  if (pathname.endsWith(".m3u8")) {
    return "application/x-mpegURL";
  }

  if (pathname.endsWith(".mp4")) {
    return "video/mp4";
  }

  if (pathname.endsWith(".webm")) {
    return "video/webm";
  }

  if (pathname.endsWith(".ogv") || pathname.endsWith(".ogg")) {
    return "video/ogg";
  }

  return "";
};

const isHlsVideoUrl = (url) => new URL(url).pathname.toLowerCase().endsWith(".m3u8");

const cloudflareStreamThumbnailUrl = (url) => {
  const videoUrl = new URL(url);
  const hostname = videoUrl.hostname.toLowerCase();

  if (!hostname.endsWith(".cloudflarestream.com") && hostname !== "videodelivery.net") {
    return "";
  }

  const videoId = videoUrl.pathname.split("/").filter(Boolean)[0];

  if (!videoId) {
    return "";
  }

  const thumbnailUrl = new URL(`/${videoId}/thumbnails/thumbnail.jpg`, videoUrl.origin);
  thumbnailUrl.searchParams.set("time", "0s");
  thumbnailUrl.searchParams.set("height", "720");
  thumbnailUrl.searchParams.set("fit", "scale");

  return thumbnailUrl.href;
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
  if (!env.ADMIN_PASSWORD) {
    return false;
  }

  const credentials = parseBasicAuth(request);
  const expectedUsername = env.ADMIN_USERNAME || "admin";

  return (
    credentials?.username === expectedUsername &&
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

const limitField = (value, maxLength = 1000) => {
  const text = fallbackText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
};

const detectDevice = (userAgent = "") => {
  const ua = userAgent.toLowerCase();

  if (/bot|crawl|spider|slurp|facebookexternalhit|discordbot/.test(ua)) {
    return "Bot / crawler";
  }

  if (/ipad|tablet/.test(ua)) {
    return "Tablet";
  }

  if (/mobi|iphone|android/.test(ua)) {
    return "Mobile";
  }

  return "Desktop";
};

const getClientInfo = (request) => {
  const headers = request.headers;
  const cf = request.cf ?? {};
  const userAgent = headers.get("user-agent") ?? "";

  return {
    device: detectDevice(userAgent),
    country: cf.country ?? headers.get("cf-ipcountry"),
    region: cf.region,
    city: cf.city,
    timezone: cf.timezone,
    colo: cf.colo,
    asn: cf.asn,
    organization: cf.asOrganization,
    ip: headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for"),
    referrer: headers.get("referer"),
    language: headers.get("accept-language"),
    userAgent
  };
};

const getCountryCode = (request) => {
  const country = String(
    request.cf?.country ?? request.headers.get("cf-ipcountry") ?? "XX"
  ).toUpperCase();

  return /^[A-Z]{2}$/.test(country) ? country : "XX";
};

const notifyEpisodeView = (env, request, episode) => {
  if (!env.DISCORD_WEBHOOK_URL) {
    return Promise.resolve();
  }

  const url = new URL(request.url);
  const client = getClientInfo(request);
  const payload = {
    username: podcast.name,
    content: `Episode detail page viewed: ${episode.title}`,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: episode.title,
        url: url.href,
        description: episode.summary,
        thumbnail: { url: episode.image },
        fields: [
          { name: "Published", value: episode.publishedAt, inline: true },
          { name: "Episode ID", value: episode.id, inline: true },
          { name: "Device", value: client.device, inline: true },
          { name: "Country", value: fallbackText(client.country), inline: true },
          { name: "Region", value: fallbackText(client.region), inline: true },
          { name: "City", value: fallbackText(client.city), inline: true },
          { name: "Timezone", value: fallbackText(client.timezone), inline: true },
          { name: "Cloudflare Colo", value: fallbackText(client.colo), inline: true },
          { name: "Network", value: limitField(client.organization), inline: true },
          { name: "ASN", value: fallbackText(client.asn), inline: true },
          { name: "IP", value: fallbackText(client.ip), inline: true },
          { name: "Language", value: limitField(client.language), inline: false },
          { name: "Referrer", value: limitField(client.referrer, 900), inline: false },
          { name: "Landing URL", value: limitField(url.href, 900), inline: false },
          { name: "User Agent", value: limitField(client.userAgent), inline: false }
        ]
      }
    ]
  };

  return fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch((error) => {
    console.error("Discord webhook notification failed", error);
  });
};

const renderEpisodeImage = (episode, className = "episode-art") => `
  <img
    class="${escapeHtml(className)}"
    src="${escapeHtml(episode.image)}"
    alt="${escapeHtml(`${episode.title} episode artwork`)}"
    loading="lazy"
  >`;

const episodePath = (episode) => `/episodes/${episode.slug}`;

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

const serializeEpisode = (episode, origin) => ({
  id: episode.id,
  slug: episode.slug,
  title: episode.title,
  summary: episode.summary,
  description: (episode.body ?? []).join("\n\n"),
  publishedAt: episode.publishedDate,
  publishedAtDisplay: episode.publishedAt,
  detailPageUrl: absoluteUrl(episodePath(episode), origin),
  spreakerUrl: episode.spreakerUrl,
  artworkUrl: absoluteUrl(episode.image, origin),
  player: {
    provider: "spreaker",
    resource: episode.spreakerResource
  },
  transcript: episode.transcript
    ? {
        url: episode.transcript.url,
        mimeType: episode.transcript.type
      }
    : null,
  videoUrl: episode.videoUrl || null,
  attachments: (episode.attachments ?? []).map((attachment) =>
    serializeAttachment(attachment, episode, origin)
  )
});

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
  apiVersion: "1.0",
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
  meta: {
    episodeCount: episodes.length,
    generatedAt: new Date().toISOString()
  }
});

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
    updated: "Last updated: June 25, 2026"
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
  const homepageLastModified = episodes.find((episode) => episode.publishedDate)?.publishedDate;
  const urls = [
    {
      location: new URL("/", origin).href,
      lastModified: homepageLastModified
    },
    ...STATIC_PAGES.map((page) => ({
      location: new URL(`/${page.slug}`, origin).href,
      lastModified: null
    })),
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
      <p>Categories are generated from each episode’s title and description on Spreaker.</p>
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

const renderRelatedEpisodes = (episode, episodes) => {
  const relatedEpisodes = selectRelatedEpisodes(episode, episodes);

  if (!relatedEpisodes.length) {
    return "";
  }

  return `
    <section class="related-episodes" aria-labelledby="related-episodes-title">
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

const renderFooter = () => `
  <footer class="section footer">
    <span>${escapeHtml(podcast.name)}. Hosted by ${escapeHtml(podcast.host)}.</span>
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

const renderSpreakerPlayer = (episode) => `
  <a
    id="spreaker-player-${escapeHtml(episode.id)}"
    class="spreaker-player"
    href="${escapeHtml(episode.spreakerUrl)}"
    data-resource="${escapeHtml(episode.spreakerResource)}"
    data-width="100%"
    data-height="200px"
    data-theme="light"
    data-playlist="false"
    data-playlist-continuous="false"
    data-chapters-image="true"
    data-episode-image-position="right"
    data-hide-logo="false"
    data-hide-likes="false"
    data-hide-comments="false"
    data-hide-sharing="false"
    data-hide-download="true"
    data-title="${escapeHtml(episode.title)}"
  >Listen to "${escapeHtml(episode.title)}" on Spreaker.</a>`;

const renderPlaybackTracking = (episodes, countryCode) => {
  const audioPlayers = episodes.map((episode) => ({
    elementId: `spreaker-player-${episode.id}`,
    episodeId: episode.id,
    episodeTitle: episode.title
  }));
  const videoPlayers = episodes
    .filter((episode) => parseVideoUrl(episode.videoUrl))
    .map((episode) => ({
      elementId: `overview-video-${episode.id}`,
      episodeId: episode.id,
      episodeTitle: episode.title
    }));

  if (!audioPlayers.length && !videoPlayers.length) {
    return "";
  }

  return `
    <script>
      (function () {
        var countryCode = ${safeJson(countryCode)};
        var audioPlayers = ${safeJson(audioPlayers)};
        var videoPlayers = ${safeJson(videoPlayers)};
        var milestones = [20, 50, 75];

        function sendPlaybackEvent(type, episode, position, duration, mediaType, extraParameters) {
          var numericPosition = Number(position) || 0;
          var numericDuration = Number(duration) || 0;
          var playbackPercent =
            numericDuration > 0
              ? Math.min(100, Math.max(0, Math.round((numericPosition / numericDuration) * 100)))
              : 0;
          var eventName = mediaType + '_' + type + '_' + countryCode;
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

        function initializeAudioTracking(attempt) {
          if (!window.SP || typeof window.SP.getWidget !== 'function') {
            if (attempt < 20) {
              window.setTimeout(function () {
                initializeAudioTracking(attempt + 1);
              }, 500);
            }
            return;
          }

          audioPlayers.forEach(function (episode) {
            var element = document.getElementById(episode.elementId);
            if (!element || element.dataset.analyticsInitialized === 'true') return;

            var widget = window.SP.getWidget(episode.elementId);
            if (!widget || typeof widget.getState !== 'function') return;

            element.dataset.analyticsInitialized = 'true';
            var initialized = false;
            var previousPlaying = false;
            var polling = false;
            var completedMilestones = {};

            window.setInterval(function () {
              if (polling) return;
              polling = true;

              var stateRequested = widget.getState(function (_currentEpisode, _state, isPlaying) {
                var playing = Boolean(isPlaying);
                var positionRequested = widget.getPosition(function (position, _progress, duration) {
                  if (!initialized) {
                    initialized = true;
                    if (playing) {
                      sendPlaybackEvent('play', episode, position, duration, 'audio');
                    }
                  } else if (playing !== previousPlaying) {
                    sendPlaybackEvent(playing ? 'play' : 'pause', episode, position, duration, 'audio');
                  }

                  previousPlaying = playing;

                  if (playing && Number(duration) > 0) {
                    var progress = (Number(position) / Number(duration)) * 100;

                    milestones.forEach(function (milestone) {
                      if (completedMilestones[milestone] || progress < milestone) return;

                      completedMilestones[milestone] = true;
                      sendPlaybackEvent(
                        'progress_' + milestone,
                        episode,
                        position,
                        duration,
                        'audio',
                        { progress_percent: milestone }
                      );
                    });
                  }

                  polling = false;
                });

                if (positionRequested === false) {
                  if (!initialized && playing) {
                    sendPlaybackEvent('play', episode, 0, 0, 'audio');
                  } else if (initialized && playing !== previousPlaying) {
                    sendPlaybackEvent(playing ? 'play' : 'pause', episode, 0, 0, 'audio');
                  }

                  initialized = true;
                  previousPlaying = playing;
                  polling = false;
                }
              });

              if (stateRequested === false) {
                polling = false;
              }
            }, 1000);
          });
        }

        initializeAudioTracking(0);

        videoPlayers.forEach(function (episode) {
          var element = document.getElementById(episode.elementId);
          if (!element) return;

          var completedMilestones = {};

          function durationMs() {
            return Number.isFinite(element.duration) ? element.duration * 1000 : 0;
          }

          function positionMs() {
            return Number.isFinite(element.currentTime) ? element.currentTime * 1000 : 0;
          }

          element.addEventListener('play', function () {
            sendPlaybackEvent('play', episode, positionMs(), durationMs(), 'video');
          });

          element.addEventListener('pause', function () {
            if (element.ended) return;
            sendPlaybackEvent('pause', episode, positionMs(), durationMs(), 'video');
          });

          element.addEventListener('ended', function () {
            sendPlaybackEvent(
              'ended',
              episode,
              positionMs(),
              durationMs(),
              'video',
              { progress_percent: 100 }
            );
          });

          element.addEventListener('timeupdate', function () {
            if (!Number.isFinite(element.duration) || element.duration <= 0) return;

            var progress = (element.currentTime / element.duration) * 100;

            milestones.forEach(function (milestone) {
              if (completedMilestones[milestone] || progress < milestone) return;

              completedMilestones[milestone] = true;
              sendPlaybackEvent(
                'progress_' + milestone,
                episode,
                positionMs(),
                durationMs(),
                'video',
                { progress_percent: milestone }
              );
            });
          });
        });
      })();
    </script>`;
};

const renderHlsPlayback = (episodes) => {
  const hasHlsVideo = episodes.some((episode) => {
    const video = parseVideoUrl(episode.videoUrl);
    return video && isHlsVideoUrl(video.url);
  });

  if (!hasHlsVideo) {
    return "";
  }

  return `
    <script>
      window.initializeHlsPlayers = function () {
        document.querySelectorAll('video[data-hls-src]').forEach(function (element) {
          if (element.dataset.hlsInitialized === 'true') return;

          var source = element.getAttribute('data-hls-src');
          if (!source) return;

          if (window.Hls && window.Hls.isSupported()) {
            var hls = new window.Hls();
            element.dataset.hlsInitialized = 'true';
            hls.loadSource(source);
            hls.attachMedia(element);
            element._hls = hls;

            hls.on(window.Hls.Events.ERROR, function (_event, data) {
              if (!data.fatal) return;

              if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad();
                return;
              }

              if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
                return;
              }

              hls.destroy();
              element.dataset.hlsInitialized = 'false';
              var fallback = element.parentElement.querySelector('[data-hls-fallback]');
              if (fallback) fallback.hidden = false;
            });
            return;
          }

          if (element.canPlayType('application/vnd.apple.mpegurl')) {
            element.dataset.hlsInitialized = 'true';
            element.src = source;
            return;
          }

          var fallback = element.parentElement.querySelector('[data-hls-fallback]');
          if (fallback) fallback.hidden = false;
        });
      };

      window.showHlsFallback = function () {
        document.querySelectorAll('[data-hls-fallback]').forEach(function (fallback) {
          fallback.hidden = false;
        });
      };
    </script>
    <script
      src="https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js"
      onload="window.initializeHlsPlayers()"
      onerror="window.showHlsFallback()"
    ></script>`;
};

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
    <section class="episode-attachments" aria-labelledby="episode-materials-title">
      <p class="section-kicker">Supporting material</p>
      <h2 id="episode-materials-title">Episode materials</h2>
      <div class="attachment-grid">${items}</div>
    </section>`;
};

const renderVideoOverview = (episode) => {
  const video = parseVideoUrl(episode.videoUrl);

  if (!video) {
    return "";
  }

  const contentType = videoContentType(video.url);
  const posterUrl = cloudflareStreamThumbnailUrl(video.url);
  const isHls = isHlsVideoUrl(video.url);

  return `
    <section class="episode-video" aria-labelledby="video-overview-title">
      <p class="section-kicker">Watch</p>
      <h2 id="video-overview-title">Video overview</h2>
      <div class="video-player">
        <video
          id="overview-video-${escapeHtml(episode.id)}"
          class="overview-video-player"
          data-episode-id="${escapeHtml(episode.id)}"
          data-episode-title="${escapeHtml(episode.title)}"
          title="${escapeHtml(`${episode.title} video overview`)}"
          controls
          playsinline
          preload="metadata"
          ${isHls ? `data-hls-src="${escapeHtml(video.url)}"` : ""}
          ${posterUrl ? `poster="${escapeHtml(posterUrl)}"` : ""}
        >
          ${
            isHls
              ? ""
              : `<source src="${escapeHtml(video.url)}"${
                  contentType ? ` type="${escapeHtml(contentType)}"` : ""
                }>`
          }
          <a href="${escapeHtml(video.url)}">Watch the video overview</a>
        </video>
        ${
          isHls
            ? `<p data-hls-fallback hidden><a href="${escapeHtml(
                video.url
              )}">Open the video stream directly</a></p>`
            : ""
        }
      </div>
    </section>`;
};

const renderTranscript = (episode) => {
  if (!episode.transcriptContent?.paragraphs?.length) {
    return "";
  }

  const visibleParagraphs = episode.transcriptContent.paragraphs.slice(0, 3);
  const remainingParagraphs = episode.transcriptContent.paragraphs.slice(3);

  return `
    <section class="episode-transcript" id="transcript" aria-labelledby="transcript-title">
      <p class="section-kicker">Full text</p>
      <h2 id="transcript-title">${escapeHtml(episode.title)} transcript</h2>
      <p class="transcript-intro">Transcript excerpt supplied by Spreaker.</p>
      <div class="transcript-preview">
        ${visibleParagraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
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
      )}" target="_blank" rel="noopener">View original transcript on Spreaker</a>
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
  facebookPixelId = ""
}) => `
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    ${renderGoogleAnalytics(podcast.googleAnalyticsId)}
    ${renderFacebookPixel(facebookPixelId)}
    <script data-cfasync="false" src="https://cmp.gatekeeperconsent.com/min.js"></script>
    <script data-cfasync="false" src="https://the.gatekeeperconsent.com/cmp.min.js"></script>
    <script async src="//www.ezojs.com/ezoic/sa.min.js"></script>
    <script>
      window.ezstandalone = window.ezstandalone || {};
      ezstandalone.cmd = ezstandalone.cmd || [];
    </script>
    <script src="//ezoicanalytics.com/analytics.js"></script>
    <script type="text/javascript">
      var infolinks_pid = 3446247;
      var infolinks_wsid = 0;
    </script>
    <script type="text/javascript" src="https://resources.infolinks.com/js/infolinks_main.js"></script>
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
    min-height: calc(100vh - 84px);
    padding: 64px 0;
    align-items: center;
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

  .episode-body {
    color: #332d28;
    font-size: 1.08rem;
  }

  .episode-body p {
    margin: 0 0 18px;
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

  .video-player video {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: #101215;
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

  .player-wrap {
    padding: 18px;
    border: 1px solid #ddd2c4;
    border-radius: 8px;
    background: #fffaf2;
    box-shadow: 0 18px 48px rgba(20, 15, 12, 0.14);
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
    .episode-hero,
    .case-grid,
    .category-grid,
    .attachment-grid,
    .related-episode-grid {
      grid-template-columns: 1fr;
    }

    .category-heading {
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
  </body>
</html>`;

const renderPage = (
  episodes,
  featuredEpisode = episodes[0],
  categories = buildEpisodeCategories(episodes),
  selectedCategory = null,
  requestedPage = 1,
  analytics = {}
) => {
  const activeCategory = categories.find((category) => category.slug === selectedCategory);
  const visibleEpisodes = activeCategory?.episodes ?? episodes;
  const totalPages = Math.max(1, Math.ceil(visibleEpisodes.length / EPISODES_PER_PAGE));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const pageStart = (currentPage - 1) * EPISODES_PER_PAGE;
  const paginatedEpisodes = visibleEpisodes.slice(pageStart, pageStart + EPISODES_PER_PAGE);
  const firstVisibleEpisode = visibleEpisodes.length ? pageStart + 1 : 0;
  const lastVisibleEpisode = Math.min(pageStart + paginatedEpisodes.length, visibleEpisodes.length);
  const pageTitle = activeCategory
    ? `${activeCategory.label} Episodes | ${podcast.name}`
    : podcast.name;
  const title = currentPage > 1 ? `${pageTitle} | Page ${currentPage}` : pageTitle;

  return `<!doctype html>
<html lang="en">
  ${renderHead({
    title,
    description: activeCategory?.description ?? podcast.description,
    facebookPixelId: analytics.facebookPixelId
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
            <a class="button" href="#listen">Listen now</a>
            <a class="button secondary" href="${escapeHtml(episodePath(featuredEpisode))}">Episode details</a>
          </div>
        </div>
      </section>
    </div>

    <main>
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
          <div class="player-wrap">
            ${renderSpreakerPlayer(featuredEpisode)}
          </div>
        </div>
      </section>

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
            <p class="pagination-summary">Showing ${escapeHtml(firstVisibleEpisode)}-${escapeHtml(
              lastVisibleEpisode
            )} of ${escapeHtml(visibleEpisodes.length)} episodes</p>
          </div>
          ${
            activeCategory
              ? '<a class="clear-category" href="/#cases">View all episodes</a>'
              : ""
          }
        </div>
        <div class="case-grid">
          ${renderCases(paginatedEpisodes)}
        </div>
        ${renderPagination(currentPage, totalPages, activeCategory?.slug ?? null)}
      </section>

      ${renderFooter()}
    </main>

    <script async src="https://widget.spreaker.com/widgets.js"></script>
    ${renderPlaybackTracking([featuredEpisode], analytics.countryCode)}
  </body>
</html>`;
};

const renderEpisodePage = (episode, episodes, analytics = {}) => `<!doctype html>
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
          <p class="lede">${escapeHtml(episode.summary)}</p>
        </div>
        <aside class="episode-play-panel" aria-label="Episode player">
          ${renderEpisodeImage(episode, "episode-meta-image")}
          <p class="section-kicker">${escapeHtml(episode.publishedAt ?? "Episode")}</p>
          <a class="button" href="${escapeHtml(episode.href)}">Listen on Spreaker</a>
          ${
            episode.transcriptContent
              ? '<a class="button transcript-button" href="#transcript">Read episode transcript</a>'
              : ""
          }
          <div class="player-wrap">
            ${renderSpreakerPlayer(episode)}
          </div>
        </aside>
      </section>
    </div>

    <main>
      <article class="section episode-detail-layout">
        ${renderVideoOverview(episode)}
        ${renderAttachments(episode)}
        <div class="episode-body">
          ${(episode.body?.length ? episode.body : [episode.summary])
            .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
            .join("")}
        </div>
        ${renderTranscript(episode)}
      </article>
      ${renderRelatedEpisodes(episode, episodes)}
      ${renderFooter()}
    </main>

    <script async src="https://widget.spreaker.com/widgets.js"></script>
    ${renderHlsPlayback([episode])}
    ${renderPlaybackTracking([episode], analytics.countryCode)}
  </body>
</html>`;

const renderSearchPage = (query, results) => {
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
  </body>
</html>`;
};

const renderAdminPage = (episodes, contentByEpisode, notice = "") => {
  const episodeOptions = episodes
    .map(
      (episode) =>
        `<option value="${escapeHtml(episode.id)}">${escapeHtml(episode.title)}</option>`
    )
    .join("");

  const contentLists = episodes
    .filter((episode) => {
      const content = contentByEpisode.get(episode.id);
      return content?.videoUrl || content?.attachments?.length;
    })
    .map((episode) => {
      const content = contentByEpisode.get(episode.id) ?? emptyEpisodeContent();
      const video = parseVideoUrl(content.videoUrl);
      const videoOverview = video
        ? `
            <div class="admin-attachment">
              <div>
                <strong>Video overview</strong>
                <div><a href="${escapeHtml(
                  video.url
                )}" target="_blank" rel="noopener">${escapeHtml(video.url)}</a></div>
              </div>
              <form method="post" action="/admin/content/video">
                <input type="hidden" name="episodeId" value="${escapeHtml(episode.id)}">
                <input type="hidden" name="videoUrl" value="">
                <button class="danger-button" type="submit">Remove</button>
              </form>
            </div>`
        : "";
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
          ${videoOverview}
          ${attachments}
        </section>`;
    })
    .join("");

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
        <p class="section-kicker">Administration</p>
        <h1>Episode content</h1>
        <p>Add a video overview link or upload images, PDFs, and other supporting files for an episode.</p>
        ${notice ? `<p class="admin-notice">${escapeHtml(notice)}</p>` : ""}
        <form class="admin-form" method="post" action="/admin/content/video">
          <label>
            Episode
            <select name="episodeId" required>${episodeOptions}</select>
          </label>
          <label>
            Video URL
            <input
              type="url"
              name="videoUrl"
              placeholder="https://customer-...cloudflarestream.com/.../manifest/video.m3u8"
              required
            >
          </label>
          <button class="button" type="submit">Save video overview</button>
        </form>
      </section>
      <section class="admin-panel">
        <p class="section-kicker">Supporting material</p>
        <h2>Upload a file</h2>
        <form class="admin-form" method="post" action="/admin/content/upload" enctype="multipart/form-data">
          <label>
            Episode
            <select name="episodeId" required>${episodeOptions}</select>
          </label>
          <label>
            Display title
            <input name="title" maxlength="140" required>
          </label>
          <label>
            Description
            <textarea name="description" maxlength="2000"></textarea>
          </label>
          <label>
            File (maximum ${escapeHtml(formatFileSize(MAX_UPLOAD_BYTES))})
            <input type="file" name="file" required>
          </label>
          <button class="button" type="submit">Upload content</button>
        </form>
      </section>
      <section class="admin-panel">
        <p class="section-kicker">Current content</p>
        <h2>Episode videos and files</h2>
        ${contentLists || "<p>No episode content has been added yet.</p>"}
      </section>
    </main>
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
  const attachments = await loadAttachments(env, episodeId);
  const attachment = attachments.find((item) => item.id === attachmentId);

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
  headers.set(
    "content-disposition",
    `${attachment.type === "image" || attachment.type === "pdf" ? "inline" : "attachment"}; filename="${attachment.filename.replaceAll('"', "")}"`
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
      env.ADMIN_PASSWORD
        ? "Authentication required"
        : "Set the ADMIN_PASSWORD Worker secret before using this tool."
    );
  }

  const episodes = await loadEpisodes();
  const contentEntries = await Promise.all(
    episodes.map(async (episode) => [episode.id, await loadEpisodeContent(env, episode.id)])
  );
  const notices = {
    uploaded: "Content uploaded successfully.",
    deleted: "Content deleted.",
    videoSaved: "Video overview saved.",
    videoRemoved: "Video overview removed.",
    missing: "The selected episode or file could not be found."
  };

  return new Response(
    renderAdminPage(episodes, new Map(contentEntries), notices[url.searchParams.get("status")]),
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

  const id = crypto.randomUUID();
  const filename = sanitizeFilename(file.name);
  const objectKey = `episodes/${episodeId}/attachments/${id}/${filename}`;
  const contentType = file.type || "application/octet-stream";
  const attachment = {
    id,
    objectKey,
    filename,
    title,
    description,
    contentType,
    type: attachmentType(contentType),
    size: file.size,
    uploadedAt: new Date().toISOString()
  };

  await env.EPISODE_CONTENT.put(objectKey, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { episodeId, attachmentId: id }
  });

  try {
    const attachments = await loadAttachments(env, episodeId);
    await saveAttachments(env, episodeId, [...attachments, attachment]);
  } catch (error) {
    await env.EPISODE_CONTENT.delete(objectKey);
    throw error;
  }

  return adminRedirect(request, "?status=uploaded");
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
    return new Response("A valid HTTPS video URL is required", { status: 400 });
  }

  const episodes = await loadEpisodes();

  if (!episodes.some((episode) => episode.id === episodeId)) {
    return adminRedirect(request, "?status=missing");
  }

  const content = await loadEpisodeContent(env, episodeId);
  await saveEpisodeContent(env, episodeId, {
    ...content,
    videoUrl: video?.url ?? ""
  });

  return adminRedirect(
    request,
    video ? "?status=videoSaved" : "?status=videoRemoved"
  );
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
    const cacheControl = `public, max-age=${podcast.spreaker.cacheSeconds}`;
    const isApiRequest = url.pathname === "/api/podcast" || url.pathname === "/api/podcast/";
    const analytics = {
      countryCode: getCountryCode(request),
      facebookPixelId: env.FACEBOOK_PIXEL_ID || ""
    };

    if (request.method === "OPTIONS" && isApiRequest) {
      return new Response(null, { status: 204, headers: API_HEADERS });
    }

    if (url.pathname.startsWith("/assets/") || url.pathname === "/hero.png") {
      return env.ASSETS.fetch(request);
    }

    try {
      if (isApiRequest && !["GET", "HEAD"].includes(request.method)) {
        return jsonResponse(
          { error: { code: "method_not_allowed", message: "Use GET for this endpoint." } },
          405
        );
      }

      if (isApiRequest) {
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

      if (url.pathname === "/admin/content" && request.method === "GET") {
        return handleAdminPage(request, env, url);
      }

      if (url.pathname === "/admin/content/upload" && request.method === "POST") {
        return handleUpload(request, env);
      }

      if (
        (url.pathname === "/admin/content/video" || url.pathname === "/admin/content/youtube") &&
        request.method === "POST"
      ) {
        return handleVideoOverview(request, env);
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

        return new Response(renderSearchPage(query, results), {
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
        episode.videoUrl = episodeContent.videoUrl;
        ctx.waitUntil(notifyEpisodeView(env, request, episode));

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

      return new Response(`Unable to load Spreaker episodes: ${error.message}`, {
        status: 502,
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    }
  }
};
