const SHOW_ID = "6837695";
const FEED_URL = `https://www.spreaker.com/show/${SHOW_ID}/episodes/feed`;
const API_BASE = "https://api.spreaker.com/v2";
const TOKEN_URL = "https://api.spreaker.com/oauth2/token";
const AUTHORIZE_URL = "https://www.spreaker.com/oauth2/authorize";
const DASHBOARD_PATH = "/admin/spreaker";
const CALLBACK_PATH = `${DASHBOARD_PATH}/oauth/callback`;
const TOKEN_KEY = "private/spreaker/oauth-token.json";
const MONETIZATION_KEY = "private/spreaker/monetization.json";
const STATE_PREFIX = "private/spreaker/oauth-state/";
const MAX_MONETIZATION_CSV_BYTES = 5 * 1024 * 1024;
const PLAYBACK_MILESTONES = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
const ZONE_RESULTS_PER_PAGE = 25;
const LIVE_CHART_MAX_POINTS = 72;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const jsonFromR2 = async (env, key) => {
  const object = await env.EPISODE_CONTENT.get(key);
  return object ? object.json() : null;
};

const putJson = (env, key, value) =>
  env.EPISODE_CONTENT.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" }
  });

const redirectUri = (request) => new URL(CALLBACK_PATH, request.url).toString();

const configured = (env) =>
  Boolean(env.SPREAKER_CLIENT_ID && env.SPREAKER_CLIENT_SECRET && env.EPISODE_CONTENT);

const exchangeToken = async (env, fields) => {
  const form = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  form.set("client_id", env.SPREAKER_CLIENT_ID);
  form.set("client_secret", env.SPREAKER_CLIENT_SECRET);

  const response = await fetch(TOKEN_URL, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    const message =
      payload.error_description || payload.error || `Spreaker OAuth failed (${response.status})`;
    throw new Error(String(message));
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type || "Bearer",
    scope: payload.scope || "basic",
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
    updatedAt: new Date().toISOString()
  };
};

const getAccessToken = async (env) => {
  const token = await jsonFromR2(env, TOKEN_KEY);

  if (!token?.accessToken) return null;
  if (Number(token.expiresAt) > Date.now() + 60_000) return token.accessToken;
  if (!token.refreshToken) return null;

  const refreshed = await exchangeToken(env, {
    grant_type: "refresh_token",
    refresh_token: token.refreshToken
  });

  if (!refreshed.refreshToken) refreshed.refreshToken = token.refreshToken;
  await putJson(env, TOKEN_KEY, refreshed);
  return refreshed.accessToken;
};

const apiRequest = async (path, accessToken) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": "TheLastKnownPodcastDashboard/1.0"
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.response?.error?.messages?.join("; ") || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload.response;
};

const dateString = (date) => date.toISOString().slice(0, 10);
const hourString = (hour) => String(hour).padStart(2, "0");

const dashboardDates = (url) => {
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(today.getUTCDate() - 29);
  const validDate = /^\d{4}-\d{2}-\d{2}$/;
  let from = validDate.test(url.searchParams.get("from") || "")
    ? url.searchParams.get("from")
    : dateString(defaultFrom);
  let to = validDate.test(url.searchParams.get("to") || "")
    ? url.searchParams.get("to")
    : dateString(today);
  const validHour = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
  };
  let fromHour = validHour(url.searchParams.get("fromhour"), 0);
  let toHour = validHour(url.searchParams.get("tohour"), 23);

  if (`${from}T${hourString(fromHour)}` > `${to}T${hourString(toHour)}`) {
    [from, to] = [to, from];
    [fromHour, toHour] = [toHour, fromHour];
  }

  const earliest = new Date(`${to}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 365);
  if (from < dateString(earliest)) from = dateString(earliest);

  const fromTimestamp = `${from}T${hourString(fromHour)}:00:00.000Z`;
  const toHourStart = new Date(`${to}T${hourString(toHour)}:00:00.000Z`);
  const toTimestamp = new Date(toHourStart.getTime() + 60 * 60 * 1000).toISOString();
  return { from, to, fromHour, toHour, fromTimestamp, toTimestamp };
};

const liveBucketSeconds = (rangeSeconds) => {
  const choices = [60, 5 * 60, 15 * 60, 60 * 60, 6 * 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60];
  return choices.find((seconds) => Math.ceil(rangeSeconds / seconds) <= LIVE_CHART_MAX_POINTS)
    || choices.at(-1);
};

const liveAnalyticsForRange = async (
  env,
  fromTimestamp,
  toTimestamp,
  requestedZone = "",
  requestedCampaign = ""
) => {
  if (!env.SITE_ANALYTICS) return null;

  const zoneFilter = validAttributionFilter(requestedZone);
  const campaignFilter = validAttributionFilter(requestedCampaign);
  const requestedFrom = Date.parse(fromTimestamp);
  const requestedTo = Date.parse(toTimestamp);
  const now = Date.now();
  const effectiveTo = requestedFrom <= now && requestedTo > now ? now : requestedTo;
  const rangeSeconds = Math.max(60, Math.ceil((effectiveTo - requestedFrom) / 1000));
  const bucketSeconds = liveBucketSeconds(rangeSeconds);
  const bucketStart = Math.floor(requestedFrom / 1000 / bucketSeconds) * bucketSeconds;
  const bucketEnd = Math.floor(Math.max(requestedFrom, effectiveTo - 1) / 1000 / bucketSeconds) * bucketSeconds;
  const effectiveToTimestamp = new Date(effectiveTo).toISOString();
  const [result, summaryResult] = await env.SITE_ANALYTICS.batch([
    env.SITE_ANALYTICS.prepare(`
      SELECT
        CAST(CAST(strftime('%s', occurred_at) AS INTEGER) / ?5 AS INTEGER) * ?5 AS bucket_unix,
        COUNT(DISTINCT CASE
          WHEN event_type = 'page_view' AND page_path LIKE '/episodes/%/listen%'
          THEN session_id
        END) AS sessions,
        SUM(CASE WHEN event_type IN ('audio_play', 'video_play') THEN 1 ELSE 0 END) AS plays
      FROM site_events
      WHERE occurred_at >= ?1 AND occurred_at < ?2
        AND (?3 = '' OR zone_id = ?3)
        AND (?4 = '' OR campaign_id = ?4)
      GROUP BY bucket_unix
      ORDER BY bucket_unix
    `).bind(fromTimestamp, effectiveToTimestamp, zoneFilter, campaignFilter, bucketSeconds),
    env.SITE_ANALYTICS.prepare(`
      SELECT
        COUNT(DISTINCT CASE
          WHEN event_type = 'page_view' AND page_path LIKE '/episodes/%/listen%'
          THEN session_id
        END) AS sessions,
        SUM(CASE WHEN event_type IN ('audio_play', 'video_play') THEN 1 ELSE 0 END) AS plays
      FROM site_events
      WHERE occurred_at >= ?1 AND occurred_at < ?2
        AND (?3 = '' OR zone_id = ?3)
        AND (?4 = '' OR campaign_id = ?4)
    `).bind(fromTimestamp, effectiveToTimestamp, zoneFilter, campaignFilter)
  ]);
  const rowsByBucket = new Map(
    (result.results || []).map((row) => [Number(row.bucket_unix), row])
  );
  const points = [];

  for (let bucket = bucketStart; bucket <= bucketEnd; bucket += bucketSeconds) {
    const row = rowsByBucket.get(bucket) || {};
    const sessions = Number(row.sessions) || 0;
    const plays = Number(row.plays) || 0;
    points.push({
      timestamp: new Date(bucket * 1000).toISOString(),
      sessions,
      plays,
      playbackRate: sessions > 0 ? Math.round((plays / sessions) * 1000) / 10 : 0
    });
  }

  const summary = summaryResult.results?.[0] || {};
  const totalSessions = Number(summary.sessions) || 0;
  const totalPlays = Number(summary.plays) || 0;
  return {
    updatedAt: new Date().toISOString(),
    bucketSeconds,
    zoneFilter,
    campaignFilter,
    points,
    currentSessions: points.at(-1)?.sessions || 0,
    totalSessions,
    totalPlays,
    overallPlaybackRate: totalSessions > 0
      ? Math.round((totalPlays / totalSessions) * 1000) / 10
      : 0
  };
};

const siteAnalyticsForRange = async (env, fromTimestamp, toTimestamp, requestedCampaign = "") => {
  if (!env.SITE_ANALYTICS) return null;
  const campaignFilter = validAttributionFilter(requestedCampaign);
  const range = [fromTimestamp, toTimestamp, campaignFilter];
  const results = await env.SITE_ANALYTICS.batch([
    env.SITE_ANALYTICS.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS visitors,
        SUM(CASE WHEN event_type IN ('audio_play', 'video_play') THEN 1 ELSE 0 END) AS plays,
        COUNT(DISTINCT CASE WHEN event_type IN ('audio_play', 'video_play') THEN session_id END) AS listeners,
        SUM(CASE WHEN event_type IN ('audio_ended', 'video_ended') THEN 1 ELSE 0 END) AS completions,
        SUM(CASE WHEN event_type = 'episode_link_click' THEN 1 ELSE 0 END) AS platform_clicks,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND page_path LIKE '/episodes/%/listen%' THEN session_id END) AS listen_page_visitors,
        COUNT(DISTINCT CASE WHEN event_type = 'episode_link_click' THEN session_id END) AS platform_clickers
      FROM site_events
      WHERE occurred_at >= ?1 AND occurred_at < ?2
        AND (?3 = '' OR campaign_id = ?3)
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT COALESCE(SUM(max_position_ms), 0) AS listening_ms,
             COALESCE(AVG(max_percent), 0) AS average_percent
      FROM (
        SELECT session_id, episode_id,
               MAX(playback_position_ms) AS max_position_ms,
               MAX(playback_percent) AS max_percent
        FROM site_events
        WHERE occurred_at >= ?1 AND occurred_at < ?2
          AND (?3 = '' OR campaign_id = ?3)
          AND media_type IN ('audio', 'video')
        GROUP BY session_id, episode_id
      )
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT page_path, COUNT(*) AS views,
             COUNT(DISTINCT session_id) AS visitors
      FROM site_events
      WHERE event_type = 'page_view' AND occurred_at >= ?1 AND occurred_at < ?2
        AND (?3 = '' OR campaign_id = ?3)
      GROUP BY page_path ORDER BY views DESC LIMIT 15
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT COALESCE(NULLIF(episode_title, ''), NULLIF(episode_id, ''), 'Unknown episode') AS episode,
             SUM(CASE WHEN event_type IN ('audio_play', 'video_play') THEN 1 ELSE 0 END) AS plays,
             COUNT(DISTINCT CASE WHEN event_type IN ('audio_play', 'video_play') THEN session_id END) AS listeners,
             MAX(playback_percent) AS max_percent,
             SUM(CASE WHEN event_type IN ('audio_ended', 'video_ended') THEN 1 ELSE 0 END) AS completions
      FROM site_events
      WHERE occurred_at >= ?1 AND occurred_at < ?2
        AND (?3 = '' OR campaign_id = ?3) AND episode_id <> ''
      GROUP BY episode_id, episode_title ORDER BY plays DESC, listeners DESC LIMIT 20
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT platform, COUNT(*) AS clicks
      FROM site_events
      WHERE event_type = 'episode_link_click' AND occurred_at >= ?1 AND occurred_at < ?2
        AND (?3 = '' OR campaign_id = ?3)
      GROUP BY platform ORDER BY clicks DESC
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT country_code, COUNT(DISTINCT session_id) AS visitors
      FROM site_events
      WHERE event_type = 'page_view' AND occurred_at >= ?1 AND occurred_at < ?2
        AND (?3 = '' OR campaign_id = ?3)
      GROUP BY country_code ORDER BY visitors DESC LIMIT 20
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT CASE WHEN referrer = '' THEN 'Direct / unknown' ELSE referrer END AS referrer,
             COUNT(DISTINCT session_id) AS visitors
      FROM site_events
      WHERE event_type = 'page_view' AND occurred_at >= ?1 AND occurred_at < ?2
        AND (?3 = '' OR campaign_id = ?3)
      GROUP BY referrer ORDER BY visitors DESC LIMIT 15
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT campaign_id,
             COUNT(DISTINCT CASE
               WHEN event_type = 'page_view' THEN session_id
             END) AS visitors
      FROM site_events
      GROUP BY campaign_id
      ORDER BY CASE WHEN campaign_id = 'unattributed' THEN 1 ELSE 0 END, campaign_id
    `)
  ]);

  return {
    campaignFilter,
    campaignOptions: results[7]?.results || [],
    summary: results[0]?.results?.[0] || {},
    playback: results[1]?.results?.[0] || {},
    pages: results[2]?.results || [],
    episodes: results[3]?.results || [],
    platforms: results[4]?.results || [],
    countries: results[5]?.results || [],
    referrers: results[6]?.results || []
  };
};

