import test from 'node:test';
import assert from 'node:assert/strict';

test('client persists one device identity, synchronizes names, and retries offline changes', async () => {
  const values = new Map();
  const oldWindow = globalThis.window;
  const oldStorage = globalThis.localStorage;
  const oldFetch = globalThis.fetch;
  globalThis.window = { __CALDERA_CONFIG__: { leaderboardApi: '/api' }, addEventListener() {} };
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  };
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    return Response.json({ ok: true, name: calls.at(-1).body.name });
  };
  try {
    const client = await import('../src/leaderboard.js');
    const { storedPlayer } = await import('../src/player.js');
    await client.updateName('Original');
    await client.submitScore({ id: crypto.randomUUID(), name: 'Original', difficulty: 'beginner', timeMs: 1000 });
    await client.submitScore({ id: crypto.randomUUID(), name: 'Original', difficulty: 'beginner', timeMs: 900 });
    const identity = calls[0].body;
    assert.equal(identity.playerToken.length, 64);
    assert.ok(calls.every(call => call.body.playerId === identity.playerId && call.body.playerToken === identity.playerToken));
    await client.updateName('Renamed');
    assert.ok(calls.at(-1).body.nameVersion > identity.nameVersion);
    assert.equal(storedPlayer().name, 'Renamed');
    assert.equal(storedPlayer().pending, false);
    const count = calls.length;
    await client.retryName('Renamed');
    assert.equal(calls.length, count);
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal((await client.updateName('Offline name')).ok, false);
    assert.equal(storedPlayer().pending, true);
    globalThis.fetch = async (path, options) => {
      calls.push({ path, body: JSON.parse(options.body) });
      return Response.json({ ok: true });
    };
    await client.retryName('Offline name');
    assert.equal(calls.at(-1).path, '/api/profile');
    assert.equal(calls.at(-1).body.playerId, identity.playerId);
    assert.equal(calls.at(-1).body.name, 'Offline name');
    assert.equal(storedPlayer().pending, false);
  } finally {
    globalThis.window = oldWindow;
    globalThis.localStorage = oldStorage;
    globalThis.fetch = oldFetch;
  }
});
