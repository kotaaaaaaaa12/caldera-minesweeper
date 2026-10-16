/* Same-origin D1 leaderboard client. Network failures never interrupt play. */
function base() { return (window.__CALDERA_CONFIG__?.leaderboardApi || '/api').replace(/\/$/, ''); }
export function isConfigured() { return window.__CALDERA_CONFIG__?.leaderboardApi !== false; }
async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(base() + path, { ...options, signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
    const data = await response.json();
    return response.ok ? data : { ok: false, error: data.error || 'The leaderboard is unavailable.' };
  } catch { return { ok: false, error: 'Could not reach the leaderboard. Check your connection and try again.' }; }
  finally { clearTimeout(timeout); }
}
export async function submitScore(score) {
  if (!isConfigured()) return { ok: false, offline: true };
  return request('/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(score) });
}
export async function topScores(difficulty, limit = 10) {
  if (!isConfigured()) return { ok: false, offline: true, rows: [] };
  return request('/leaderboard?' + new URLSearchParams({ difficulty, limit }));
}
export async function rankFor(difficulty, timeMs) {
  if (!isConfigured()) return null;
  const result = await request('/rank?' + new URLSearchParams({ difficulty, timeMs: Math.round(timeMs) }));
  return result.ok ? result.rank : null;
}