const validAttributionFilter = (value) => {
  const attributionId = String(value ?? "").trim();
  return /^[A-Za-z0-9._:-]{1,100}$/.test(attributionId) ? attributionId : "";
};

const validMetricFilter = (value, maximum, integer = false) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const bounded = Math.min(maximum, Math.max(0, parsed));
  return integer ? Math.floor(bounded) : Math.round(bounded * 10) / 10;
};

const zoneMetricFilters = (values = {}) => {
  let minPlays = validMetricFilter(values.minPlays, 1_000_000_000, true);
  let maxPlays = validMetricFilter(values.maxPlays, 1_000_000_000, true);
  let minBounce = validMetricFilter(values.minBounce, 100);
  let maxBounce = validMetricFilter(values.maxBounce, 100);
  let minPlayback = validMetricFilter(values.minPlayback, 100);
  let maxPlayback = validMetricFilter(values.maxPlayback, 100);
  if (minPlays !== null && maxPlays !== null && minPlays > maxPlays) {
    [minPlays, maxPlays] = [maxPlays, minPlays];
  }
  if (minBounce !== null && maxBounce !== null && minBounce > maxBounce) {
    [minBounce, maxBounce] = [maxBounce, minBounce];
  }
  if (minPlayback !== null && maxPlayback !== null && minPlayback > maxPlayback) {
    [minPlayback, maxPlayback] = [maxPlayback, minPlayback];
  }
  return { minPlays, maxPlays, minBounce, maxBounce, minPlayback, maxPlayback };
};

const zoneAnalyticsForRange = async (
  env,
  fromTimestamp,
  toTimestamp,
  requestedZone = "",
  requestedCampaign = "",
  requestedFilters = {}
) => {
  if (!env.SITE_ANALYTICS) return null;

  const zoneFilter = validAttributionFilter(requestedZone);
  const campaignFilter = validAttributionFilter(requestedCampaign);
  const filters = zoneMetricFilters(requestedFilters);
  const milestoneColumns = PLAYBACK_MILESTONES.map(
    (milestone) =>
      `SUM(CASE WHEN event_type = 'audio_progress' AND ROUND(playback_percent) = ${milestone} THEN 1 ELSE 0 END) AS milestone_${milestone}`
  ).join(",\n             ");
  const [zoneOptionsResult, campaignOptionsResult, zoneRowsResult] = await env.SITE_ANALYTICS.batch([
    env.SITE_ANALYTICS.prepare(`
      SELECT zone_id,
             COUNT(DISTINCT CASE
               WHEN event_type = 'page_view' AND page_path LIKE '/episodes/%/listen%'
               THEN session_id
             END) AS sessions
      FROM site_events
      WHERE occurred_at >= ?1 AND occurred_at < ?2
      GROUP BY zone_id
      ORDER BY CASE WHEN zone_id = 'unattributed' THEN 1 ELSE 0 END, zone_id
    `).bind(fromTimestamp, toTimestamp),
    env.SITE_ANALYTICS.prepare(`
      SELECT campaign_id,
             COUNT(DISTINCT CASE
               WHEN event_type = 'page_view' AND page_path LIKE '/episodes/%/listen%'
               THEN session_id
             END) AS sessions
      FROM site_events
      GROUP BY campaign_id
      ORDER BY CASE WHEN campaign_id = 'unattributed' THEN 1 ELSE 0 END, campaign_id
    `),
    env.SITE_ANALYTICS.prepare(`
      WITH filtered AS (
        SELECT zone_id, campaign_id, session_id, episode_id, event_type, page_path, playback_percent
        FROM site_events
        WHERE occurred_at >= ?1 AND occurred_at < ?2
          AND (?3 = '' OR zone_id = ?3)
          AND (?4 = '' OR campaign_id = ?4)
      ),
      attributions AS (
        SELECT DISTINCT zone_id, campaign_id FROM filtered
      ),
      session_rollup AS (
        SELECT
          zone_id,
          campaign_id,
          session_id,
          MAX(CASE WHEN event_type = 'page_view' AND page_path LIKE '/episodes/%/listen%' THEN 1 ELSE 0 END) AS visited_listen_page,
          MAX(CASE WHEN event_type = 'audio_play' THEN 1 ELSE 0 END) AS played_audio
        FROM filtered
        GROUP BY zone_id, campaign_id, session_id
      ),
      session_summary AS (
        SELECT
          zone_id,
          campaign_id,
          SUM(visited_listen_page) AS sessions,
          SUM(CASE WHEN visited_listen_page = 1 AND played_audio = 0 THEN 1 ELSE 0 END) AS bounces
        FROM session_rollup
        GROUP BY zone_id, campaign_id
      ),
      playback_summary AS (
        SELECT
          zone_id,
          campaign_id,
          SUM(CASE WHEN event_type = 'audio_play' THEN 1 ELSE 0 END) AS plays,
          ${milestoneColumns}
        FROM filtered
        GROUP BY zone_id, campaign_id
      )
      SELECT
        attributions.zone_id,
        attributions.campaign_id,
        COALESCE(session_summary.sessions, 0) AS sessions,
        COALESCE(session_summary.bounces, 0) AS bounces,
        COALESCE(playback_summary.plays, 0) AS plays,
        ${PLAYBACK_MILESTONES.map(
          (milestone) => `COALESCE(playback_summary.milestone_${milestone}, 0) AS milestone_${milestone}`
        ).join(",\n        ")}
      FROM attributions
      LEFT JOIN session_summary USING (zone_id, campaign_id)
      LEFT JOIN playback_summary USING (zone_id, campaign_id)
      ORDER BY plays DESC, sessions DESC, attributions.zone_id, attributions.campaign_id
    `).bind(fromTimestamp, toTimestamp, zoneFilter, campaignFilter)
  ]);

  const rows = (zoneRowsResult?.results || []).filter((row) => {
    const plays = Number(row.plays) || 0;
    const sessions = Number(row.sessions) || 0;
    const bounceRate = sessions > 0 ? ((Number(row.bounces) || 0) / sessions) * 100 : 0;
    const playbackPercent = sessions > 0 ? (plays / sessions) * 100 : 0;
    return (
      (filters.minPlays === null || plays >= filters.minPlays) &&
      (filters.maxPlays === null || plays <= filters.maxPlays) &&
      (filters.minBounce === null || bounceRate >= filters.minBounce) &&
      (filters.maxBounce === null || bounceRate <= filters.maxBounce) &&
      (filters.minPlayback === null || playbackPercent >= filters.minPlayback) &&
      (filters.maxPlayback === null || playbackPercent <= filters.maxPlayback)
    );
  });

  return {
    zoneFilter,
    campaignFilter,
    filters,
    zoneOptions: zoneOptionsResult?.results || [],
    campaignOptions: campaignOptionsResult?.results || [],
    rows
  };
};

const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

const RAW_EVENT_COLUMNS = [
  "id",
  "event_id",
  "occurred_at",
  "session_id",
  "event_type",
  "page_path",
  "episode_id",
  "episode_slug",
  "episode_title",
  "media_type",
  "player_provider",
  "playback_position_ms",
  "playback_duration_ms",
  "playback_percent",
  "platform",
  "referrer",
  "country_code",
  "zone_id",
  "campaign_id",
  "click_id",
  "user_agent"
];

