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
