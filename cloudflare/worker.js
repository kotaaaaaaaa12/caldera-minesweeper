import { validateScore } from './validate.js';
import { validatePlayer, savePlayer } from './player.js';

const schemas = [
  `CREATE TABLE IF NOT EXISTS scores (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, difficulty TEXT NOT NULL,
    time_ms INTEGER NOT NULL CHECK(time_ms > 0 AND time_ms <= 86400000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  'CREATE INDEX IF NOT EXISTS scores_ranking ON scores(difficulty, time_ms, created_at, id)',
  `CREATE TABLE IF NOT EXISTS leaderboard_players (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT NOT NULL, name_version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS leaderboard_scores (
    player_id TEXT NOT NULL REFERENCES leaderboard_players(id), difficulty TEXT NOT NULL,
    run_id TEXT NOT NULL, time_ms INTEGER NOT NULL CHECK(time_ms > 0 AND time_ms <= 86400000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(player_id,difficulty)
  )`,
  'CREATE INDEX IF NOT EXISTS leaderboard_scores_ranking ON leaderboard_scores(difficulty,time_ms,created_at,player_id)',
  'CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
];
const initialized = new WeakMap();

function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra,
  } });
}

export function validDifficulty(value) {
  if (['beginner', 'intermediate', 'expert'].includes(value)) return true;
  if (!/^daily-\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const day = value.slice(6);
  const stamp = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day;
}

async function ensureSchema(db) {
  if (!initialized.has(db)) {
    const pending = db.batch(schemas.map(sql => db.prepare(sql)))
      .catch(error => { initialized.delete(db); throw error; });
    initialized.set(db, pending);
  }
  await initialized.get(db);
}

async function limitedBody(request) {
  const max = 262144;
  if (Number(request.headers.get('Content-Length')) > max) throw new Error('body-too-large');
  if (!request.body) throw new Error('invalid-json');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Error('body-too-large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('invalid-json'); }
}

async function rateLimit(request, db) {
  const minute = Math.floor(Date.now() / 60000);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${minute}:${ip}`));
  const key = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const row = await db.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`)
    .bind(key, (minute + 2) * 60).first();
  return row.count <= 30;
}

async function rank(db, difficulty, timeMs) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM leaderboard_scores WHERE difficulty=? AND time_ms < ?')
    .bind(difficulty, timeMs).first();
  return Number(row.count) + 1;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const path = url.pathname;
    const reads = ['/api/leaderboard', '/api/rank', '/api/health'];
    if (!reads.includes(path) && !['/api/scores', '/api/profile'].includes(path)) return json({ ok: false, error: 'Not found.' }, 404);
    const method = ['/api/scores', '/api/profile'].includes(path) ? 'POST' : 'GET';
    if (request.method !== method) return json({ ok: false, error: 'Method not allowed.' }, 405, { Allow: method });
    if (!env.DB) return json({ ok: false, error: 'The leaderboard database is not connected.' }, 503);
    try {
      await ensureSchema(env.DB);
      if (path === '/api/health') return json({ ok: true, storage: 'd1' });
      if (request.method === 'GET') {
        const difficulty = url.searchParams.get('difficulty');
        if (!validDifficulty(difficulty)) return json({ ok: false, error: 'Invalid difficulty.' }, 400);
        if (path === '/api/rank') {
          const timeMs = Number(url.searchParams.get('timeMs'));
          if (!Number.isInteger(timeMs) || timeMs < 1 || timeMs > 86400000) return json({ ok: false, error: 'Invalid time.' }, 400);
          return json({ ok: true, rank: await rank(env.DB, difficulty, timeMs) });
        }
        const raw = url.searchParams.get('limit') || '10';
        const limit = Number(raw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json({ ok: false, error: 'Invalid limit.' }, 400);
        const { results } = await env.DB.prepare(`SELECT p.name,s.time_ms,s.created_at FROM leaderboard_scores s JOIN leaderboard_players p ON p.id=s.player_id
          WHERE s.difficulty=? ORDER BY s.time_ms,s.created_at,s.player_id LIMIT ?`).bind(difficulty, limit).all();
        return json({ ok: true, rows: results });
      }
      const origin = request.headers.get('Origin');
      if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
        return json({ ok: false, error: 'Cross-site submissions are not allowed.' }, 403);
      }
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) {
        return json({ ok: false, error: 'Send JSON data.' }, 415);
      }
      if (!await rateLimit(request, env.DB)) return json({ ok: false, error: 'Too many submissions. Try again in a minute.' }, 429, { 'Retry-After': '60' });
      let body, player, score;
      try {
        body = await limitedBody(request);
        player = await validatePlayer(body);
        if (path === '/api/scores') score = validateScore(body);
      } catch (error) {
        return json({ ok: false, error: error.message === 'body-too-large' ? 'Submission is too large.' :
          path === '/api/profile' ? 'Invalid player profile.' : 'Invalid score or replay.' }, error.message === 'body-too-large' ? 413 : 400);
      }
      const savedPlayer = await savePlayer(env.DB, player);
      if (!savedPlayer) return json({ ok: false, error: 'This device could not be verified.' }, 403);
      if (path === '/api/profile') return json({ ok: true, name: savedPlayer.name });
      // The composite primary key and conditional upsert make concurrent updates safe.
      const changed = await env.DB.prepare(`INSERT INTO leaderboard_scores(player_id,difficulty,run_id,time_ms) VALUES(?,?,?,?)
        ON CONFLICT(player_id,difficulty) DO UPDATE SET
          run_id=excluded.run_id,time_ms=excluded.time_ms,created_at=excluded.created_at
        WHERE excluded.time_ms < leaderboard_scores.time_ms RETURNING time_ms`)
        .bind(player.id, score.difficulty, score.id, score.timeMs).first();
      const best = await env.DB.prepare('SELECT time_ms FROM leaderboard_scores WHERE player_id=? AND difficulty=?')
        .bind(player.id, score.difficulty).first();
      return json({ ok: true, name: savedPlayer.name, updated: !!changed, bestTimeMs: best.time_ms,
        rank: await rank(env.DB, score.difficulty, best.time_ms) });
    } catch (error) {
      console.error('Leaderboard request failed:', error.message);
      return json({ ok: false, error: 'The leaderboard is temporarily unavailable.' }, 503);
    }
  },
  async scheduled(_event, env) {
    if (!env.DB) return;
    await ensureSchema(env.DB);
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Math.floor(Date.now() / 1000)).run();
  },
};