const rawEventsCsvResponse = (
  request,
  env,
  { from, to, fromHour, toHour, fromTimestamp, toTimestamp },
  requestedZone,
  requestedCampaign
) => {
  const headers = {
    "content-type": "text/csv;charset=UTF-8",
    "content-disposition": `attachment; filename="site-events-${from}-${hourString(fromHour)}00-to-${to}-${hourString(toHour)}59.csv"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (request.method === "HEAD") return new Response(null, { headers });
  if (!env.SITE_ANALYTICS) return new Response("SITE_ANALYTICS is unavailable.\r\n", { status: 503, headers });

  const zoneFilter = validAttributionFilter(requestedZone);
  const campaignFilter = validAttributionFilter(requestedCampaign);
  const encoder = new TextEncoder();
  let lastId = 0;
  let headerPending = true;

  const body = new ReadableStream({
    async pull(controller) {
      try {
        const result = await env.SITE_ANALYTICS.prepare(`
          SELECT ${RAW_EVENT_COLUMNS.join(", ")}
          FROM site_events
          WHERE occurred_at >= ?1 AND occurred_at < ?2
            AND (?3 = '' OR zone_id = ?3)
            AND (?4 = '' OR campaign_id = ?4)
            AND id > ?5
          ORDER BY id
          LIMIT 1000
        `).bind(fromTimestamp, toTimestamp, zoneFilter, campaignFilter, lastId).all();
        const rows = result?.results || [];
        const records = [];
        if (headerPending) {
          records.push(RAW_EVENT_COLUMNS.map(csvCell).join(","));
          headerPending = false;
        }
        records.push(...rows.map((row) => RAW_EVENT_COLUMNS.map((column) => csvCell(row[column])).join(",")));
        if (records.length) controller.enqueue(encoder.encode(`${records.join("\r\n")}\r\n`));
        if (rows.length < 1000) {
          controller.close();
          return;
        }
        lastId = Number(rows.at(-1).id);
      } catch (error) {
        console.error("Unable to stream raw site analytics CSV", error);
        controller.error(error);
      }
    }
  });

  return new Response(body, { headers });
};

const number = (value) => new Intl.NumberFormat("en-US").format(Number(value) || 0);
const percent = (value) => `${Number(value || 0).toFixed(1)}%`;
const currency = (value, currencyCode = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(
    Number(value) || 0
  );
const duration = (milliseconds) => {
  const totalMinutes = Math.round((Number(milliseconds) || 0) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
};

const normalizedHeader = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const numericCsvValue = (value) => {
  const normalized = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const monetizationFromCsv = (text, filename) => {
  const records = parseCsv(text.replace(/^\uFEFF/, ""));
  if (records.length < 2) throw new Error("The CSV does not contain any monetization rows.");

  const headers = records[0].map(normalizedHeader);
  const findColumn = (...names) => headers.findIndex((header) => names.includes(header));
  const dateIndex = findColumn("date", "day");
  const impressionIndex = findColumn(
    "impressions",
    "impression",
    "impressionscount",
    "impressionssold"
  );
  const revenueIndex = findColumn(
    "revenue",
    "earnings",
    "amount",
    "revenueusd",
    "revenueamount"
  );
  const impressionsDownloadIndex = findColumn("impressionsdownload");
  const impressionsOndemandIndex = findColumn("impressionsondemand");
  const impressionsLiveIndex = findColumn("impressionslive");
  const revenueDownloadIndex = findColumn("revenuedownload");
  const revenueOndemandIndex = findColumn("revenueondemand");
  const revenueLiveIndex = findColumn("revenuelive");
  const labelIndex = findColumn(
    "name",
    "podcast",
    "show",
    "episode",
    "country",
    "category",
    "iabcategory",
    "network"
  );

  if (dateIndex < 0 || impressionIndex < 0 || revenueIndex < 0) {
    throw new Error(
      "Expected date, impressions_sold, and revenue_amount columns in the Spreaker CSV."
    );
  }

  const rows = records
    .slice(1)
    .map((record) => ({
      date: String(record[dateIndex] || "").trim().slice(0, 10),
      impressions: Math.max(0, numericCsvValue(record[impressionIndex])),
      revenue: numericCsvValue(record[revenueIndex]),
      impressionsDownload:
        impressionsDownloadIndex >= 0
          ? Math.max(0, numericCsvValue(record[impressionsDownloadIndex]))
          : 0,
      impressionsOndemand:
        impressionsOndemandIndex >= 0
          ? Math.max(0, numericCsvValue(record[impressionsOndemandIndex]))
          : 0,
      impressionsLive:
        impressionsLiveIndex >= 0
          ? Math.max(0, numericCsvValue(record[impressionsLiveIndex]))
          : 0,
      revenueDownload:
        revenueDownloadIndex >= 0 ? numericCsvValue(record[revenueDownloadIndex]) : 0,
      revenueOndemand:
        revenueOndemandIndex >= 0 ? numericCsvValue(record[revenueOndemandIndex]) : 0,
      revenueLive: revenueLiveIndex >= 0 ? numericCsvValue(record[revenueLiveIndex]) : 0,
      label: labelIndex >= 0 ? String(record[labelIndex] || "").trim() : ""
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));

  if (!rows.length) throw new Error("No rows with YYYY-MM-DD dates were found in the CSV.");

  return {
    filename,
    importedAt: new Date().toISOString(),
    currency: "USD",
    rows
  };
};

const monetizationSummary = (report, from, to) => {
  if (!report?.rows?.length) return null;

  const rows = report.rows.filter((row) => row.date >= from && row.date <= to);
  const daily = new Map();
  const labels = new Map();
  const channels = {
    Download: { name: "Download", impressions: 0, revenue: 0 },
    "On demand": { name: "On demand", impressions: 0, revenue: 0 },
    Live: { name: "Live", impressions: 0, revenue: 0 }
  };

  for (const row of rows) {
    const day = daily.get(row.date) || { date: row.date, impressions: 0, revenue: 0 };
    day.impressions += Number(row.impressions) || 0;
    day.revenue += Number(row.revenue) || 0;
    daily.set(row.date, day);

    channels.Download.impressions += Number(row.impressionsDownload) || 0;
    channels.Download.revenue += Number(row.revenueDownload) || 0;
    channels["On demand"].impressions += Number(row.impressionsOndemand) || 0;
    channels["On demand"].revenue += Number(row.revenueOndemand) || 0;
    channels.Live.impressions += Number(row.impressionsLive) || 0;
    channels.Live.revenue += Number(row.revenueLive) || 0;

    if (row.label) {
      const item = labels.get(row.label) || { name: row.label, impressions: 0, revenue: 0 };
      item.impressions += Number(row.impressions) || 0;
      item.revenue += Number(row.revenue) || 0;
      labels.set(row.label, item);
    }
  }

  const days = [...daily.values()].sort((left, right) => left.date.localeCompare(right.date));
  const impressions = days.reduce((sum, row) => sum + row.impressions, 0);
  const revenue = days.reduce((sum, row) => sum + row.revenue, 0);
  return {
    days,
    impressions,
    revenue,
    ecpm: impressions > 0 ? (revenue / impressions) * 1000 : 0,
    channels: Object.values(channels),
    labels: [...labels.values()].sort((left, right) => right.revenue - left.revenue),
    importedAt: report.importedAt,
    filename: report.filename,
    currency: report.currency || "USD"
  };
};

const layout = (title, body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink:#1d1916; --muted:#6b625a; --paper:#fffaf2; --canvas:#f4eee5; --line:#d8cab7; --rust:#9d3f36; --teal:#235e5b; --green:#197447; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--canvas); color:var(--ink); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    a { color:var(--rust); font-weight:750; }
    code { overflow-wrap:anywhere; }
    .shell { width:min(1180px,calc(100% - 32px)); margin:0 auto; padding:32px 0 64px; }
    .nav { display:flex; flex-wrap:wrap; gap:18px; margin-bottom:22px; }
    .hero,.panel { margin-bottom:20px; padding:26px; border:1px solid var(--line); border-radius:12px; background:var(--paper); box-shadow:0 10px 30px rgba(39,30,24,.05); }
    .hero-row { display:flex; align-items:center; justify-content:space-between; gap:24px; }
    .show { display:flex; align-items:center; gap:18px; }
    .cover { width:96px; height:96px; border-radius:10px; object-fit:cover; }
    .kicker { margin:0 0 6px; color:var(--teal); font-size:.76rem; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
    h1,h2 { margin:.1em 0 .35em; line-height:1.04; }
    h1 { font-family:Georgia,serif; font-size:clamp(2.3rem,6vw,4.5rem); }
    h2 { font-size:1.35rem; }
    p { color:var(--muted); line-height:1.55; }
    .button { display:inline-flex; min-height:42px; align-items:center; justify-content:center; padding:0 16px; border:1px solid var(--rust); border-radius:6px; background:var(--rust); color:white; cursor:pointer; font:inherit; font-weight:850; text-decoration:none; }
    .button.secondary { background:transparent; color:var(--rust); }
    .filter { display:flex; flex-wrap:wrap; align-items:end; gap:12px; }
    .filter label { display:grid; gap:6px; color:var(--muted); font-size:.82rem; font-weight:800; }
    .filter input,.filter select { min-height:42px; padding:0 10px; border:1px solid var(--line); border-radius:6px; background:white; font:inherit; }
    .tabs { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 20px; padding:6px; border:1px solid var(--line); border-radius:10px; background:var(--paper); }
    .tabs a { padding:10px 16px; border-radius:7px; color:var(--muted); text-decoration:none; }
    .tabs a[aria-current="page"] { background:var(--teal); color:white; }
    .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; }
    .metric { padding:19px; border:1px solid var(--line); border-radius:9px; background:#fff; }
    .metric span { color:var(--muted); font-size:.82rem; font-weight:750; }
    .metric strong { display:block; margin-top:8px; font-size:1.9rem; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; }
    .wide { grid-column:1/-1; }
    .table-wrap,.chart-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; text-align:left; }
    th,td { padding:11px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
    th { color:var(--muted); font-size:.76rem; letter-spacing:.05em; text-transform:uppercase; white-space:nowrap; }
    tfoot th,tfoot td { border-top:2px solid var(--ink); border-bottom:0; background:#f6f1e9; color:var(--ink); font-weight:850; }
    .pagination { display:flex; align-items:center; justify-content:center; gap:14px; margin-top:18px; }
    .pagination span { color:var(--muted); font-weight:750; }
    .chart { display:block; width:100%; min-width:680px; height:auto; }
    .gridline { stroke:var(--line); stroke-width:1; }
    .axis { fill:var(--muted); font-size:12px; }
    .plays { fill:none; stroke:var(--teal); stroke-width:4; stroke-linecap:round; stroke-linejoin:round; }
    .downloads { fill:none; stroke:var(--rust); stroke-width:4; stroke-linecap:round; stroke-linejoin:round; }
    .legend { display:flex; flex-wrap:wrap; gap:18px; margin:14px 0; color:var(--muted); font-size:.86rem; font-weight:800; }
    .legend i { display:inline-block; width:24px; height:4px; margin-right:7px; vertical-align:middle; border-radius:4px; }
    .live-panel { position:relative; overflow:hidden; border-color:#253b37; background:#071612; color:#eefcf5; box-shadow:0 20px 45px rgba(7,22,18,.18); }
    .live-panel::after { position:absolute; inset:0; background:linear-gradient(rgba(93,255,179,.028) 1px,transparent 1px); background-size:100% 4px; content:""; pointer-events:none; }
    .live-panel > * { position:relative; z-index:1; }
    .live-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
    .live-panel .kicker { color:#5dffb3; }
    .live-panel h2 { color:#f4fff9; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:1.55rem; letter-spacing:-.04em; }
    .live-status { display:flex; align-items:center; gap:8px; color:#9ab8aa; font-size:.78rem; font-weight:850; letter-spacing:.08em; text-transform:uppercase; white-space:nowrap; }
    .live-dot { width:8px; height:8px; border-radius:50%; background:#5dffb3; box-shadow:0 0 0 5px rgba(93,255,179,.11),0 0 18px rgba(93,255,179,.65); }
    .live-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; margin:22px 0 12px; border:1px solid #234139; background:#234139; }
    .live-quote { padding:17px 19px; background:#0a1e18; }
    .live-quote span { display:block; color:#88a99a; font:750 .76rem/1.4 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; letter-spacing:.08em; text-transform:uppercase; }
    .live-quote strong { display:block; margin-top:7px; color:#f3fff9; font:800 clamp(1.9rem,5vw,3rem)/1 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; letter-spacing:-.07em; }
    .live-quote small { margin-left:8px; color:#5dffb3; font-size:.72rem; letter-spacing:.04em; }
    .market-chart { position:relative; min-height:360px; border:1px solid #1f3931; background:linear-gradient(180deg,rgba(20,57,45,.58),rgba(7,22,18,.22)); }
    .market-chart svg { display:block; width:100%; height:360px; }
    .market-chart .market-grid { stroke:#19372e; stroke-width:1; }
    .market-chart .sessions-area { fill:url(#sessionsGlow); }
    .market-chart .sessions-line { fill:none; stroke:#5dffb3; stroke-width:3; vector-effect:non-scaling-stroke; }
    .market-chart .rate-line { fill:none; stroke:#ffb86b; stroke-width:2.5; vector-effect:non-scaling-stroke; }
    .market-chart .market-axis { fill:#769487; font:11px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
    .market-empty { display:grid; min-height:360px; place-items:center; padding:30px; color:#88a99a; text-align:center; }
    .market-legend { display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px 24px; margin-top:13px; color:#88a99a; font:700 .78rem/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
    .market-legend span { display:inline-flex; align-items:center; gap:8px; }
    .market-swatch { width:22px; height:3px; border-radius:3px; background:#5dffb3; }
    .market-swatch.rate { background:#ffb86b; }
    .live-error .live-dot { background:#ff7d73; box-shadow:0 0 0 5px rgba(255,125,115,.1); }
    .notice { padding:14px 16px; border-left:4px solid var(--teal); background:#e6efed; color:var(--ink); }
    .error { border-left-color:var(--rust); background:#f5e5e2; }
    @media (max-width:760px) { .grid { grid-template-columns:1fr; } .hero-row,.show,.live-head { align-items:flex-start; flex-direction:column; } .cover { width:80px; height:80px; } .live-summary { grid-template-columns:1fr; } .market-chart,.market-chart svg,.market-empty { min-height:300px; height:300px; } }
  </style>
</head>
<body><main class="shell">${body}</main></body>
</html>`;

const responseHtml = (request, body, status = 200) =>
  new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: {
      "content-type": "text/html;charset=UTF-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow"
    }
  });

