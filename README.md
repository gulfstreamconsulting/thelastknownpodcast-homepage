# The Last Known Podcast

A Cloudflare Worker homepage for a true crime podcast, built with Wrangler and powered by the podcast RSS feed.

The dynamic `/sitemap.xml` includes the homepage, static pages, archive pagination, generated category archive pages, and every current Spotify episode page. New episodes are added automatically.

The sitewide search form uses `/search?q=...` to search the titles and descriptions of all current Spotify episodes.

Homepage categories are generated automatically from current Spotify episode titles and descriptions. Category links filter the episode archive with `/?category=...`.

Spotify does not expose show transcripts in the public catalog, so transcript sections appear only when transcript data is available from another configured source.

## Edit Site Config

Update `src/podcast.config.js` to change the show copy, Spotify show URL, platform links, email address, Google Analytics ID, and catalog cache duration.

Spotify episodes whose titles use a configured `spotify.videoOverviewTitleSuffixes` or `spotify.videoOverviewTitlePrefixes` value are treated as companion videos. They are omitted from the main episode catalog and matched to the audio episode with the same base title. Public video links use the matching Spotify episode rather than an R2-uploaded video.

The RSS request uses a short time-bucketed cache key so newly published episodes normally appear on the website within about one minute of becoming available in the feed. One cached Spotify for Creators metadata request maps RSS items to public `open.spotify.com/episode/...` URLs.

Placeholder links use `"#"` for platforms that are not configured yet. Replace those with the real podcast URLs when they are available.

Use the short Spotify endpoint to redirect listeners to the show page:

```text
GET /redirect
```

`GET /spotify` remains available as an alias.

The Worker exposes a Spotify landing-page directory and a separate landing page for every
published episode:

```text
GET /landing-page
GET /landing-page?audience=cold
GET /landing-page/:episode-slug
GET /landing-page/:episode-slug/spotify
GET /landing-page/:episode-slug/apple
```

The directory lists the published episodes from the Spreaker RSS feed with an episode-specific Spreaker player and prominent
play button on each card, including the eight-card cold-audience view.
The episode-specific `/spotify` route displays the landing page for two seconds so analytics
pixels can fire, then redirects to that episode on Spotify. Tapping a Spotify link sends an
internal analytics request to `/landing-page/click` with the Spotify episode ID.

Every episode card also links through its episode-specific `/apple` route. That route displays the
same two-second analytics interstitial, then redirects to that episode's Apple Podcasts page. The
Worker matches the RSS GUID first and normalized episode title second against Apple's cached
podcast-episode lookup response. If Apple has not indexed an episode yet, the route reports that it
is unavailable instead of redirecting to the show page. Apple redirects are recorded as first-party
conversions and count as landing-page engagement for bounce-rate reporting. The redirect
interstitial also emits the same Google Analytics and Meta custom click event as the Spotify flow,
with `destination` set to `apple`.

Real browser GET requests to an episode-specific `/apple` route send a background IFTTT
notification containing the episode title, tracked redirect URL, and resolved Apple episode URL.
Configure its private Maker Webhooks URL as a Worker secret:

```bash
npx wrangler secret put IFTTT_APPLE_PODCAST_REDIRECT_WEBHOOK_URL
```

The `?audience=cold` option limits the directory to eight curated, high-interest starter episodes.
The priority order is configured with `spotify.coldAudienceEpisodeTitles` in
`src/podcast.config.js`; if a configured title is unavailable, the newest published episode fills
the open slot.

Real browser GET requests to an episode-specific `/spotify` route also send a background IFTTT
notification. Configure its private Maker Webhooks URL as a Worker secret:

```bash
npx wrangler secret put IFTTT_SPOTIFY_EPISODE_REDIRECT_WEBHOOK_URL
```

Each Spreaker episode player on `/landing-page` also sends an IFTTT notification when playback starts.
Configure its private Maker Webhooks URL separately:

```bash
npx wrangler secret put IFTTT_SPREAKER_PLAYER_PLAY_WEBHOOK_URL
```

Individual episode landing pages record a view as soon as the page renders so Spotify clicks use
the same page-view denominator. Each append-only visit record stores the episode,
Cloudflare country code, sanitized referrer (query strings and fragments are removed), and timestamp in the configured
`EPISODE_CONTENT` R2 bucket. The `/landing-page` directory itself is not counted, and IP
addresses are not stored. When an individual episode landing-page URL includes
`?source=facebook_ad`, its stored referrer is `facebook_ad` regardless of the browser referrer.

