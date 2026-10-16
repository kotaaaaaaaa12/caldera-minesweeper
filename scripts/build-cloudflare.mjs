import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const path of ['index.html','manifest.webmanifest','config.js','sw.js','assets','styles','src']) {
  await cp(new URL(path, root), new URL(path, dist), { recursive: true });
}
await writeFile(new URL('_headers', dist), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
/sw.js
  Cache-Control: no-cache
/config.js
  Cache-Control: no-cache
`);
console.log('Cloudflare static assets prepared in dist/.');
