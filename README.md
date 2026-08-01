# The Last Known Podcast

A Cloudflare Worker homepage for a true crime podcast, built with Wrangler and powered by the public Spotify show catalog.

The dynamic `/sitemap.xml` includes the homepage, static pages, archive pagination, generated category archive pages, and every current Spotify episode page. New episodes are added automatically.

The sitewide search form uses `/search?q=...` to search the titles and descriptions of all current Spotify episodes.

Homepage categories are generated automatically from current Spotify episode titles and descriptions. Category links filter the episode archive with `/?category=...`.

Spotify does not expose show transcripts in the public catalog, so transcript sections appear only when transcript data is available from another configured source.

## Edit Site Config

Update `src/podcast.config.js` to change the show copy, Spotify show URL, platform links, email address, Google Analytics ID, and catalog cache duration.

Spotify episodes whose titles use a configured `spotify.videoOverviewTitleSuffixes` or `spotify.videoOverviewTitlePrefixes` value are treated as companion videos. They are omitted from the main episode catalog and matched to the audio episode with the same base title. Public video links use the matching Spotify episode rather than an R2-uploaded video.

The Spotify show request uses a short time-bucketed cache key so newly published episodes normally appear on the website within about one minute of becoming available in the public catalog. Audio and video links use public `open.spotify.com/episode/...` URLs and can open in Spotify rather than Spotify for Creators.

Placeholder links use `"#"` for platforms that are not configured yet. Replace those with the real podcast URLs when they are available.

## Discord Webhook

Local development reads `DISCORD_WEBHOOK_URL` from `.dev.vars`. For production, set it as a Cloudflare Worker secret:

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```

Episode detail pages send the Discord notification in the background with `ctx.waitUntil`, so page rendering does not wait for Discord.

## App API

The Worker exposes the podcast and episode catalog as JSON with CORS enabled:

```text
GET /api/podcast
GET /api/home
GET /api/home?category=missing-persons&page=2
GET /api/episodes/:slug
```

During local development, use `http://localhost:8787/api/podcast`.

`/api/podcast` remains the full catalog endpoint and includes `screens.home` for clients that want one bootstrap payload. `/api/home` returns a focused native-screen payload for the homepage, including the hero, latest episode, generated categories, paginated archive, and section metadata. `/api/episodes/:slug` returns a native-screen payload for an episode detail page, including hero/player data, section navigation, optional hosted or YouTube video, case locations, materials, companion article markdown, transcript paragraphs, and related episodes. API version 1.2 exposes `spotifyUrl`, `audioUrl`, and a Spotify player descriptor on each episode.

## Playback Analytics

Audio playback uses Spotify's episode embed. Spotify does not expose embed playback state to the site's analytics script, so site analytics do not report play, pause, ended, or progress events for these embeds.

Google Analytics uses the configured measurement ID in `src/podcast.config.js`. To enable the matching Facebook custom events, set the Meta Pixel ID as a Worker secret or variable:

```bash
npx wrangler secret put FACEBOOK_PIXEL_ID
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