The same episode landing pages also record the first embedded Spotify web-player start and the
first Spotify episode-button click during each page load.

Spotify `playback_update` events also maintain a cumulative embedded-player session snapshot.
Snapshots are saved every 30 seconds while listening and when playback pauses, resumes, reaches
25%, 50%, 75%, or 90%, completes, becomes hidden, or leaves the page. Active time counts only
while the page is visible and Spotify reports playback as active and not buffering. Progress is
cursor-based, so seeking forward can raise the highest progress and milestone values.

## App API

The Worker exposes the podcast and episode catalog as JSON with CORS enabled:

```text
GET /api/podcast
GET /api/home
GET /api/home?category=missing-persons&page=2
GET /api/episodes/:slug
```

Each episode detail page links to `/episodes/:slug/listen`, a compact platform hub with the episode
artwork, an episode-specific Spreaker player, and Spotify, Apple Podcasts, and Amazon Music listening
options. Three additional episode players appear below the platform links. Every player emits
country-suffixed Google Analytics and Meta events for play, pause, ended,
and progress milestones at every 10% plus 25% and 75%, with the two-letter country code also included
as an event parameter. Platform clicks are sent
server-side to IFTTT with episode, destination, referrer, Cloudflare location, browser, and timestamp
details. The page also emits `episode_link_click_spotify`, `episode_link_click_apple`, and
`episode_link_click_amazon` custom events to Google Analytics and Meta. Configure the private webhook
as `IFTTT_EPISODE_LINK_CLICKED_WEBHOOK_URL`.

During local development, use `http://localhost:8787/api/podcast`.

`/api/podcast` remains the full catalog endpoint and includes `screens.home` for clients that want one bootstrap payload. `/api/home` returns a focused native-screen payload for the homepage, including the hero, latest episode, generated categories, paginated archive, and section metadata. `/api/episodes/:slug` returns a native-screen payload for an episode detail page, including hero/player data, section navigation, optional hosted or YouTube video, case locations, materials, companion article markdown, transcript paragraphs, and related episodes. API version 1.2 exposes `spotifyUrl`, `audioUrl`, and a Spotify player descriptor on each episode.

## Playback Analytics

Audio playback uses Spotify's episode embed. Spotify does not expose embed playback state to the site's analytics script, so site analytics do not report play, pause, ended, or progress events for these embeds.

Google Analytics uses the configured measurement ID in `src/podcast.config.js`. To enable the matching Facebook custom events, set the Meta Pixel ID as a Worker secret or variable:

```bash
npx wrangler secret put FACEBOOK_PIXEL_ID
```

The cold-audience landing page emits a `ViewContent` event to both Google Analytics and Meta once
after meaningful engagement: either the first Spreaker play or a deliberate scroll of at least 100
pixels. It does not fire on page load. The event includes the engagement source, page variant,
featured episode, and episode count as parameters. Spreaker play, pause, and progress events remain
separate custom events.

PropellerAds traffic must pass its zone ID to the directory using the `zoneid` query parameter:

```text
GET /landing-page?zoneid=123456
```

Directory visits, meaningful engagement, Spreaker playback, historical Acast playback, and Apple
episode redirects are stored as append-only session events in R2. The password-protected stats page
is available at:

```text
GET /stats
```

This page combines first-party site analytics stored in the `SITE_ANALYTICS` D1 database with
private show analytics loaded from the authenticated Spreaker API. It reports page views, anonymous
browser-session visitors, on-site playback starts and listeners, estimated listening time, maximum
playback progress, average play percentage, completions, platform clicks, link-click CTR, top pages,
episodes, countries, and referrers. Link-click CTR is the share of unique episode listen-page visitors
who click at least one platform link. D1
records playback position, media duration, progress percentage, player provider, episode, page,
country, sanitized referrer, and a session-scoped anonymous identifier; IP addresses are not stored.
The page uses the same `ADMIN_USERNAME` and `ADMIN_PASSWORD` Basic Authentication credentials as
the other admin tools. Its date controls filter both D1 and Spreaker results.

