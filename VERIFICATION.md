# Verification

Base upstream commit: `902e5142a2f56f711572deefd4877b2756a26b78`.

- Automated game/API/service-worker tests: passed (37 tests).
- Wrangler deployment dry run with the ID-free, automatically provisioned D1 binding, static-asset preparation, and Worker bundling: passed.
- Local workerd runtime with actual local D1: health check, valid score submission, retry without duplicate rows, leaderboard read, rank read, and invalid request rejection passed.
- Public-assets isolation: server source returned 404; all offline-precache files returned 200.
- Fresh upstream checkout plus overlay extraction: game/API tests and asset build passed.

A real browser/Safari session was not verified: the browser download was unavailable in the build environment. No production deployment or remote D1 database was created.

Automatic provisioning is configured using the pinned Wrangler version's built-in feature. It reuses the database by name or the deployed binding. Remote resource creation was not executed in this environment; it runs in the user's Cloudflare deployment with D1 permissions.

I18n verification uses a DOM implementation, not visual browser automation: the actual application boots with Japanese browser preferences, switches between Japanese/English/Auto without altering a saved game or draft name, and translates result text, ranks, statistics, achievement details, accessibility labels, sharing, and API errors. Resource keys and interpolation placeholders match between languages. Safari layout and native PWA installation were not tested on a device.
