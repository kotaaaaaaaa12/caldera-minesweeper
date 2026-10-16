# Verification

Base upstream commit: `902e5142a2f56f711572deefd4877b2756a26b78`.

- Automated game/API/service-worker tests: passed (43 tests).
- Wrangler deployment dry run with the ID-free, automatically provisioned D1 binding, static-asset preparation, and Worker bundling: passed.
- Local workerd runtime with actual local D1: health check, valid score submission, faster-best updates, slower/equal submission handling, duplicate prevention, name changes, stale-request protection, and token verification passed.
- Public-assets isolation: server source returned 404; all offline-precache files returned 200.
- Fresh upstream checkout plus overlay extraction: game/API tests and asset build passed.

Headless Chromium verification passed: all four dialogs open on a heading rather than a selector/button; Tab still reaches the language selector; language selection works; Close does not retain focus; page widths of 320, 390, 768, and 1280 pixels have no document overflow; zoom does not overlap the minefield; there are no browser runtime errors. Dark/mobile/settings/desktop and all palettes were inspected visually. Safari/iOS device verification remains outstanding. No production deployment or remote D1 database was created.

Automatic provisioning is configured using the pinned Wrangler version's built-in feature. It reuses the database by name or the deployed binding. Remote resource creation was not executed in this environment; it runs in the user's Cloudflare deployment with D1 permissions.

I18n verification uses a DOM implementation, not visual browser automation: the actual application boots with Japanese browser preferences, switches between Japanese/English/Auto without altering a saved game or draft name, and translates result text, ranks, statistics, achievement details, accessibility labels, sharing, and API errors. Resource keys and interpolation placeholders match between languages. Safari layout and native PWA installation were not tested on a device.

Device-ranking regression tests cover simultaneous updates, separate difficulties, identical names on different devices, unauthorized edits, automatic schema upgrades that preserve legacy scores, persistent client identity, and offline name retry. The actual application DOM test changes the Settings name twice and verifies profile requests reuse the same player ID.

Contrast tests verify Dark and Slate text and all eight number colors at 4.5:1 or higher, button text at 4.5:1 or higher, and covered/revealed cells and flags at 3:1 or higher. Modal focus assertions also run in the DOM regression suite.
