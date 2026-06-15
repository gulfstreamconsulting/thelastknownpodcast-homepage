# The Last Known Podcast

A Cloudflare Worker homepage for a true crime podcast, built with Wrangler and powered by the Spreaker episode API.

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

The Worker exposes JSON endpoints with CORS enabled:

```text
GET /api/podcast
GET /api/episodes
GET /api/episodes/:slug
```

`/api/podcast` returns show metadata, platform links, and the episode collection. The episode detail endpoint also includes the full description and a `media` array containing Spreaker artwork, audio stream/download URLs, available transcripts, and configured supplemental media.

Add supplemental episode files in `src/podcast.config.js`, keyed by the Spreaker slug:

```js
episodeMedia: {
  "episode-slug": [
    {
      type: "document",
      role: "case-file",
      title: "Episode case file",
      url: "https://example.com/case-file.pdf",
      mimeType: "application/pdf"
    }
  ]
}
```

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
