/* Compatibility entry point for the upstream build command. */
import { writeFile } from 'node:fs/promises';
await writeFile(new URL('../config.js', import.meta.url), '/* Same-origin Cloudflare Workers API. */\nwindow.__CALDERA_CONFIG__ = { leaderboardApi: "/api" };\n');
console.log('Same-origin leaderboard configuration written.');
