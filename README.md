# The Last Known Podcast

A Cloudflare Worker homepage for a true crime podcast, built with Wrangler and a config-driven podcast section.

## Edit Podcast Links

Update `src/podcast.config.js` to change the show copy, featured Spreaker episode, platform links, email address, and case cards.

Placeholder links use `"#"` for Apple Podcasts, Spotify, and YouTube. Replace those with the real podcast URLs when they are available.

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
