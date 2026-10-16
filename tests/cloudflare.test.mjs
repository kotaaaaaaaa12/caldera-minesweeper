import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/worker.js';
import { validateScore } from '../cloudflare/validate.js';
import { Engine } from '../src/engine.js';
import { isMine, isRevealed } from '../src/board.js';
import { makeNoGuessGenerator } from '../src/generate.js';
import { seedForDate, dailySafeIndex } from '../src/daily.js';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { return sqlite.prepare(sql).run(...args); },
      };
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
  };
}

export function winningScore(difficulty = 'beginner', noGuess = false, flagFirst = false) {
  const daily = difficulty.startsWith('daily-');
  const configs = { beginner: [9,9,10], intermediate: [16,16,40], expert: [30,16,99] };
  const [width,height,mines] = daily ? configs.intermediate : configs[difficulty];
  const seed = daily ? seedForDate(difficulty.slice(6)) : 42;
  const e = new Engine({ width,height,mines,seed,
    ...(daily ? { prePlaceSafe: dailySafeIndex() } : {}),
    ...(noGuess ? { mineGenerator: makeNoGuessGenerator() } : {}),
  });
  const moves = [];
  let t = 0;
  const act = (a,i) => { moves.push({ a,i,t: t += 100 }); return a === 'f' ? e.toggleFlag(i) : e.reveal(i); };
  if (flagFirst) { act('f',0); act('f',0); }
  act('r', daily ? dailySafeIndex() : Math.floor(width * height / 2));
  for (let i = 0; i < width * height && e.status !== 'won'; i++) {
    if (!isMine(e.state,i) && !isRevealed(e.state,i)) act('r',i);
  }
  assert.equal(e.status,'won');
  return { id: crypto.randomUUID(), name: 'Player', difficulty, timeMs: t,
    proof: { seed, safeFirstClick: true, allowQuestion: false, noGuess, assisted: false, moves } };
}

function env() { return { DB: database(), ASSETS: { fetch: async () => new Response('asset') } }; }
function call(environment, path, body, headers = {}) {
  return worker.fetch(new Request('https://example.com' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }), environment);
}

test('all presets, no-guess, daily, and flag-before-reveal runs validate', () => {
  for (const diff of ['beginner','intermediate','expert','daily-2026-10-15']) {
    const score = winningScore(diff);
    assert.equal(validateScore(score).difficulty,diff);
  }
  validateScore(winningScore('expert',true));
  validateScore(winningScore('beginner',false,true));
});

test('invalid, incomplete, assisted, and malformed replays are rejected', () => {
  const score = winningScore();
  const changes = [
    { difficulty: 'custom' }, { timeMs: 0 }, { timeMs: 1 }, { id: 'bad' },
    { proof: { ...score.proof, assisted: true } },
    { proof: { ...score.proof, seed: -1 } },
    { proof: { ...score.proof, moves: score.proof.moves.slice(0,1) } },
    { proof: { ...score.proof, moves: [{ a:'r', i:-1, t:0 }] } },
    { proof: { ...score.proof, moves: [{ a:'u', i:0, t:0 }] } },
  ];
  for (const change of changes) assert.throws(() => validateScore({ ...score, ...change }));
  const daily = winningScore('daily-2026-10-15');
  assert.throws(() => validateScore({ ...daily, proof: { ...daily.proof, seed: 1 } }));
});

test('D1 initializes automatically and score retries are idempotent', async () => {
  const environment = env();
  const score = winningScore();
  let response = await call(environment,'/api/health');
  assert.deepEqual(await response.json(),{ ok:true, storage:'d1' });
  for (let i=0;i<2;i++) {
    response = await call(environment,'/api/scores',score);
    assert.equal(response.status,200);
    assert.equal((await response.json()).rank,1);
  }
  response = await call(environment,'/api/leaderboard?difficulty=beginner');
  const result = await response.json();
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].name,'Player');
  response = await call(environment,`/api/rank?difficulty=beginner&timeMs=${score.timeMs + 1}`);
  assert.equal((await response.json()).rank,2);
  response = await call(environment,'/api/leaderboard?difficulty=expert');
  assert.deepEqual((await response.json()).rows,[]);
});

test('ranking sorts by time and keeps daily boards separate', async () => {
  const environment = env();
  const fast = winningScore();
  const slow = winningScore();
  slow.name = 'Slower'; slow.timeMs *= 2;
  slow.proof.moves = slow.proof.moves.map(move => ({ ...move,t:move.t*2 }));
  await call(environment,'/api/scores',slow);
  await call(environment,'/api/scores',fast);
  await call(environment,'/api/scores',winningScore('daily-2026-10-15'));
  const response = await call(environment,'/api/leaderboard?difficulty=beginner&limit=1');
  assert.equal((await response.json()).rows[0].name,'Player');
  const daily = await call(environment,'/api/leaderboard?difficulty=daily-2026-10-15');
  assert.equal((await daily.json()).rows.length,1);
});

test('invalid API requests, cross-site writes, and unavailable DB are handled', async () => {
  const environment = env();
  for (const path of ['/api/leaderboard?difficulty=bad','/api/leaderboard?difficulty=daily-2026-02-30','/api/leaderboard?difficulty=beginner&limit=500','/api/rank?difficulty=beginner&timeMs=0']) {
    assert.equal((await call(environment,path)).status,400);
  }
  assert.equal((await call(environment,'/api/unknown')).status,404);
  assert.equal((await call(environment,'/api/scores')).status,405);
  assert.equal((await call(environment,'/api/scores',winningScore(),{ Origin:'https://other.com' })).status,403);
  assert.equal((await call(environment,'/api/health',{})).status,405);
  assert.equal((await call({},'/api/health')).status,503);
  assert.equal(await (await call(environment,'/')).text(),'asset');
});

test('large bodies, malformed JSON, and repeated writes are limited', async () => {
  const environment = env();
  assert.equal((await call(environment,'/api/scores',{ data:'x'.repeat(263000) })).status,413);
  const bad = await worker.fetch(new Request('https://example.com/api/scores', {
    method:'POST', headers:{ 'Content-Type':'application/json' },body:'{',
  }),environment);
  assert.equal(bad.status,400);
  for(let i=0;i<28;i++) await call(environment,'/api/scores',{});
  assert.equal((await call(environment,'/api/scores',{})).status,429);
  await worker.scheduled({},environment);
});

test('flag before first reveal does not reset the engine clock', () => {
  const e = new Engine({ seed:3 });
  e.toggleFlag(0);
  const start = e.startTime;
  e.reveal(40);
  assert.equal(e.startTime,start);
});

test('service worker bypasses APIs and includes configuration in offline assets', async () => {
  const vm = await import('node:vm');
  const fs = await import('node:fs/promises');
  const listeners = {};
  let precached = [];
  const self = { addEventListener: (event, fn) => { listeners[event] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const context = { self, location: { origin:'https://example.com' }, URL, Response,
    caches: { open: async () => ({ addAll: async paths => { precached = paths; } }) } };
  vm.runInNewContext(await fs.readFile(new URL('../sw.js',import.meta.url),'utf8'),context);
  let install;
  listeners.install({ waitUntil: pending => { install = pending; } });
  await install;
  for (const path of ['./config.js','./src/i18n.js','./src/locales/en.js','./src/locales/ja.js','./manifest-ja.webmanifest']) assert.ok(precached.includes(path), path);
  let intercepted = false;
  listeners.fetch({ request: new Request('https://example.com/api/leaderboard?difficulty=beginner'), respondWith: () => { intercepted = true; } });
  assert.equal(intercepted,false);
});