const responseJson = (request, body, status = 200) =>
  new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

const jsonForScript = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

const chart = (rows) => {
  if (!rows?.length) return '<p class="notice">No daily statistics were returned for this range.</p>';

  const width = 920;
  const height = 320;
  const pad = { top: 22, right: 24, bottom: 50, left: 58 };
  const maximum = Math.max(1, ...rows.flatMap((row) => [Number(row.plays_count) || 0, Number(row.downloads_count) || 0]));
  const x = (index) => pad.left + (index / Math.max(1, rows.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - Number(value || 0) / maximum) * (height - pad.top - pad.bottom);
  const path = (field) => rows.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(row[field]).toFixed(1)}`).join(" ");
  const ticks = [0, .25, .5, .75, 1].map((ratio) => {
    const value = maximum * ratio;
    const position = y(value).toFixed(1);
    return `<line class="gridline" x1="${pad.left}" y1="${position}" x2="${width - pad.right}" y2="${position}"/><text class="axis" x="${pad.left - 8}" y="${Number(position) + 4}" text-anchor="end">${escapeHtml(Math.round(value))}</text>`;
  }).join("");
  const labelIndexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  const labels = labelIndexes.map((index) => `<text class="axis" x="${x(index).toFixed(1)}" y="${height - 16}" text-anchor="middle">${escapeHtml(rows[index].date)}</text>`).join("");

  return `<div class="legend"><span><i style="background:var(--teal)"></i>Plays</span><span><i style="background:var(--rust)"></i>Downloads</span></div><div class="chart-wrap"><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily plays and downloads">${ticks}${labels}<path class="plays" d="${path("plays_count")}"/><path class="downloads" d="${path("downloads_count")}"/></svg></div>`;
};

const liveRangeLabel = (bucketSeconds) => {
  if (bucketSeconds < 60 * 60) return `${bucketSeconds / 60}m intervals`;
  if (bucketSeconds < 24 * 60 * 60) return `${bucketSeconds / 3600}h intervals`;
  return `${bucketSeconds / 86400}d intervals`;
};

