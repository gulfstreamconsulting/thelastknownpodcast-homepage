# The Last Known Podcast

A Cloudflare Worker homepage for a true crime podcast, built with Wrangler and powered by the Spreaker episode API.

The dynamic `/sitemap.xml` includes the homepage, static pages, archive pagination, generated category archive pages, and every current Spreaker episode page. New episodes are added automatically.

The sitewide search form uses `/search?q=...` to search the titles and descriptions of all current Spreaker episodes.

Homepage categories are generated automatically from current Spreaker episode titles and descriptions. Category links filter the episode archive with `/?category=...`.

When Spreaker provides an episode transcript, the Worker fetches it and embeds the full text in the server-rendered episode page so visitors and search engines can read it.

## Edit Site Config

Update `src/podcast.config.js` to change the show copy, Spreaker show ID, platform links, email address, Google Analytics ID, and API cache duration.

Placeholder links use `"#"` for Apple Podcasts, Spotify, and YouTube. Replace those with the real podcast URLs when they are available.

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
```

During local development, use `http://localhost:8787/api/podcast`.

## Playback Analytics

The Spreaker audio player and YouTube video overview player report play, pause, ended, and milestone transitions to Google Analytics and Meta Pixel with country-specific event names such as `audio_play_US`, `video_pause_GB`, and `video_progress_50_US`. Event parameters include the episode ID, title, country code, media type, playback position, and duration.

Google Analytics uses the configured measurement ID in `src/podcast.config.js`. To enable the matching Facebook custom events, set the Meta Pixel ID as a Worker secret or variable:

```bash
npx wrangler secret put FACEBOOK_PIXEL_ID
```

## Episode Content

The password-protected `/admin/content` page lets you choose one episode and save its hosted video, YouTube fallback, and several supporting files in a single submit. Uploaded videos, images, PDFs, and other supporting files are stored in Cloudflare R2. Video overviews are rendered with an R2-backed native video player when a hosted video is available, with existing YouTube links still supported as a fallback. Hosted episode videos request VAST pre-roll, mid-roll, and post-roll ads through the Google IMA SDK while preserving playback analytics, and show a skip control after 15 seconds. The video import form can copy URLs that return video bytes directly; YouTube watch URLs need a downloader service before the Worker can import them. Each uploaded file has a display title and description and appears on the same page.

Create the configured R2 bucket once:

```bash
npx wrangler r2 bucket create the-last-known-podcast-content
```

Set the admin password as a Worker secret:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

The username defaults to `admin`. To use a different username, set `ADMIN_USERNAME` as a Worker variable or secret. For local development, add both values to `.dev.vars`:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-long-password
```

Uploads are limited to 25 MB. Attachment files and their metadata manifests are both stored in the `EPISODE_CONTENT` R2 binding.

### Migrating YouTube videos to R2

The local migration script reads `/api/podcast`, finds episodes with a `youtubeUrl` and no hosted `videoAsset`, downloads each video with `yt-dlp`, and uploads it through the admin media API.

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
