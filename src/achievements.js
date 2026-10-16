import { t } from "./i18n.js";
/* ============================================================
   achievements.js — unlockable badges persisted in localStorage.
   evaluate(ctx) is pure over its inputs; unlocked ids are stored
   so a badge only ever fires its toast once.
   ============================================================ */

import * as storage from "./storage.js";

const FIELD = "achievements";

/** Each badge: id, icon, label, desc, and a predicate over the win context.
    ctx = { won, difficulty, timeMs, assisted, noGuess, daily,
            threeBV, threeBVps, efficiency, streak, totalWins } */
export const ACHIEVEMENTS = [
  { id: "first-win", icon: "🌱", get label() { return t("achievement.first-win.label"); }, get desc() { return t("achievement.first-win.desc"); },
    test: (c) => c.won },
  { id: "expert", icon: "💎", get label() { return t("achievement.expert.label"); }, get desc() { return t("achievement.expert.desc"); },
    test: (c) => c.won && c.difficulty === "expert" },
  { id: "sub30-int", icon: "⚡", get label() { return t("achievement.sub30-int.label"); }, get desc() { return t("achievement.sub30-int.desc"); },
    test: (c) => c.won && c.difficulty === "intermediate" && c.timeMs < 30000 },
  { id: "sub100-exp", icon: "🔥", get label() { return t("achievement.sub100-exp.label"); }, get desc() { return t("achievement.sub100-exp.desc"); },
    test: (c) => c.won && c.difficulty === "expert" && c.timeMs < 100000 },
  { id: "streak-5", icon: "🎯", get label() { return t("achievement.streak-5.label"); }, get desc() { return t("achievement.streak-5.desc"); },
    test: (c) => c.won && c.streak >= 5 },
  { id: "streak-10", icon: "👑", get label() { return t("achievement.streak-10.label"); }, get desc() { return t("achievement.streak-10.desc"); },
    test: (c) => c.won && c.streak >= 10 },
  { id: "no-guess", icon: "🧠", get label() { return t("achievement.no-guess.label"); }, get desc() { return t("achievement.no-guess.desc"); },
    test: (c) => c.won && c.noGuess && !c.assisted },
  { id: "daily", icon: "📅", get label() { return t("achievement.daily.label"); }, get desc() { return t("achievement.daily.desc"); },
    test: (c) => c.won && c.daily },
  { id: "efficient", icon: "🎼", get label() { return t("achievement.efficient.label"); }, get desc() { return t("achievement.efficient.desc"); },
    test: (c) => c.won && c.efficiency != null && c.efficiency >= 0.999 },
  { id: "fast-3bv", icon: "🚀", get label() { return t("achievement.fast-3bv.label"); }, get desc() { return t("achievement.fast-3bv.desc"); },
    test: (c) => c.won && c.threeBVps != null && c.threeBVps >= 2 },
  { id: "centurion", icon: "🏅", get label() { return t("achievement.centurion.label"); }, get desc() { return t("achievement.centurion.desc"); },
    test: (c) => c.won && c.totalWins >= 100 },
];

export function unlockedSet() {
  return new Set(storage.get(FIELD, []));
}

/** Evaluate the context; persist + return any newly-unlocked badges. */
export function evaluate(ctx) {
  const have = unlockedSet();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id)) continue;
    let ok = false;
    try { ok = !!a.test(ctx); } catch { ok = false; }
    if (ok) { have.add(a.id); fresh.push(a); }
  }
  if (fresh.length) storage.set(FIELD, [...have]);
  return fresh;
}

export function reset() { storage.set(FIELD, []); }