const liveTrackerPanel = (analytics, from, to, fromHour, toHour, filters = {}) => {
  if (!analytics) {
    return '<section class="panel wide"><p class="kicker">Live pulse</p><h2>Real-time analytics unavailable</h2><p class="notice">The SITE_ANALYTICS database binding is not configured.</p></section>';
  }
  const query = statsRangeQuery(from, to, fromHour, toHour);
  if (filters.zoneFilter) query.set("zoneid", filters.zoneFilter);
  if (filters.campaignFilter) query.set("campaignid", filters.campaignFilter);
  const endpoint = `/stats/realtime?${query}`;
  const filterLabels = [
    filters.zoneFilter ? `Zone ${filters.zoneFilter}` : "All zones",
    filters.campaignFilter ? `Campaign ${filters.campaignFilter}` : "All campaigns"
  ];

  return `<section class="panel wide live-panel" data-live-tracker data-endpoint="${escapeHtml(endpoint)}">
    <div class="live-head"><div><p class="kicker">Live pulse</p><h2>Session &amp; playback ticker</h2></div><div class="live-status" data-live-status data-interval="${escapeHtml(liveRangeLabel(analytics.bucketSeconds))}"><span class="live-dot"></span><span>Live · ${escapeHtml(liveRangeLabel(analytics.bucketSeconds))}</span></div></div>
    <div class="live-summary">
      <div class="live-quote"><span>Current sessions</span><strong data-current-sessions>${number(analytics.currentSessions)}</strong></div>
      <div class="live-quote"><span>Overall playback rate</span><strong data-playback-rate>${percent(analytics.overallPlaybackRate)}<small>PLAYS / SESSION</small></strong></div>
    </div>
    <div class="market-chart" data-market-chart aria-label="Sessions and playback rate over the selected range"></div>
    <div class="market-legend"><span><i class="market-swatch"></i>Sessions</span><span><i class="market-swatch rate"></i>Playback rate</span><span>${escapeHtml(filterLabels.join(" · "))} · UTC · refreshes every 15s</span></div>
    <script type="application/json" data-live-initial>${jsonForScript(analytics)}</script>
    <script>
      (() => {
        const root = document.currentScript.closest('[data-live-tracker]');
        if (!root || root.dataset.liveReady) return;
        root.dataset.liveReady = 'true';
        const chart = root.querySelector('[data-market-chart]');
        const status = root.querySelector('[data-live-status]');
        const sessionsValue = root.querySelector('[data-current-sessions]');
        const rateValue = root.querySelector('[data-playback-rate]');
        const initial = JSON.parse(root.querySelector('[data-live-initial]').textContent);
        const formatNumber = new Intl.NumberFormat('en-US');
        const escapeText = (value) => String(value).replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]));
        const labelFor = (timestamp, span) => new Intl.DateTimeFormat('en-US', span > 172800000
          ? { month:'short', day:'numeric', timeZone:'UTC' }
          : { hour:'numeric', minute:'2-digit', hour12:false, timeZone:'UTC' }).format(new Date(timestamp));
        const linePath = (points, x, y, field) => points.map((point, index) => (index ? 'L' : 'M') + x(index).toFixed(1) + ' ' + y(point[field]).toFixed(1)).join(' ');

        function render(data) {
          const points = Array.isArray(data.points) ? data.points : [];
          sessionsValue.textContent = formatNumber.format(Number(data.currentSessions) || 0);
          rateValue.innerHTML = (Number(data.overallPlaybackRate) || 0).toFixed(1) + '%<small>PLAYS / SESSION</small>';
          if (!points.length) {
            chart.innerHTML = '<div class="market-empty">No session activity in this filtered range.</div>';
            return;
          }
          const width = 1040;
          const height = 360;
          const pad = { top:24, right:58, bottom:48, left:50 };
          const plotWidth = width - pad.left - pad.right;
          const plotHeight = height - pad.top - pad.bottom;
          const sessionsMax = Math.max(1, ...points.map((point) => Number(point.sessions) || 0));
          const rateMax = Math.max(100, ...points.map((point) => Number(point.playbackRate) || 0));
          const x = (index) => pad.left + (index / Math.max(1, points.length - 1)) * plotWidth;
          const sessionY = (value) => pad.top + (1 - (Number(value) || 0) / sessionsMax) * plotHeight;
          const rateY = (value) => pad.top + (1 - (Number(value) || 0) / rateMax) * plotHeight;
          const sessionsPath = linePath(points, x, sessionY, 'sessions');
          const ratePath = linePath(points, x, rateY, 'playbackRate');
          const areaPath = sessionsPath + ' L' + x(points.length - 1).toFixed(1) + ' ' + (height - pad.bottom) + ' L' + x(0).toFixed(1) + ' ' + (height - pad.bottom) + ' Z';
          const ticks = [0, .25, .5, .75, 1].map((ratio) => {
            const y = pad.top + (1 - ratio) * plotHeight;
            return '<line class="market-grid" x1="' + pad.left + '" y1="' + y + '" x2="' + (width - pad.right) + '" y2="' + y + '"/>'
              + '<text class="market-axis" x="' + (pad.left - 9) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(sessionsMax * ratio) + '</text>'
              + '<text class="market-axis" x="' + (width - pad.right + 9) + '" y="' + (y + 4) + '">' + Math.round(rateMax * ratio) + '%</text>';
          }).join('');
          const indexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
          const span = Date.parse(points.at(-1).timestamp) - Date.parse(points[0].timestamp);
          const labels = indexes.map((index) => '<text class="market-axis" x="' + x(index) + '" y="' + (height - 17) + '" text-anchor="middle">' + escapeText(labelFor(points[index].timestamp, span)) + '</text>').join('');
          chart.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Sessions in green and playback rate in orange">'
            + '<defs><linearGradient id="sessionsGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5dffb3" stop-opacity=".28"/><stop offset="1" stop-color="#5dffb3" stop-opacity="0"/></linearGradient></defs>'
            + ticks + labels + '<path class="sessions-area" d="' + areaPath + '"/><path class="sessions-line" d="' + sessionsPath + '"/><path class="rate-line" d="' + ratePath + '"/></svg>';
        }

        async function refresh() {
          if (document.hidden) return;
          try {
            const response = await fetch(root.dataset.endpoint, { headers:{ accept:'application/json' }, cache:'no-store' });
            if (!response.ok) throw new Error('Live analytics request failed');
            const data = await response.json();
            render(data);
            status.classList.remove('live-error');
            status.innerHTML = '<span class="live-dot"></span><span>Live · ' + escapeText(status.dataset.interval) + ' · ' + escapeText(new Date(data.updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})) + '</span>';
          } catch {
            status.classList.add('live-error');
            status.innerHTML = '<span class="live-dot"></span><span>Reconnecting</span>';
          }
        }

        render(initial);
        window.setInterval(refresh, 15000);
      })();
    </script>
  </section>`;
};

