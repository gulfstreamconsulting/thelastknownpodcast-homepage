import { podcast } from "./podcast.config.js";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const SPREAKER_API_BASE = "https://api.spreaker.com/v2";

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
    href: episode.site_url,
    spreakerUrl: episode.site_url,
    spreakerResource: `episode_id=${episode.episode_id}`,
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

const renderLinks = (links) =>
  links
    .map(
      (link) => `
        <a class="listen-link" href="${escapeHtml(link.href)}">
          <span>${escapeHtml(link.label)}</span>
          <span aria-hidden="true">+</span>
        </a>`
    )
    .join("");

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

const renderSpreakerPlayer = (episode) => `
  <a
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

const renderHead = ({ title, description, image = podcast.heroImage }) => `
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    ${renderGoogleAnalytics(podcast.googleAnalyticsId)}
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
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
    align-items: center;
    gap: 18px;
    color: var(--muted);
    font-size: 0.92rem;
  }

  .nav a:hover,
  .listen-link:hover {
    color: var(--paper);
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

  .links-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-top: 22px;
  }

  .listen-link {
    display: flex;
    min-height: 48px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    border: 1px solid #d8cab7;
    border-radius: 8px;
    background: #fffaf2;
    color: #201c19;
    font-weight: 800;
  }

  .case-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 28px;
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

  .footer {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding-top: 30px;
    border-top: 1px solid #d8cab7;
    color: #61584f;
    font-size: 0.95rem;
  }

  @media (max-width: 820px) {
    .site-shell {
      background:
        linear-gradient(180deg, rgba(16, 18, 21, 0.92) 0%, rgba(16, 18, 21, 0.74) 55%, rgba(16, 18, 21, 0.42) 100%),
        image-set(url("${escapeHtml(podcast.heroImage)}") 1x);
      background-position: 62% center;
      background-size: cover;
    }

    .nav {
      display: none;
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
    .links-grid {
      grid-template-columns: 1fr;
    }

    .footer {
      display: grid;
    }
  }

  @media (max-width: 520px) {
    .topbar,
    .hero,
    .section {
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
  }
`;

const renderPage = (episodes, featuredEpisode = episodes[0]) => `<!doctype html>
<html lang="en">
  ${renderHead({ title: podcast.name, description: podcast.description })}
  <body>
    <div class="site-shell">
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true">LK</span>
          <span>${escapeHtml(podcast.name)}</span>
        </a>
        <nav class="nav" aria-label="Primary navigation">
          <a href="#listen">Listen</a>
          <a href="#cases">Case Files</a>
          <a href="mailto:${escapeHtml(podcast.email)}">Contact</a>
        </nav>
      </header>

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
          ${renderEpisodeImage(featuredEpisode, "featured-art")}
        </div>
        <div>
          <p class="section-kicker">Latest episode</p>
          <h2>${escapeHtml(featuredEpisode.title)}</h2>
          <p class="episode-summary">${escapeHtml(featuredEpisode.summary)}</p>
          <div class="player-wrap">
            ${renderSpreakerPlayer(featuredEpisode)}
          </div>
          <div class="links-grid" aria-label="Podcast platform links">
            ${renderLinks(podcast.links)}
          </div>
        </div>
      </section>

      <section class="section" id="cases">
        <p class="section-kicker">Case files</p>
        <h2>Built around timelines, records, and what can be verified.</h2>
        <div class="case-grid">
          ${renderCases(episodes)}
        </div>
      </section>

      <footer class="section footer">
        <span>${escapeHtml(podcast.name)}. Hosted by ${escapeHtml(podcast.host)}.</span>
        <a href="mailto:${escapeHtml(podcast.email)}">${escapeHtml(podcast.email)}</a>
      </footer>
    </main>

    <script async src="https://widget.spreaker.com/widgets.js"></script>
  </body>
</html>`;

const renderEpisodePage = (episode) => `<!doctype html>
<html lang="en">
  ${renderHead({
    title: `${episode.title} | ${podcast.name}`,
    description: episode.summary,
    image: episode.image
  })}
  <body>
    <div class="page-shell">
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true">LK</span>
          <span>${escapeHtml(podcast.name)}</span>
        </a>
        <nav class="nav" aria-label="Primary navigation">
          <a href="/#listen">Listen</a>
          <a href="/#cases">Case Files</a>
          <a href="mailto:${escapeHtml(podcast.email)}">Contact</a>
        </nav>
      </header>

      <section class="hero episode-hero" aria-labelledby="episode-title">
        <div class="hero-copy">
          <a class="back-link" href="/">Back to home</a>
          <p class="eyebrow">${escapeHtml(episode.status)}</p>
          <h1 id="episode-title">${escapeHtml(episode.title)}</h1>
          <p class="lede">${escapeHtml(episode.summary)}</p>
        </div>
        <aside class="episode-play-panel" aria-label="Episode player">
          ${renderEpisodeImage(episode, "episode-meta-image")}
          <p class="section-kicker">${escapeHtml(episode.publishedAt ?? "Episode")}</p>
          <a class="button" href="${escapeHtml(episode.href)}">Listen on Spreaker</a>
          <div class="player-wrap">
            ${renderSpreakerPlayer(episode)}
          </div>
        </aside>
      </section>
    </div>

    <main>
      <article class="section episode-detail-layout">
        <div class="episode-body">
          ${(episode.body?.length ? episode.body : [episode.summary])
            .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
            .join("")}
        </div>
      </article>
      <footer class="section footer">
        <span>${escapeHtml(podcast.name)}. Hosted by ${escapeHtml(podcast.host)}.</span>
        <a href="mailto:${escapeHtml(podcast.email)}">${escapeHtml(podcast.email)}</a>
      </footer>
    </main>

    <script async src="https://widget.spreaker.com/widgets.js"></script>
  </body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cacheControl = `public, max-age=${podcast.spreaker.cacheSeconds}`;

    if (url.pathname.startsWith("/assets/") || url.pathname === "/hero.png") {
      return env.ASSETS.fetch(request);
    }

    try {
      const episodeSlug = episodeSlugFromPath(url.pathname);

      if (episodeSlug) {
        const episodes = await loadEpisodes();
        const listEpisode = episodes.find((episode) => episode.slug === episodeSlug);

        if (!listEpisode) {
          return new Response("Not found", { status: 404 });
        }

        const episode = await loadEpisodeDetails(listEpisode.id);
        return new Response(renderEpisodePage(episode), {
          headers: {
            "content-type": "text/html;charset=UTF-8",
            "cache-control": cacheControl
          }
        });
      }

      if (url.pathname !== "/") {
        return new Response("Not found", { status: 404 });
      }

      const episodes = await loadEpisodes();

      if (episodes.length === 0) {
        return new Response("No episodes found", { status: 502 });
      }

      const featuredEpisode = await loadEpisodeDetails(episodes[0].id);

      return new Response(renderPage(episodes, featuredEpisode), {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "cache-control": cacheControl
        }
      });
    } catch (error) {
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
