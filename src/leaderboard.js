import { t } from "./i18n.js";
import { playerProfile, profileSynced, storedPlayer } from "./player.js";
/* Same-origin D1 leaderboard client. Network failures never interrupt play. */
const errors = {
  "Invalid player profile.": "error.profile",
  "This device could not be verified.": "error.device",
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
let mutations = Promise.resolve();
function mutate(operation) {
  const pending = mutations.then(operation);
  mutations = pending.catch(() => {});
  return pending;
}
function sendProfile(path, player, score = {}) {
  return mutate(async () => {
    const result = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...score, playerId: player.playerId, playerToken: player.playerToken,
        name: player.name, nameVersion: player.nameVersion }) });
    if (result.ok) profileSynced(player);
    return result;
  });
}
export async function submitScore(score) {
  if (!isConfigured()) return { ok: false, offline: true };
  return sendProfile('/scores', playerProfile(score.name), score);
}
export async function updateName(name) {
  const player = playerProfile(name);
  if (!isConfigured()) return { ok: false, offline: true };
  return sendProfile('/profile', player);
}
export async function retryName(name) {
  if (!storedPlayer() && !name) return { ok: true, skipped: true };
  const player = playerProfile(name);
  if (!player.pending) return { ok: true, skipped: true };
  if (!isConfigured()) return { ok: false, offline: true };
  return sendProfile('/profile', player);
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