Episode listen pages accept a validated `zoneid` query parameter. Zone attribution is retained for
the browser session and attached to page-view, playback, progress, and platform-link events. The
Zones tab at `/stats?tab=zones` reports play starts, playback rate (plays divided by sessions),
playback-milestone counts, and bounce rate by zone; supports date, zone, play-count, playback-rate,
and bounce-rate filters; and exports the current filtered
result set as CSV. The on-screen results are paginated with aggregate totals across all zones that
match the filters. A bounce is a
recorded listen-page session without an audio playback start during the selected date range.

The D1 binding and migration live in `wrangler.jsonc` and `migrations/`. Apply migrations with:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

## Episode Content

The password-protected `/admin/content` page lets you manage companion articles, maps, and supporting files. Images, PDFs, and other supporting files are stored in Cloudflare R2. Public video overview links are discovered from matching Spotify episodes and do not use legacy R2 or YouTube video assets.

Create the configured R2 bucket once:

```bash
npx wrangler r2 bucket create the-last-known-podcast-content
```

Set the admin password as a Worker secret:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

The username comes from the `ADMIN_USERNAME` variable in `wrangler.jsonc`, and the password comes from the required `ADMIN_PASSWORD` Worker secret. To use a different username, update the Wrangler variable. For local development, add both values to `.dev.vars`:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-long-password
```

Uploads are limited to 25 MB. Attachment files and their metadata manifests are both stored in the `EPISODE_CONTENT` R2 binding.

## Spreaker Dashboard

The password-protected `/admin/spreaker` dashboard displays private Spreaker statistics for show
`6837695`, including all-time totals, daily plays and downloads, listeners, episode performance,
sources, devices, and countries. Podcast statistics compare all-time totals with a rolling 30-day
column that remains independent of the custom date filter. The default chart range is 30 days
and can be changed in the page.

Spreaker's documented OAuth API does not expose Ad Exchange revenue. Export the Ad Exchange CSV
from the Spreaker CMS and upload it in the dashboard to add actual impressions, revenue, effective
CPM, daily monetization, and any included podcast/category/country breakdown. The normalized report
is stored privately in the `EPISODE_CONTENT` R2 bucket and a new import replaces the prior report.
The organization impressions export is supported directly, including its `impressions_sold`,
`revenue_amount`, and download/on-demand/live breakdown columns.

Set the Spreaker OAuth client secret without committing it:

```bash
npx wrangler secret put SPREAKER_CLIENT_SECRET
```

The OAuth client ID is configured as `SPREAKER_CLIENT_ID` in `wrangler.jsonc`. In the Spreaker
developer application, register this production callback URL exactly:

```text
https://www.thelastknownpodcast.com/admin/spreaker/oauth/callback
```

For local development, add `SPREAKER_CLIENT_ID` and `SPREAKER_CLIENT_SECRET` to `.dev.vars`, then
register the callback URL printed on the dashboard's connection screen. Visit `/admin/spreaker`,
choose **Connect Spreaker**, and authorize the account that owns the show. OAuth access and refresh
tokens are stored server-side in the configured `EPISODE_CONTENT` R2 bucket and are never sent to
the browser.

### Legacy YouTube-to-R2 migration

The repository retains the old migration script for previously hosted assets. R2 video assets created by it are no longer selected by public episode pages or API video fields.

Install `yt-dlp` first, then preview the work:

```bash
brew install yt-dlp
```

```bash
DRY_RUN=1 SITE_URL=https://thelastknownpodcast.com npm run migrate:youtube-videos
```

Run the migration with admin credentials:

```bash
SITE_URL=https://thelastknownpodcast.com \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=choose-a-long-password \
npm run migrate:youtube-videos
```

Optional controls:

- `LIMIT=1` migrates only the first matching episode.
- `EPISODE_ID=12345` migrates one episode.
- `DOWNLOAD_DIR=downloads/youtube-video-migration` changes the temporary download directory.
- `KEEP_DOWNLOADS=1` keeps downloaded files after upload.
- `YT_DLP_BIN=/path/to/yt-dlp` uses a custom `yt-dlp` binary.

## Development

```bash
npm install
npm run dev
```

Wrangler will serve the Worker locally, usually at `http://localhost:8787`.

## Deploy

```bash
npm run deploy
```
