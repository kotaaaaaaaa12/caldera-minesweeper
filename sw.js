/* ============================================================
   sw.js — minimal cache-first service worker for offline play.
   Bump CACHE when shipping changes to invalidate old assets.
   ============================================================ */

const CACHE = "caldera-cloudflare-d1-clear-ui-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./config.js",
  "./manifest.webmanifest",
  "./manifest-ja.webmanifest",
  "./src/i18n.js",
  "./src/locales/en.js",
  "./src/locales/ja.js",
  "./assets/favicon.svg",
  "./src/leaderboard.js",
  "./styles/tokens.css",
  "./styles/base.css",
  "./styles/layout.css",
  "./styles/board.css",
  "./styles/animations.css",
  "./styles/extras.css",
  "./src/main.js",
  "./src/engine.js",
  "./src/board.js",
  "./src/render.js",
  "./src/input.js",
  "./src/timer.js",
  "./src/storage.js",
  "./src/settings.js",
  "./src/stats.js",
  "./src/solver.js",
  "./src/confetti.js",
  "./src/ui.js",
  "./src/metrics.js",
  "./src/generate.js",
  "./src/daily.js",
  "./src/sound.js",
  "./src/achievements.js",
  "./src/share.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("caldera-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // API traffic must always reach the network.
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Runtime configuration is part of the versioned offline asset set.
  e.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request)
        .then((res) => {
          if (res.ok && res.type !== "opaque") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => request.mode === "navigate" ? (await caches.match("./index.html")) : Response.error())
    )
  );
});
