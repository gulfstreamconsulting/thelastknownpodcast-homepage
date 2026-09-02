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

  if (from > to) [from, to] = [to, from];

  const earliest = new Date(`${to}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 365);
  if (from < dateString(earliest)) from = dateString(earliest);

  return { from, to };
};

const siteAnalyticsForRange = async (env, from, to) => {
  if (!env.SITE_ANALYTICS) return null;
  const range = [from, to];
  const results = await env.SITE_ANALYTICS.batch([
    env.SITE_ANALYTICS.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS visitors,
        SUM(CASE WHEN event_type IN ('audio_play', 'video_play') THEN 1 ELSE 0 END) AS plays,
        COUNT(DISTINCT CASE WHEN event_type IN ('audio_play', 'video_play') THEN session_id END) AS listeners,
        SUM(CASE WHEN event_type IN ('audio_ended', 'video_ended') THEN 1 ELSE 0 END) AS completions,
        SUM(CASE WHEN event_type = 'episode_link_click' THEN 1 ELSE 0 END) AS platform_clicks
      FROM site_events WHERE date(occurred_at) BETWEEN ?1 AND ?2
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT COALESCE(SUM(max_position_ms), 0) AS listening_ms,
             COALESCE(AVG(max_percent), 0) AS average_percent
      FROM (
        SELECT session_id, episode_id,
               MAX(playback_position_ms) AS max_position_ms,
               MAX(playback_percent) AS max_percent
        FROM site_events
        WHERE date(occurred_at) BETWEEN ?1 AND ?2
          AND media_type IN ('audio', 'video')
        GROUP BY session_id, episode_id
      )
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT page_path, COUNT(*) AS views,
             COUNT(DISTINCT session_id) AS visitors
      FROM site_events
      WHERE event_type = 'page_view' AND date(occurred_at) BETWEEN ?1 AND ?2
      GROUP BY page_path ORDER BY views DESC LIMIT 15
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT COALESCE(NULLIF(episode_title, ''), NULLIF(episode_id, ''), 'Unknown episode') AS episode,
             SUM(CASE WHEN event_type IN ('audio_play', 'video_play') THEN 1 ELSE 0 END) AS plays,
             COUNT(DISTINCT CASE WHEN event_type IN ('audio_play', 'video_play') THEN session_id END) AS listeners,
             MAX(playback_percent) AS max_percent,
             SUM(CASE WHEN event_type IN ('audio_ended', 'video_ended') THEN 1 ELSE 0 END) AS completions
      FROM site_events
      WHERE date(occurred_at) BETWEEN ?1 AND ?2 AND episode_id <> ''
      GROUP BY episode_id, episode_title ORDER BY plays DESC, listeners DESC LIMIT 20
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT platform, COUNT(*) AS clicks
      FROM site_events
      WHERE event_type = 'episode_link_click' AND date(occurred_at) BETWEEN ?1 AND ?2
      GROUP BY platform ORDER BY clicks DESC
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT country_code, COUNT(DISTINCT session_id) AS visitors
      FROM site_events
      WHERE event_type = 'page_view' AND date(occurred_at) BETWEEN ?1 AND ?2
      GROUP BY country_code ORDER BY visitors DESC LIMIT 20
    `).bind(...range),
    env.SITE_ANALYTICS.prepare(`
      SELECT CASE WHEN referrer = '' THEN 'Direct / unknown' ELSE referrer END AS referrer,
             COUNT(DISTINCT session_id) AS visitors
      FROM site_events
      WHERE event_type = 'page_view' AND date(occurred_at) BETWEEN ?1 AND ?2
      GROUP BY referrer ORDER BY visitors DESC LIMIT 15
    `).bind(...range)
  ]);

  return {
    summary: results[0]?.results?.[0] || {},
    playback: results[1]?.results?.[0] || {},
    pages: results[2]?.results || [],
    episodes: results[3]?.results || [],
    platforms: results[4]?.results || [],
    countries: results[5]?.results || [],
    referrers: results[6]?.results || []
  };
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
    .filter input { min-height:42px; padding:0 10px; border:1px solid var(--line); border-radius:6px; background:white; font:inherit; }
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
    .chart { display:block; width:100%; min-width:680px; height:auto; }
    .gridline { stroke:var(--line); stroke-width:1; }
    .axis { fill:var(--muted); font-size:12px; }
    .plays { fill:none; stroke:var(--teal); stroke-width:4; stroke-linecap:round; stroke-linejoin:round; }
    .downloads { fill:none; stroke:var(--rust); stroke-width:4; stroke-linecap:round; stroke-linejoin:round; }
    .legend { display:flex; flex-wrap:wrap; gap:18px; margin:14px 0; color:var(--muted); font-size:.86rem; font-weight:800; }
    .legend i { display:inline-block; width:24px; height:4px; margin-right:7px; vertical-align:middle; border-radius:4px; }
    .notice { padding:14px 16px; border-left:4px solid var(--teal); background:#e6efed; color:var(--ink); }
    .error { border-left-color:var(--rust); background:#f5e5e2; }
    @media (max-width:760px) { .grid { grid-template-columns:1fr; } .hero-row,.show { align-items:flex-start; flex-direction:column; } .cover { width:80px; height:80px; } }
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
  const pageRows = analytics.pages.map((row) => `<tr><td>${escapeHtml(row.page_path)}</td><td>${number(row.views)}</td><td>${number(row.visitors)}</td></tr>`).join("");
  const episodeRows = analytics.episodes.map((row) => `<tr><td>${escapeHtml(row.episode)}</td><td>${number(row.plays)}</td><td>${number(row.listeners)}</td><td>${percent(row.max_percent)}</td><td>${number(row.completions)}</td></tr>`).join("");
  const platformRows = analytics.platforms.map((row) => `<tr><td>${escapeHtml(row.platform || "Unknown")}</td><td>${number(row.clicks)}</td></tr>`).join("");
  const countryRows = analytics.countries.map((row) => `<tr><td>${escapeHtml(row.country_code || "XX")}</td><td>${number(row.visitors)}</td></tr>`).join("");
  const referrerRows = analytics.referrers.map((row) => `<tr><td>${escapeHtml(row.referrer)}</td><td>${number(row.visitors)}</td></tr>`).join("");

  return `<section class="panel wide">
    <p class="kicker">First-party site analytics</p><h2>Website engagement</h2>
    <p>Anonymous browser-session activity recorded in D1 for the selected date range.</p>
    <div class="metrics">
      <div class="metric"><span>Page views</span><strong>${number(summary.page_views)}</strong></div>
      <div class="metric"><span>Visitors</span><strong>${number(summary.visitors)}</strong></div>
      <div class="metric"><span>Playback starts</span><strong>${number(summary.plays)}</strong></div>
      <div class="metric"><span>Listeners</span><strong>${number(summary.listeners)}</strong></div>
      <div class="metric"><span>Listening time</span><strong>${duration(playback.listening_ms)}</strong></div>
      <div class="metric"><span>Average max played</span><strong>${percent(playback.average_percent)}</strong></div>
      <div class="metric"><span>Completions</span><strong>${number(summary.completions)}</strong></div>
      <div class="metric"><span>Platform clicks</span><strong>${number(summary.platform_clicks)}</strong></div>
    </div>
    <h2>Top pages</h2><div class="table-wrap"><table><thead><tr><th>Page</th><th>Views</th><th>Visitors</th></tr></thead><tbody>${pageRows || '<tr><td colspan="3">No page views in this range.</td></tr>'}</tbody></table></div>
    <h2>On-site playback by episode</h2><div class="table-wrap"><table><thead><tr><th>Episode</th><th>Starts</th><th>Listeners</th><th>Max played</th><th>Completions</th></tr></thead><tbody>${episodeRows || '<tr><td colspan="5">No on-site playback in this range.</td></tr>'}</tbody></table></div>
    <h2>Platform link clicks</h2><div class="table-wrap"><table><thead><tr><th>Platform</th><th>Clicks</th></tr></thead><tbody>${platformRows || '<tr><td colspan="2">No platform clicks in this range.</td></tr>'}</tbody></table></div>
    <h2>Visitor countries</h2><div class="table-wrap"><table><thead><tr><th>Country</th><th>Visitors</th></tr></thead><tbody>${countryRows || '<tr><td colspan="2">No country data in this range.</td></tr>'}</tbody></table></div>
    <h2>Top referrers</h2><div class="table-wrap"><table><thead><tr><th>Referrer</th><th>Visitors</th></tr></thead><tbody>${referrerRows || '<tr><td colspan="2">No referrer data in this range.</td></tr>'}</tbody></table></div>
  </section>`;
};

const dashboardPage = ({ show, overall, plays, last30Plays, listeners, episodes, sources, devices, countries, monetization, siteAnalytics, from, to, warning, uploadMessage, statsPath = DASHBOARD_PATH }) => {
  const totals = overall?.statistics || {};
  const last30Totals = sumPlayStats(last30Plays?.statistics);
  const last30Value = (key) => (last30Plays ? number(last30Totals[key]) : "—");
  const showData = totals.show || show || {};
  const totalListeners = (listeners || []).reduce((sum, row) => sum + (Number(row.listeners_count) || 0), 0);
  const sourceRows = sources?.statistics?.overall || [];
  const deviceRows = Array.isArray(devices?.statistics) ? devices.statistics : [];
  const countryRows = countries?.statistics?.country || [];
  const episodeRows = episodes?.items || [];

  return layout(`Spreaker dashboard | ${showData.title || "The Last Known"}`, `
    <nav class="nav" aria-label="Admin navigation"><a href="/">Site</a><a href="/admin/content">Episode content</a><a href="${FEED_URL}">RSS feed</a></nav>
    <section class="hero"><div class="hero-row"><div class="show">${showData.image_url ? `<img class="cover" src="${escapeHtml(showData.image_url)}" alt="">` : ""}<div><p class="kicker">Spreaker analytics</p><h1>${escapeHtml(showData.title || "The Last Known")}</h1><p>Show ${SHOW_ID} · ${escapeHtml(from)} through ${escapeHtml(to)}</p></div></div><div class="nav"><a class="button secondary" href="${escapeHtml(showData.site_url || `https://www.spreaker.com/show/${SHOW_ID}`)}">Open in Spreaker</a><a class="button secondary" href="${DASHBOARD_PATH}/connect">Reconnect</a></div></div></section>
    ${warning ? `<p class="notice error">${escapeHtml(warning)}</p>` : ""}
    <section class="panel"><form class="filter" method="get" action="${escapeHtml(statsPath)}"><label>From<input type="date" name="from" value="${escapeHtml(from)}" required></label><label>To<input type="date" name="to" value="${escapeHtml(to)}" required></label><button class="button" type="submit">Update range</button></form></section>
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
  if (!configured(env)) return responseHtml(request, connectionPage(request, env), 503);

  let accessToken;
  try {
    accessToken = await getAccessToken(env);
  } catch (error) {
    return responseHtml(request, connectionPage(request, env, `Unable to refresh Spreaker access: ${error.message}`), 502);
  }
  if (!accessToken) return responseHtml(request, connectionPage(request, env));

  const { from, to } = dashboardDates(url);
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

  const [show, overall, plays, last30Plays, listeners, episodes, sources, devices, countries, monetizationReport, siteAnalytics] = await Promise.all([
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
    siteAnalyticsForRange(env, from, to).catch((error) => {
      console.error("Unable to load D1 site analytics", error);
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
    from,
    to,
    warning,
    uploadMessage:
      url.searchParams.get("monetization") === "imported"
        ? "Monetization report imported successfully."
        : "",
    statsPath: url.pathname === "/stats" ? "/stats" : DASHBOARD_PATH
  }));
};
