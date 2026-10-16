import { t } from "./i18n.js";
/* Same-origin D1 leaderboard client. Network failures never interrupt play. */
const errors = {
  "Not found.": "error.notFound",
  "Method not allowed.": "error.method",
  "The leaderboard database is not connected.": "error.database",
  "Invalid difficulty.": "error.difficulty",
  "Invalid time.": "error.time",
  "Invalid limit.": "error.limit",
  "Cross-site submissions are not allowed.": "error.crossSite",
  "Send JSON data.": "error.json",
  "Too many submissions. Try again in a minute.": "error.rateLimit",
  "Submission is too large.": "error.tooLarge",
  "Invalid score or replay.": "error.invalidScore",
  "This run was already submitted.": "error.duplicate",
  "The leaderboard is temporarily unavailable.": "error.unavailable"
};
function failure(key) { return { ok: false, errorKey: key, error: t(key) }; }
function base() { return (window.__CALDERA_CONFIG__?.leaderboardApi || '/api').replace(/\/$/, ''); }
export function isConfigured() { return window.__CALDERA_CONFIG__?.leaderboardApi !== false; }
async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(base() + path, { ...options, signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
    const data = await response.json();
    return response.ok ? data : failure(errors[data.error] || 'error.unavailable');
  } catch { return failure('error.network'); }
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