const rankedTable = (items, valueKey, empty, formatter = number) =>
  items?.length
    ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${items
        .map((item) => `<tr><td>${escapeHtml(item.name || item.title || "Unknown")}</td><td>${escapeHtml(formatter(item[valueKey]))}</td></tr>`)
        .join("")}</tbody></table></div>`
    : `<p class="notice">${escapeHtml(empty)}</p>`;

const sumPlayStats = (rows = []) =>
  rows.reduce(
    (totals, row) => ({
      plays_count: totals.plays_count + (Number(row.plays_count) || 0),
      plays_ondemand_count:
        totals.plays_ondemand_count + (Number(row.plays_ondemand_count) || 0),
      plays_live_count: totals.plays_live_count + (Number(row.plays_live_count) || 0),
      downloads_count: totals.downloads_count + (Number(row.downloads_count) || 0)
    }),
    {
      plays_count: 0,
      plays_ondemand_count: 0,
      plays_live_count: 0,
      downloads_count: 0
    }
  );

const monetizationPanel = (monetization, uploadMessage = "") => {
  const dailyRows = monetization?.days
    ?.slice()
    .reverse()
    .slice(0, 31)
    .map(
      (row) => `<tr><td>${escapeHtml(row.date)}</td><td>${number(row.impressions)}</td><td>${currency(
        row.revenue,
        monetization.currency
      )}</td><td>${currency(
        row.impressions > 0 ? (row.revenue / row.impressions) * 1000 : 0,
        monetization.currency
      )}</td></tr>`
    )
    .join("");
  const breakdownRows = monetization?.labels
    ?.slice(0, 20)
    .map(
      (row) => `<tr><td>${escapeHtml(row.name)}</td><td>${number(row.impressions)}</td><td>${currency(
        row.revenue,
        monetization.currency
      )}</td></tr>`
    )
    .join("");
  const channelRows = monetization?.channels
    ?.map(
      (row) => `<tr><td>${escapeHtml(row.name)}</td><td>${number(row.impressions)}</td><td>${currency(
        row.revenue,
        monetization.currency
      )}</td><td>${currency(
        row.impressions > 0 ? (row.revenue / row.impressions) * 1000 : 0,
        monetization.currency
      )}</td></tr>`
    )
    .join("");

  return `<section class="panel wide">
    <p class="kicker">Monetization</p><h2>Ad Exchange performance</h2>
    <p>Upload the CSV exported from Spreaker’s Ad Exchange statistics. Values below are actual imported impressions and revenue, not estimates.</p>
    ${uploadMessage ? `<p class="notice">${escapeHtml(uploadMessage)}</p>` : ""}
    <form class="filter" method="post" action="${DASHBOARD_PATH}/monetization" enctype="multipart/form-data">
      <label>Spreaker Ad Exchange CSV<input type="file" name="report" accept=".csv,text/csv" required></label>
      <button class="button" type="submit">Import monetization CSV</button>
    </form>
    ${
      monetization
        ? `<p>Imported ${escapeHtml(monetization.filename || "CSV report")} on ${escapeHtml(
            String(monetization.importedAt || "").replace("T", " ").slice(0, 19)
          )} UTC.</p>
          <div class="metrics"><div class="metric"><span>Ad impressions</span><strong>${number(
            monetization.impressions
          )}</strong></div><div class="metric"><span>Revenue</span><strong>${currency(
            monetization.revenue,
            monetization.currency
          )}</strong></div><div class="metric"><span>Effective CPM</span><strong>${currency(
            monetization.ecpm,
            monetization.currency
          )}</strong></div><div class="metric"><span>Revenue days</span><strong>${number(
            monetization.days.length
          )}</strong></div></div>
          <h2>Daily monetization</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Impressions</th><th>Revenue</th><th>Effective CPM</th></tr></thead><tbody>${
            dailyRows || '<tr><td colspan="4">No monetization rows fall within this date range.</td></tr>'
          }</tbody></table></div>
          <h2>Delivery channels</h2><div class="table-wrap"><table><thead><tr><th>Channel</th><th>Impressions</th><th>Revenue</th><th>Effective CPM</th></tr></thead><tbody>${channelRows}</tbody></table></div>
          ${
            breakdownRows
              ? `<h2>Revenue breakdown</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Impressions</th><th>Revenue</th></tr></thead><tbody>${breakdownRows}</tbody></table></div>`
              : ""
          }`
        : '<p class="notice">No monetization report has been imported yet.</p>'
    }
  </section>`;
};

const siteAnalyticsPanel = (analytics) => {
  if (!analytics) {
    return '<section class="panel wide"><p class="kicker">Site analytics</p><h2>D1 analytics unavailable</h2><p class="notice">The SITE_ANALYTICS database binding is not configured.</p></section>';
  }
  const summary = analytics.summary || {};
  const playback = analytics.playback || {};
  const linkClickCtr = Number(summary.listen_page_visitors) > 0
    ? (Number(summary.platform_clickers) / Number(summary.listen_page_visitors)) * 100
    : 0;
  const pageRows = analytics.pages.map((row) => `<tr><td>${escapeHtml(row.page_path)}</td><td>${number(row.views)}</td><td>${number(row.visitors)}</td></tr>`).join("");
  const episodeRows = analytics.episodes.map((row) => `<tr><td>${escapeHtml(row.episode)}</td><td>${number(row.plays)}</td><td>${number(row.listeners)}</td><td>${percent(row.max_percent)}</td><td>${number(row.completions)}</td></tr>`).join("");
  const platformRows = analytics.platforms.map((row) => `<tr><td>${escapeHtml(row.platform || "Unknown")}</td><td>${number(row.clicks)}</td></tr>`).join("");
  const countryRows = analytics.countries.map((row) => `<tr><td>${escapeHtml(row.country_code || "XX")}</td><td>${number(row.visitors)}</td></tr>`).join("");
  const referrerRows = analytics.referrers.map((row) => `<tr><td>${escapeHtml(row.referrer)}</td><td>${number(row.visitors)}</td></tr>`).join("");

  return `<section class="panel wide">
    <p class="kicker">First-party site analytics</p><h2>Website engagement</h2>
    <p>Anonymous browser-session activity recorded in D1 for the selected date range${analytics.campaignFilter ? ` and campaign <code>${escapeHtml(analytics.campaignFilter)}</code>` : ""}.</p>
    <div class="metrics">
      <div class="metric"><span>Page views</span><strong>${number(summary.page_views)}</strong></div>
      <div class="metric"><span>Visitors</span><strong>${number(summary.visitors)}</strong></div>
      <div class="metric"><span>Playback starts</span><strong>${number(summary.plays)}</strong></div>
      <div class="metric"><span>Listeners</span><strong>${number(summary.listeners)}</strong></div>
      <div class="metric"><span>Listening time</span><strong>${duration(playback.listening_ms)}</strong></div>
      <div class="metric"><span>Average play %</span><strong>${percent(playback.average_percent)}</strong></div>
      <div class="metric"><span>Completions</span><strong>${number(summary.completions)}</strong></div>
      <div class="metric"><span>Platform clicks</span><strong>${number(summary.platform_clicks)}</strong></div>
      <div class="metric"><span>Link click CTR</span><strong>${percent(linkClickCtr)}</strong></div>
    </div>
    <p>Link click CTR is ${number(summary.platform_clickers)} unique platform clickers divided by ${number(summary.listen_page_visitors)} unique episode listen-page visitors.</p>
    <h2>Top pages</h2><div class="table-wrap"><table><thead><tr><th>Page</th><th>Views</th><th>Visitors</th></tr></thead><tbody>${pageRows || '<tr><td colspan="3">No page views in this range.</td></tr>'}</tbody></table></div>
    <h2>On-site playback by episode</h2><div class="table-wrap"><table><thead><tr><th>Episode</th><th>Starts</th><th>Listeners</th><th>Max played</th><th>Completions</th></tr></thead><tbody>${episodeRows || '<tr><td colspan="5">No on-site playback in this range.</td></tr>'}</tbody></table></div>
    <h2>Platform link clicks</h2><div class="table-wrap"><table><thead><tr><th>Platform</th><th>Clicks</th></tr></thead><tbody>${platformRows || '<tr><td colspan="2">No platform clicks in this range.</td></tr>'}</tbody></table></div>
    <h2>Visitor countries</h2><div class="table-wrap"><table><thead><tr><th>Country</th><th>Visitors</th></tr></thead><tbody>${countryRows || '<tr><td colspan="2">No country data in this range.</td></tr>'}</tbody></table></div>
    <h2>Top referrers</h2><div class="table-wrap"><table><thead><tr><th>Referrer</th><th>Visitors</th></tr></thead><tbody>${referrerRows || '<tr><td colspan="2">No referrer data in this range.</td></tr>'}</tbody></table></div>
  </section>`;
};

const statsRangeQuery = (from, to, fromHour, toHour, extra = {}) => new URLSearchParams({
  ...extra,
  from,
  to,
  fromhour: String(fromHour),
  tohour: String(toHour)
});

const hourOptions = (selectedHour) => Array.from({ length: 24 }, (_, hour) => {
  const label = `${hourString(hour)}:00 UTC`;
  return `<option value="${hour}"${hour === selectedHour ? " selected" : ""}>${label}</option>`;
}).join("");

const statsRangeLabel = (from, to, fromHour, toHour) =>
  `${from} ${hourString(fromHour)}:00 UTC through ${to} ${hourString(toHour)}:59 UTC`;

const statsTabs = (from, to, fromHour, toHour, activeTab, campaignFilter = "") => {
  const shared = campaignFilter ? { campaignid: campaignFilter } : {};
  const overviewQuery = statsRangeQuery(from, to, fromHour, toHour, shared);
  const zonesQuery = statsRangeQuery(from, to, fromHour, toHour, { ...shared, tab: "zones" });
  return `<nav class="tabs" aria-label="Statistics sections">
    <a href="/stats?${escapeHtml(overviewQuery)}"${activeTab === "overview" ? ' aria-current="page"' : ""}>Overview</a>
    <a href="/stats?${escapeHtml(zonesQuery)}"${activeTab === "zones" ? ' aria-current="page"' : ""}>Zones &amp; campaigns</a>
  </nav>`;
};

const zoneAnalyticsPanel = (analytics, from, to, fromHour, toHour, requestedPage = 1) => {
  if (!analytics) {
    return '<section class="panel wide"><p class="kicker">Campaign analytics</p><h2>D1 analytics unavailable</h2><p class="notice">The SITE_ANALYTICS database binding is not configured.</p></section>';
  }

  const exportQuery = statsRangeQuery(from, to, fromHour, toHour, {
    tab: "zones",
    format: "csv"
  });
  if (analytics.zoneFilter) exportQuery.set("zoneid", analytics.zoneFilter);
  if (analytics.campaignFilter) exportQuery.set("campaignid", analytics.campaignFilter);
  const metricFilterParams = {
    minplays: analytics.filters?.minPlays,
    maxplays: analytics.filters?.maxPlays,
    minbounce: analytics.filters?.minBounce,
    maxbounce: analytics.filters?.maxBounce,
    minplayback: analytics.filters?.minPlayback,
    maxplayback: analytics.filters?.maxPlayback
  };
  for (const [name, value] of Object.entries(metricFilterParams)) {
    if (value !== null && value !== undefined) exportQuery.set(name, String(value));
  }
  const paginationQuery = new URLSearchParams(exportQuery);
  paginationQuery.delete("format");
  const requestedPageNumber = Number.parseInt(String(requestedPage), 10);
  const totalRows = analytics.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / ZONE_RESULTS_PER_PAGE));
  const currentPage = Math.min(
    totalPages,
    Math.max(1, Number.isFinite(requestedPageNumber) ? requestedPageNumber : 1)
  );
  const pageStart = (currentPage - 1) * ZONE_RESULTS_PER_PAGE;
  const pageRows = analytics.rows.slice(pageStart, pageStart + ZONE_RESULTS_PER_PAGE);
  const totals = analytics.rows.reduce((summary, row) => {
    summary.sessions += Number(row.sessions) || 0;
    summary.plays += Number(row.plays) || 0;
    summary.bounces += Number(row.bounces) || 0;
    for (const milestone of PLAYBACK_MILESTONES) {
      summary.milestones[milestone] += Number(row[`milestone_${milestone}`]) || 0;
    }
    return summary;
  }, {
    sessions: 0,
    plays: 0,
    bounces: 0,
    milestones: Object.fromEntries(PLAYBACK_MILESTONES.map((milestone) => [milestone, 0]))
  });
  const totalPlaybackRate = totals.sessions > 0 ? (totals.plays / totals.sessions) * 100 : 0;
  const totalBounceRate = totals.sessions > 0 ? (totals.bounces / totals.sessions) * 100 : 0;
  const filterValue = (value) => value === null || value === undefined ? "" : String(value);
  const zoneOptionRows = analytics.zoneOptions.map((row) => {
    const zoneId = String(row.zone_id || "unattributed");
    return `<option value="${escapeHtml(zoneId)}"${zoneId === analytics.zoneFilter ? " selected" : ""}>${escapeHtml(zoneId)} (${number(row.sessions)} sessions)</option>`;
  }).join("");
  const campaignOptionRows = analytics.campaignOptions.map((row) => {
    const campaignId = String(row.campaign_id || "unattributed");
    return `<option value="${escapeHtml(campaignId)}"${campaignId === analytics.campaignFilter ? " selected" : ""}>${escapeHtml(campaignId)} (${number(row.sessions)} sessions total)</option>`;
  }).join("");
  const milestoneHeaders = PLAYBACK_MILESTONES.map(
    (milestone) => `<th>${milestone}%</th>`
  ).join("");
  const zoneRows = pageRows.map((row) => {
    const sessions = Number(row.sessions) || 0;
    const bounces = Number(row.bounces) || 0;
    const bounceRate = sessions > 0 ? (bounces / sessions) * 100 : 0;
    const playbackRate = sessions > 0 ? ((Number(row.plays) || 0) / sessions) * 100 : 0;
    const milestoneCells = PLAYBACK_MILESTONES.map(
      (milestone) => `<td>${number(row[`milestone_${milestone}`])}</td>`
    ).join("");
    return `<tr>
      <td><strong>${escapeHtml(row.zone_id || "unattributed")}</strong></td>
      <td><strong>${escapeHtml(row.campaign_id || "unattributed")}</strong></td>
      <td>${number(sessions)}</td>
      <td>${number(row.plays)}</td>
      <td>${percent(playbackRate)}</td>
      ${milestoneCells}
      <td>${number(bounces)}</td>
      <td>${percent(bounceRate)}</td>
    </tr>`;
  }).join("");
  const totalMilestoneCells = PLAYBACK_MILESTONES.map(
    (milestone) => `<td>${number(totals.milestones[milestone])}</td>`
  ).join("");
  const totalsRow = totalRows > 0 ? `<tfoot><tr>
    <th colspan="2">Filtered totals (${number(totalRows)} attribution rows)</th>
    <td>${number(totals.sessions)}</td>
    <td>${number(totals.plays)}</td>
    <td>${percent(totalPlaybackRate)}</td>
    ${totalMilestoneCells}
    <td>${number(totals.bounces)}</td>
    <td>${percent(totalBounceRate)}</td>
  </tr></tfoot>` : "";
  const pageQuery = (page) => {
    const query = new URLSearchParams(paginationQuery);
    query.set("page", String(page));
    return `/stats?${escapeHtml(query)}`;
  };
  const firstShown = totalRows > 0 ? pageStart + 1 : 0;
  const lastShown = Math.min(pageStart + ZONE_RESULTS_PER_PAGE, totalRows);
  const pagination = totalPages > 1 ? `<nav class="pagination" aria-label="Zone result pages">
    ${currentPage > 1 ? `<a class="button secondary" href="${pageQuery(currentPage - 1)}">Previous</a>` : ""}
    <span>Showing ${number(firstShown)}–${number(lastShown)} of ${number(totalRows)} attribution rows · Page ${number(currentPage)} of ${number(totalPages)}</span>
    ${currentPage < totalPages ? `<a class="button secondary" href="${pageQuery(currentPage + 1)}">Next</a>` : ""}
  </nav>` : `<p>Showing ${number(totalRows)} filtered attribution row${totalRows === 1 ? "" : "s"}.</p>`;

  return `<section class="panel wide">
    <p class="kicker">Campaign analytics</p><h2>Playback performance by zone and campaign</h2>
    <p>Each valid <code>zoneid</code> and <code>campaignid</code> query parameter is retained for the browser session. A bounce is a session with a recorded episode listen-page view and no audio playback start in the selected range.</p>
    <form class="filter" method="get" action="/stats">
      <input type="hidden" name="tab" value="zones">
      <label>From<input type="date" name="from" value="${escapeHtml(from)}" required></label>
      <label>From hour<select name="fromhour">${hourOptions(fromHour)}</select></label>
      <label>To<input type="date" name="to" value="${escapeHtml(to)}" required></label>
      <label>To hour<select name="tohour">${hourOptions(toHour)}</select></label>
      <label>Zone<select name="zoneid"><option value="">All zones</option>${zoneOptionRows}</select></label>
      <label>Campaign<select name="campaignid"><option value="">All campaigns</option>${campaignOptionRows}</select></label>
      <label>Minimum plays<input type="number" name="minplays" min="0" step="1" value="${escapeHtml(filterValue(analytics.filters?.minPlays))}" placeholder="0"></label>
      <label>Maximum plays<input type="number" name="maxplays" min="0" step="1" value="${escapeHtml(filterValue(analytics.filters?.maxPlays))}" placeholder="Any"></label>
      <label>Minimum bounce %<input type="number" name="minbounce" min="0" max="100" step="0.1" value="${escapeHtml(filterValue(analytics.filters?.minBounce))}" placeholder="0"></label>
      <label>Maximum bounce %<input type="number" name="maxbounce" min="0" max="100" step="0.1" value="${escapeHtml(filterValue(analytics.filters?.maxBounce))}" placeholder="100"></label>
      <label>Minimum playback rate %<input type="number" name="minplayback" min="0" max="100" step="0.1" value="${escapeHtml(filterValue(analytics.filters?.minPlayback))}" placeholder="0"></label>
      <label>Maximum playback rate %<input type="number" name="maxplayback" min="0" max="100" step="0.1" value="${escapeHtml(filterValue(analytics.filters?.maxPlayback))}" placeholder="100"></label>
      <button class="button" type="submit">Apply filters</button>
      <a class="button secondary" href="/stats?${escapeHtml(statsRangeQuery(from, to, fromHour, toHour, { tab: "zones" }))}">Clear filters</a>
      <a class="button secondary" href="/stats?${escapeHtml(exportQuery)}">Export raw events CSV</a>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Zone ID</th><th>Campaign ID</th><th>Sessions</th><th>Plays</th><th>Playback rate</th>${milestoneHeaders}<th>Bounces</th><th>Bounce rate</th></tr></thead>
        <tbody>${zoneRows || `<tr><td colspan="${7 + PLAYBACK_MILESTONES.length}">No campaign activity in this range.</td></tr>`}</tbody>
        ${totalsRow}
      </table>
    </div>
    ${pagination}
  </section>`;
};

const zonesDashboardPage = ({ analytics, liveAnalytics, from, to, fromHour, toHour, page }) => layout("Zone and campaign analytics | The Last Known", `
  <nav class="nav" aria-label="Admin navigation"><a href="/">Site</a><a href="/admin/content">Episode content</a><a href="${DASHBOARD_PATH}">Spreaker admin</a></nav>
  <section class="hero"><p class="kicker">First-party analytics</p><h1>Zone and campaign tracking</h1><p>${escapeHtml(statsRangeLabel(from, to, fromHour, toHour))}</p></section>
  ${statsTabs(from, to, fromHour, toHour, "zones", analytics?.campaignFilter)}
  ${liveTrackerPanel(liveAnalytics, from, to, fromHour, toHour, analytics || {})}
  ${zoneAnalyticsPanel(analytics, from, to, fromHour, toHour, page)}
