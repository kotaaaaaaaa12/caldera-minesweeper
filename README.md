# Caldera Minesweeper — Cloudflare Workers + D1

A modern browser Minesweeper game, based on [platret/caldera-minesweeper](https://github.com/platret/caldera-minesweeper), with a Cloudflare-native online leaderboard.

**Start with [README-CLOUDFLARE.md](README-CLOUDFLARE.md) for setup and deployment.**

## Features

- Beginner, Intermediate, Expert, and custom boards
- Safe first click, optional no-guess generation, hints, undo, pencil marks, and chording
- Daily Challenge, replay playback, result sharing, 3BV metrics, and click efficiency
- Themes, sound, achievements, statistics, keyboard accessibility, and touch controls
- Automatic local resume and offline/PWA support
- Shared online leaderboards backed by D1, including Daily rankings

The static game and API deploy together as one Worker. No Container or Supabase account is required. Run `npx wrangler deploy`; Wrangler automatically creates or reuses the D1 database and binds it to the Worker. No database ID needs to be entered. The custom Wrangler build prepares static assets automatically.

## Development

Requires Node.js 22.13 or newer.

```sh
npm ci
npm start
npm test
npm run check
```

MIT licensed. Original game by the upstream contributors; see [LICENSE](LICENSE).
