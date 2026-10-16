import { cleanName } from './player.js';
import { Engine } from '../src/engine.js';
import { makeNoGuessGenerator } from '../src/generate.js';
import { seedForDate, dailySafeIndex } from '../src/daily.js';

const presets = { beginner: [9,9,10], intermediate: [16,16,40], expert: [30,16,99] };
function requireValid(condition) { if (!condition) throw new Error('invalid-score'); }

// Replay validation rejects incomplete or losing games; it is not bot detection.
export function validateScore(body) {
  requireValid(body && typeof body === 'object');
  const { id, difficulty, timeMs, proof } = body;
  requireValid(typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
  requireValid(Number.isInteger(timeMs) && timeMs >= 1 && timeMs <= 86400000);
  requireValid(typeof body.name === 'string' && body.name.length <= 100);
  const name = cleanName(body.name);
  requireValid(proof && Number.isInteger(proof.seed) && proof.seed >= 0 && proof.seed <= 0xffffffff);
  requireValid(typeof proof.safeFirstClick === 'boolean' && typeof proof.allowQuestion === 'boolean' && typeof proof.noGuess === 'boolean');
  requireValid(proof.assisted === false);
  const daily = /^daily-\d{4}-\d{2}-\d{2}$/.test(difficulty || '');
  let cfg = Object.hasOwn(presets, difficulty) ? presets[difficulty] : null;
  if (daily) {
    const day = difficulty.slice(6);
    const stamp = Date.parse(day + 'T00:00:00Z');
    requireValid(Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day);
    requireValid(stamp <= Date.now() + 86400000);
    requireValid(proof.seed === seedForDate(day) && proof.safeFirstClick && !proof.noGuess);
    cfg = presets.intermediate;
  }
  requireValid(cfg && Array.isArray(proof.moves) && proof.moves.length > 0 && proof.moves.length <= 3000);
  const [width, height, mines] = cfg;
  const engine = new Engine({ width, height, mines, seed: proof.seed,
    safeFirstClick: proof.safeFirstClick, allowQuestion: proof.allowQuestion,
    ...(daily ? { prePlaceSafe: dailySafeIndex() } : {}),
    ...(proof.noGuess ? { mineGenerator: makeNoGuessGenerator() } : {}),
  });
  let previous = 0;
  for (const move of proof.moves) {
    requireValid(move && ['r','f','c','n'].includes(move.a));
    requireValid(Number.isInteger(move.i) && move.i >= 0 && move.i < width * height);
    requireValid(Number.isInteger(move.t) && move.t >= previous && move.t <= timeMs + 10);
    requireValid(engine.status !== 'won' && engine.status !== 'lost');
    previous = move.t;
    if (move.a === 'r') engine.reveal(move.i);
    if (move.a === 'f') engine.toggleFlag(move.i);
    if (move.a === 'c') engine.chord(move.i);
    if (move.a === 'n') {
      requireValid(Number.isInteger(move.d) && move.d >= 0 && move.d <= 8);
      engine.setNote(move.i, move.d);
    }
  }
  requireValid(engine.status === 'won' && Math.abs(previous - timeMs) <= 10);
  return { id, name, difficulty, timeMs };
}