`);

const dashboardPage = ({ show, overall, plays, last30Plays, listeners, episodes, sources, devices, countries, monetization, siteAnalytics, liveAnalytics, from, to, fromHour, toHour, warning, uploadMessage, statsPath = DASHBOARD_PATH }) => {
  const totals = overall?.statistics || {};
  const last30Totals = sumPlayStats(last30Plays?.statistics);
  const last30Value = (key) => (last30Plays ? number(last30Totals[key]) : "—");
  const showData = totals.show || show || {};
  const totalListeners = (listeners || []).reduce((sum, row) => sum + (Number(row.listeners_count) || 0), 0);
  const sourceRows = sources?.statistics?.overall || [];
  const deviceRows = Array.isArray(devices?.statistics) ? devices.statistics : [];
  const countryRows = countries?.statistics?.country || [];
  const episodeRows = episodes?.items || [];
  const campaignOptions = siteAnalytics?.campaignOptions || [];
  const selectedCampaign = siteAnalytics?.campaignFilter || "";
  const selectedCampaignIsListed = campaignOptions.some(
    (row) => String(row.campaign_id || "unattributed") === selectedCampaign
  );
  const campaignOptionRows = [
    ...(selectedCampaign && !selectedCampaignIsListed
      ? [{ campaign_id: selectedCampaign, visitors: 0 }]
      : []),
    ...campaignOptions
  ].map((row) => {
    const campaignId = String(row.campaign_id || "unattributed");
    return `<option value="${escapeHtml(campaignId)}"${campaignId === selectedCampaign ? " selected" : ""}>${escapeHtml(campaignId)} (${number(row.visitors)} visitors total)</option>`;
  }).join("");

  return layout(`Spreaker dashboard | ${showData.title || "The Last Known"}`, `
    <nav class="nav" aria-label="Admin navigation"><a href="/">Site</a><a href="/admin/content">Episode content</a><a href="${FEED_URL}">RSS feed</a></nav>
    <section class="hero"><div class="hero-row"><div class="show">${showData.image_url ? `<img class="cover" src="${escapeHtml(showData.image_url)}" alt="">` : ""}<div><p class="kicker">Spreaker analytics</p><h1>${escapeHtml(showData.title || "The Last Known")}</h1><p>Show ${SHOW_ID} · ${escapeHtml(statsPath === "/stats" ? statsRangeLabel(from, to, fromHour, toHour) : `${from} through ${to}`)}</p></div></div><div class="nav"><a class="button secondary" href="${escapeHtml(showData.site_url || `https://www.spreaker.com/show/${SHOW_ID}`)}">Open in Spreaker</a><a class="button secondary" href="${DASHBOARD_PATH}/connect">Reconnect</a></div></div></section>
    ${statsPath === "/stats" ? statsTabs(from, to, fromHour, toHour, "overview", siteAnalytics?.campaignFilter) : ""}
    ${warning ? `<p class="notice error">${escapeHtml(warning)}</p>` : ""}
    <section class="panel"><form class="filter" method="get" action="${escapeHtml(statsPath)}"><label>From<input type="date" name="from" value="${escapeHtml(from)}" required></label>${statsPath === "/stats" ? `<label>From hour<select name="fromhour">${hourOptions(fromHour)}</select></label>` : ""}<label>To<input type="date" name="to" value="${escapeHtml(to)}" required></label>${statsPath === "/stats" ? `<label>To hour<select name="tohour">${hourOptions(toHour)}</select></label><label>Campaign ID<select name="campaignid"><option value="">All campaigns</option>${campaignOptionRows}</select></label>` : ""}<button class="button" type="submit">Update filters</button>${statsPath === "/stats" && selectedCampaign ? `<a class="button secondary" href="/stats?${escapeHtml(statsRangeQuery(from, to, fromHour, toHour))}">Clear campaign</a>` : ""}</form>${statsPath === "/stats" ? "<p>Hour and campaign filters apply to first-party site analytics. Spreaker and monetization statistics remain date-based.</p>" : ""}</section>
    ${statsPath === "/stats" ? liveTrackerPanel(liveAnalytics, from, to, fromHour, toHour, siteAnalytics || {}) : ""}
    ${siteAnalyticsPanel(siteAnalytics)}
    <section class="panel"><p class="kicker">At a glance</p><div class="metrics"><div class="metric"><span>All-time plays</span><strong>${number(totals.plays_count)}</strong></div><div class="metric"><span>All-time downloads</span><strong>${number(totals.downloads_count)}</strong></div><div class="metric"><span>Episodes</span><strong>${number(totals.episodes_count)}</strong></div><div class="metric"><span>Daily listeners total</span><strong>${number(totalListeners)}</strong></div></div><h2>Podcast statistics</h2><div class="table-wrap"><table><thead><tr><th>Metric</th><th>All time</th><th>Last 30 days</th></tr></thead><tbody><tr><td>Total plays</td><td>${number(totals.plays_count)}</td><td>${last30Value("plays_count")}</td></tr><tr><td>On-demand plays</td><td>${number(totals.plays_ondemand_count)}</td><td>${last30Value("plays_ondemand_count")}</td></tr><tr><td>Live plays</td><td>${number(totals.plays_live_count)}</td><td>${last30Value("plays_live_count")}</td></tr><tr><td>Downloads</td><td>${number(totals.downloads_count)}</td><td>${last30Value("downloads_count")}</td></tr></tbody></table></div></section>
    <div class="grid">
      ${monetizationPanel(monetization, uploadMessage)}
      <section class="panel wide"><p class="kicker">Daily performance</p><h2>Plays and downloads</h2>${chart(plays?.statistics)}</section>
      <section class="panel wide"><p class="kicker">Episode performance</p><h2>Top episodes in range</h2>${episodeRows.length ? `<div class="table-wrap"><table><thead><tr><th>Episode</th><th>Plays</th><th>Downloads</th></tr></thead><tbody>${episodeRows.map((episode) => `<tr><td>${escapeHtml(episode.title)}</td><td>${number(episode.plays_count)}</td><td>${number(episode.downloads_count)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="notice">No episode totals were returned for this range.</p>'}</section>
      <section class="panel"><p class="kicker">Discovery</p><h2>Top sources</h2>${rankedTable(sourceRows.slice(0, 12), "plays_count", "Source statistics are unavailable for this range.")}</section>
      <section class="panel"><p class="kicker">Audience</p><h2>Devices</h2>${rankedTable(deviceRows, "percentage", "Device statistics are unavailable for this range.", percent)}</section>
      <section class="panel wide"><p class="kicker">Geography</p><h2>Top countries</h2>${rankedTable(countryRows.slice(0, 20), "percentage", "Geographic statistics are unavailable for this range.", percent)}</section>
    </div>`);
};

const connectionPage = (request, env, message = "") => {
  const callback = redirectUri(request);
  const missing = [
    !env.SPREAKER_CLIENT_ID && "SPREAKER_CLIENT_ID",
    !env.SPREAKER_CLIENT_SECRET && "SPREAKER_CLIENT_SECRET",
    !env.EPISODE_CONTENT && "EPISODE_CONTENT"
  ].filter(Boolean);

  return layout("Connect Spreaker dashboard", `
    <nav class="nav"><a href="/">Site</a><a href="/admin/content">Episode content</a></nav>
    <section class="hero"><p class="kicker">Spreaker analytics</p><h1>Connect The Last Known</h1><p>Authorize this private admin dashboard to read statistics for show ${SHOW_ID}.</p>
    ${message ? `<p class="notice error">${escapeHtml(message)}</p>` : ""}
    ${missing.length ? `<p class="notice error">Missing configuration: <code>${escapeHtml(missing.join(", "))}</code>.</p>` : `<p><a class="button" href="${DASHBOARD_PATH}/connect">Connect Spreaker</a></p>`}
    <p>Register this exact OAuth callback URL in the Spreaker application:</p><p><code>${escapeHtml(callback)}</code></p></section>`);
};

export const handleSpreakerConnect = async (request, env) => {
  if (!configured(env)) return responseHtml(request, connectionPage(request, env), 503);

  const state = crypto.randomUUID();
  await putJson(env, `${STATE_PREFIX}${state}.json`, {
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 10 * 60 * 1000
  });
  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    client_id: env.SPREAKER_CLIENT_ID,
    response_type: "code",
    state,
    scope: "basic",
    redirect_uri: redirectUri(request)
  }).toString();
  return Response.redirect(authorize.toString(), 302);
};

export const handleSpreakerCallback = async (request, env, url) => {
  if (!configured(env)) return responseHtml(request, connectionPage(request, env), 503);

  const state = String(url.searchParams.get("state") || "");
  const stateKey = `${STATE_PREFIX}${state}.json`;
  const storedState = /^[0-9a-f-]{36}$/i.test(state) ? await jsonFromR2(env, stateKey) : null;

  if (!storedState || Number(storedState.expiresAt) < Date.now()) {
    return responseHtml(request, connectionPage(request, env, "The OAuth request expired or could not be verified."), 400);
  }

  await env.EPISODE_CONTENT.delete(stateKey);
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (oauthError) return responseHtml(request, connectionPage(request, env, oauthError), 400);

  const code = url.searchParams.get("code");
  if (!code) return responseHtml(request, connectionPage(request, env, "Spreaker did not return an authorization code."), 400);

  try {
    const token = await exchangeToken(env, {
      grant_type: "authorization_code",
      redirect_uri: redirectUri(request),
      code
    });
    await putJson(env, TOKEN_KEY, token);
    return Response.redirect(new URL(DASHBOARD_PATH, request.url), 303);
  } catch (error) {
    return responseHtml(request, connectionPage(request, env, error.message), 502);
  }
};

export const handleSpreakerMonetizationUpload = async (request, env) => {
  if (!env.EPISODE_CONTENT) {
    return responseHtml(
      request,
      layout("Monetization import unavailable", '<section class="panel"><h1>Storage is not configured</h1><p><a href="/admin/spreaker">Back to dashboard</a></p></section>'),
      503
    );
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response("Invalid request origin", { status: 403 });
  }

  try {
    const form = await request.formData();
    const report = form.get("report");

    if (!(report instanceof File) || !report.name || report.size === 0) {
      throw new Error("Choose a Spreaker Ad Exchange CSV file.");
    }
    if (report.size > MAX_MONETIZATION_CSV_BYTES) {
      throw new Error("The monetization CSV must be 5 MB or smaller.");
    }

    const parsed = monetizationFromCsv(await report.text(), report.name.slice(0, 180));
    await putJson(env, MONETIZATION_KEY, parsed);
    return Response.redirect(new URL(`${DASHBOARD_PATH}?monetization=imported`, request.url), 303);
  } catch (error) {
    return responseHtml(
      request,
      layout(
        "Monetization import failed",
        `<nav class="nav"><a href="${DASHBOARD_PATH}">Back to dashboard</a></nav><section class="panel"><p class="kicker">Monetization</p><h1>Import failed</h1><p class="notice error">${escapeHtml(
          error.message
        )}</p></section>`
      ),
      400
    );
  }
};

export const handleSpreakerDashboard = async (request, env, url) => {
  const range = dashboardDates(url);
  const { from, to, fromHour, toHour, fromTimestamp, toTimestamp } = range;
  const isZonesTab = url.pathname === "/stats" && url.searchParams.get("tab") === "zones";
  if (isZonesTab) {
    const isCsvExport = url.searchParams.get("format") === "csv";
    if (isCsvExport) {
      return rawEventsCsvResponse(
        request,
        env,
        range,
        url.searchParams.get("zoneid"),
        url.searchParams.get("campaignid")
      );
    }
    const [zoneAnalytics, liveAnalytics] = await Promise.all([
      zoneAnalyticsForRange(
        env,
        fromTimestamp,
        toTimestamp,
        url.searchParams.get("zoneid"),
        url.searchParams.get("campaignid"),
        {
          minPlays: url.searchParams.get("minplays"),
          maxPlays: url.searchParams.get("maxplays"),
          minBounce: url.searchParams.get("minbounce"),
          maxBounce: url.searchParams.get("maxbounce"),
          minPlayback: url.searchParams.get("minplayback"),
          maxPlayback: url.searchParams.get("maxplayback")
        }
      ).catch((error) => {
        console.error("Unable to load D1 zone analytics", error);
        return null;
      }),
      liveAnalyticsForRange(
        env,
        fromTimestamp,
        toTimestamp,
        url.searchParams.get("zoneid"),
        url.searchParams.get("campaignid")
      ).catch((error) => {
        console.error("Unable to load live D1 analytics", error);
        return null;
      })
    ]);

    return responseHtml(request, zonesDashboardPage({
      analytics: zoneAnalytics,
      liveAnalytics,
      from,
      to,
      fromHour,
      toHour,
      page: url.searchParams.get("page")
    }));
  }

  if (!configured(env)) return responseHtml(request, connectionPage(request, env), 503);

  let accessToken;
  try {
    accessToken = await getAccessToken(env);
  } catch (error) {
    return responseHtml(request, connectionPage(request, env, `Unable to refresh Spreaker access: ${error.message}`), 502);
  }
  if (!accessToken) return responseHtml(request, connectionPage(request, env));

  const query = new URLSearchParams({ from, to });
  const rollingToDate = new Date();
  const rollingFromDate = new Date(rollingToDate);
  rollingFromDate.setUTCDate(rollingFromDate.getUTCDate() - 29);
  const last30Query = new URLSearchParams({
    from: dateString(rollingFromDate),
    to: dateString(rollingToDate)
  });
  const safe = async (path) => {
    try {
      return await apiRequest(path, accessToken);
    } catch {
      return null;
    }
  };

  const [show, overall, plays, last30Plays, listeners, episodes, sources, devices, countries, monetizationReport, siteAnalytics, liveAnalytics] = await Promise.all([
    safe(`/shows/${SHOW_ID}`),
    safe(`/shows/${SHOW_ID}/statistics`),
    safe(`/shows/${SHOW_ID}/statistics/plays?${query}&group=day`),
    safe(`/shows/${SHOW_ID}/statistics/plays?${last30Query}&group=day`),
    safe(`/shows/${SHOW_ID}/statistics/listeners?${query}&group=day`),
    safe(`/shows/${SHOW_ID}/episodes/statistics/plays/totals?${query}&offset=0&limit=50`),
    safe(`/shows/${SHOW_ID}/statistics/sources?${query}&group=day`),
    safe(`/shows/${SHOW_ID}/statistics/devices?${query}&precision=1`),
    safe(`/shows/${SHOW_ID}/statistics/geographics?${query}&precision=1`),
    jsonFromR2(env, MONETIZATION_KEY).catch(() => null),
    siteAnalyticsForRange(
      env,
      fromTimestamp,
      toTimestamp,
      url.searchParams.get("campaignid")
    ).catch((error) => {
      console.error("Unable to load D1 site analytics", error);
      return null;
    }),
    liveAnalyticsForRange(
      env,
      fromTimestamp,
      toTimestamp,
      "",
      url.searchParams.get("campaignid")
    ).catch((error) => {
      console.error("Unable to load live D1 analytics", error);
      return null;
    })
  ]);

  const warning = !overall
    ? "Spreaker did not return private statistics. Reconnect the account and confirm it owns this show."
    : "";
  return responseHtml(request, dashboardPage({
    show: show?.show,
    overall,
    plays,
    last30Plays,
    listeners: listeners?.statistics,
    episodes,
    sources,
    devices,
    countries,
    monetization: monetizationSummary(monetizationReport, from, to),
    siteAnalytics,
    liveAnalytics,
    from,
    to,
    fromHour,
    toHour,
    warning,
    uploadMessage:
      url.searchParams.get("monetization") === "imported"
        ? "Monetization report imported successfully."
        : "",
    statsPath: url.pathname === "/stats" ? "/stats" : DASHBOARD_PATH
  }));
};

export const handleSpreakerRealtime = async (request, env, url) => {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    return responseJson(request, { error: "Method not allowed" }, 405);
  }
  const range = dashboardDates(url);
  const analytics = await liveAnalyticsForRange(
    env,
    range.fromTimestamp,
    range.toTimestamp,
    url.searchParams.get("zoneid"),
    url.searchParams.get("campaignid")
  );
  return analytics
    ? responseJson(request, analytics)
    : responseJson(request, { error: "Site analytics unavailable" }, 503);
};
