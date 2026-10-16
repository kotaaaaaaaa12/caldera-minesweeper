/* ============================================================
   settings.js — user settings model + persistence
   ============================================================ */

import * as storage from "./storage.js";

export const DEFAULTS = Object.freeze({
  language: "auto",
  name: "",              // leaderboard display name
  theme: "system",       // system | caldera | dark | slate | classic  (system => light/dark by OS)
  palette: "caldera",    // light-family palette choice when not dark
  question: false,
  chord: true,
  safeFirstClick: true,
  animations: true,
  haptics: true,
  sound: false,          // synthesized sound effects (off by default)
  noGuess: false,        // generate boards solvable without guessing
  contrast: false,       // high-contrast / color-blind-safe palette
  flagMode: false,       // mobile tap-to-flag
});

export function load() {
  const saved = storage.get("settings", {});
  return { ...DEFAULTS, ...saved };
}

export function save(settings) {
  storage.set("settings", settings);
}
