import { t, applyTranslations, setLanguage, difficultyLabel } from "./i18n.js";
/* ============================================================
   main.js — composition root.
   Instantiates engine + renderer + input + timer + ui, wires the
   event flow, restores settings / in-progress game, and registers
   the service worker for offline play.

   Also drives the layered extras: always-seeded boards (so games
   are replayable/shareable), no-guess generation, the daily
   challenge, undo, pencil notes, 3BV metrics, sound, achievements,
   share + replay.
   ============================================================ */

import { Engine } from "./engine.js";
import { Renderer } from "./render.js";
import { Input } from "./input.js";
import { Timer } from "./timer.js";
import { UI, DIFFICULTIES } from "./ui.js";
import * as settingsStore from "./settings.js";
import * as stats from "./stats.js";
import * as storage from "./storage.js";
import * as solver from "./solver.js";
import { burst } from "./confetti.js";
import { formatTime } from "./timer.js";
import * as leaderboard from "./leaderboard.js";
import { compute3BV, efficiency, threeBVPerSecond } from "./metrics.js";
import { makeNoGuessGenerator } from "./generate.js";
import * as daily from "./daily.js";
import { setEnabled as setSound, sfx } from "./sound.js";
import * as achievements from "./achievements.js";
import { buildShare, copyText } from "./share.js";

const live = document.getElementById("live");
const wellEl = document.querySelector(".well");
const boardEl = document.getElementById("board");
const confettiEl = document.getElementById("confetti");

const settings = settingsStore.load();
setLanguage(settings.language);
const ui = new UI();
const renderer = new Renderer(boardEl);
let engine = new Engine({ ...presetConfig("beginner"), safeFirstClick: settings.safeFirstClick, allowQuestion: settings.question });
const timer = new Timer((ms) => ui.setTimer(ms));

let currentDiff = storage.get("lastDiff", "beginner");
let customConfig = storage.get("customConfig", { w: 16, h: 16, m: 40 });
let _pendingWin = null; // {difficulty, timeMs} awaiting a name before submit
if (!DIFFICULTIES[currentDiff] && currentDiff !== "custom") currentDiff = "beginner";

/* per-game run context (seed, daily flag, move log for replay, metrics) */
let run = freshRun();
function freshRun() {
  return { seed: 0, daily: false, dailyKey: "", noGuess: false, moves: [], clicks: 0, threeBV: 0 };
}

function presetConfig(diff) {
  const d = DIFFICULTIES[diff] || DIFFICULTIES.beginner;
  return { width: d.w, height: d.h, mines: d.m };
}

function reducedMotion() {
  return !settings.animations ||
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function newSeed() { return (Math.floor(Math.random() * 0xffffffff)) >>> 0; }

/* ---------- theme ---------- */
function prefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function resolveTheme() {
  const mode = settings.theme === "system" ? (prefersDark() ? "dark" : "light") : settings.theme;
  if (mode === "dark") return settings.palette === "slate" ? "slate" : "dark";
  return settings.palette === "classic" ? "classic" : "caldera";
}
function applyTheme() {
  document.documentElement.setAttribute("data-theme", resolveTheme());
  document.documentElement.setAttribute("data-anim", settings.animations ? "on" : "off");
  document.documentElement.setAttribute("data-contrast", settings.contrast ? "high" : "normal");
}

/* ---------- difficulty key (for stats/best) ---------- */
function diffKey() {
  if (run.daily) return daily.dailyDiffKey(run.dailyKey);
  if (currentDiff === "custom") return `custom-${engine.width}x${engine.height}-${engine.mineCount}`;
  return currentDiff;
}

/* ---------- new game ---------- */
function newGame(opts = {}) {
  stopReplay();
  _pendingWin = null;
  run = freshRun();
  run.id = crypto.randomUUID();
  run.rankable = true;
  run.daily = !!opts.daily;
  run.noGuess = !run.daily && !!settings.noGuess;

  let cfg;
  const resetOpts = { safeFirstClick: settings.safeFirstClick, allowQuestion: settings.question };

  if (run.daily) {
    run.dailyKey = daily.todayKey();
    run.seed = daily.seedForDate(run.dailyKey);
    cfg = { width: daily.DAILY_CONFIG.w, height: daily.DAILY_CONFIG.h, mines: daily.DAILY_CONFIG.m };
    resetOpts.seed = run.seed;
    resetOpts.safeFirstClick = true;
    resetOpts.prePlaceSafe = daily.dailySafeIndex();
  } else {
    run.seed = newSeed();
    cfg = currentDiff === "custom"
      ? { width: customConfig.w, height: customConfig.h, mines: customConfig.m }
      : presetConfig(currentDiff);
    resetOpts.seed = run.seed;
    if (run.noGuess) resetOpts.mineGenerator = makeNoGuessGenerator();
  }

  engine.reset({ ...cfg, ...resetOpts });
  run.safeFirstClick = engine.safeFirstClick;
  run.allowQuestion = engine.allowQuestion;
  renderer.build(engine);
  timer.reset();
  ui.setMineCount(engine.minesRemaining);
  ui.setFace("idle");
  ui.setTimer(0);
  ui.hideResult();
  ui.clearTimerRecord();
  ui.setActiveDifficulty(run.daily ? "daily" : currentDiff);
  ui.setBest(stats.bestFor(diffKey()));
  ui.setUndo(false);
  ui.setModeBadge(run);
  wellEl.classList.remove("lost", "win-glow");
  clearSavedGame();
  if (!run.daily) storage.set("lastDiff", currentDiff);
}

/* ---------- the action funnel ---------- */
function handle(result, opts = {}) {
  if (!result || result.kind === "noop") return;
  renderer.apply(result, { animate: !reducedMotion() });
  ui.setMineCount(engine.minesRemaining);
  ui.setUndo(engine.canUndo && engine.status === "playing");

  if (result.started) {
    ui.setFace("playing");
    timer.start(() => engine.elapsedMs());
    run.threeBV = compute3BV(engine); // board is placed now
  }
  if (!opts.replay) playSound(result);

  if (opts.replay) {
    if (result.ended) { timer.stop(); ui.setFace(result.ended); }
    return;
  }
  if (result.ended === "won") return onWin();
  if (result.ended === "lost") return onLose(result.origin);
  if (engine.status === "playing") saveGame();
}

function playSound(result) {
  switch (result.kind) {
    case "reveal": (result.changed.length > 3 ? sfx.cascade : sfx.reveal)(); break;
    case "flag": sfx.flag(); break;
    case "note": sfx.flag(); break;
    case "win": sfx.win(); break;
    case "lose": sfx.explode(); break;
  }
}

function onWin() {
  timer.stop();
  ui.setMineCount(0);
  ui.setFace("won");
  ui.setUndo(false);
  const timeMs = engine.elapsedMs();
  const dk = diffKey();
  const isBest = stats.record(dk, { won: true, timeMs, assisted: engine.assisted });
  ui.setBest(stats.bestFor(dk));
  if (!reducedMotion()) {
    wellEl.classList.add("win-glow");
    burst(confettiEl, { reduced: false, colors: themedConfetti() });
  }
  if (isBest && !engine.assisted) ui.pulseTimer();

  const ctx = winContext(true, timeMs);
  const fresh = achievements.evaluate(ctx);
  announce("game.announceWin", () => ({ time: formatTime(timeMs) }), isBest ? "game.bestAnnouncement" : null);
  saveReplay(true, timeMs);
  clearSavedGame();
  ui.refreshStats(stats.all());

  // Online leaderboard: ranked presets + daily, never assisted runs.
  const lbEligible = leaderboard.isConfigured() && run.rankable && !!run.id && !engine.assisted &&
    (!!DIFFICULTIES[currentDiff] || run.daily) && !isCustomRun();
  const lbDiff = run.daily ? daily.dailyDiffKey(run.dailyKey) : currentDiff;
  const lbLabel = difficultyLabel(lbDiff);

  const wonRun = run;
  const proof = {
    seed: run.seed, safeFirstClick: run.safeFirstClick, allowQuestion: run.allowQuestion,
    noGuess: run.noGuess, assisted: engine.assisted, moves: run.moves.map(move => ({ ...move })),
  };
  const submission = { id: run.id, difficulty: lbDiff, timeMs: Math.max(1, Math.round(timeMs)), proof, label: lbLabel };
  setTimeout(() => {
    if (run !== wonRun || replaying || engine.status !== "won") return;
    ui.showResult({ won: true, timeMs, isBest: isBest && !engine.assisted, metrics: ctx });
    flushAchievements(fresh);
    if (!lbEligible) return;
    _pendingWin = submission;
    if (settings.name) submitWin(submission, settings.name);
    else ui.showOverlaySubmit("");
  }, 650);
}

function isCustomRun() { return !run.daily && currentDiff === "custom"; }

function winContext(won, timeMs) {
  const s = stats.all();
  const totalWins = Object.values(s.wins || {}).reduce((a, b) => a + b, 0);
  const eff = efficiency(run.threeBV, run.clicks);
  const bvps = threeBVPerSecond(run.threeBV, timeMs);
  return {
    won, difficulty: currentDiff, timeMs, assisted: engine.assisted,
    noGuess: run.noGuess, daily: run.daily, dailyKey: run.dailyKey,
    title: run.daily ? t("game.dailyDate", { date: run.dailyKey }) : difficultyLabel(currentDiff),
    threeBV: run.threeBV, threeBVps: bvps, efficiency: eff,
    streak: s.streak || 0, totalWins,
  };
}

const submissions = new Set();
async function submitWin(submission, name) {
  if (submissions.has(submission.id)) return;
  submissions.add(submission.id);
  let res;
  try { res = await leaderboard.submitScore({ ...submission, name }); }
  finally { submissions.delete(submission.id); }
  if (_pendingWin !== submission) return;
  if (!res.ok) {
    ui.setOverlayRank(res.errorKey || "error.submit");
    ui.showOverlaySubmit(name);
    return;
  }
  _pendingWin = null;
  ui.setOverlayRank("leaderboard.rank", { rank: res.rank, difficulty: submission.difficulty });
}

let leaderboardRequest = 0;
async function loadLeaderboard(diff) {
  const requestId = ++leaderboardRequest;
  if (!leaderboard.isConfigured()) { ui.renderLeaderboard({ offline: true }); return; }
  ui.renderLeaderboardLoading();
  const result = await leaderboard.topScores(diff, 10);
  if (requestId === leaderboardRequest) ui.renderLeaderboard(result);
}

function onLose() {
  timer.stop();
  ui.setFace("lost");
  ui.setUndo(engine.canUndo);
  wellEl.classList.add("lost");
  stats.record(diffKey(), { won: false, timeMs: engine.elapsedMs(), assisted: engine.assisted });
  announce("game.announceLoss");
  saveReplay(false, engine.elapsedMs());
  const lostRun = run;
  setTimeout(() => { if (run === lostRun && !replaying && engine.status === "lost") ui.showResult({ won: false }); }, 600);
  clearSavedGame();
  ui.refreshStats(stats.all());
}

function flushAchievements(fresh) {
  if (!fresh || !fresh.length) return;
  sfx.achievement();
  ui.toastAchievements(fresh);
}

function themedConfetti() {
  const cs = getComputedStyle(document.documentElement);
  return ["--accent", "--accent-soft", "--win", "--n1"].map((v) => cs.getPropertyValue(v).trim() || "#FF7A1A");
}

/* ---------- input handlers ---------- */
const handlers = {
  reveal(i) {
    if (replaying) return;
    const r = engine.reveal(i);
    if (r.kind !== "noop") { run.moves.push({ a: "r", i, t: rt() }); run.clicks++; }
    handle(r);
  },
  flag(i) {
    if (replaying) return;
    const r = engine.toggleFlag(i);
    if (r.kind !== "noop") { run.moves.push({ a: "f", i, t: rt() }); handle(r); maybeAnnounceFlag(i); }
  },
  chord(i) {
    if (replaying || !settings.chord) return;
    const r = engine.chord(i);
    if (r.kind !== "noop") { run.moves.push({ a: "c", i, t: rt() }); run.clicks++; }
    handle(r);
  },
  note(i, digit) {
    if (replaying) return;
    const r = engine.setNote(i, digit);
    if (r.kind !== "noop") { run.moves.push({ a: "n", i, d: digit, t: rt() }); handle(r); }
  },
  undo() { doUndo(); },
  zoomIn() { setZoom(+0.15); },
  zoomOut() { setZoom(-0.15); },
  restart() { newGame(); },
};
function rt() { return Math.round(engine.elapsedMs()); }

function maybeAnnounceFlag(i) {
  announce("game.remaining", { count: engine.minesRemaining });
}

const input = new Input(boardEl, renderer, handlers, settings);

/* surprise face while pressing a covered cell */
boardEl.addEventListener("pointerdown", (e) => {
  if (engine.status === "lost" || engine.status === "won") return;
  const c = e.target.closest && e.target.closest(".cell");
  if (c && c.dataset.state === "hidden") ui.setFace("surprise");
});
window.addEventListener("pointerup", () => {
  if (engine.status === "playing") ui.setFace("playing");
  else if (engine.status === "idle") ui.setFace("idle");
});

/* ---------- undo ---------- */
function doUndo() {
  if (replaying) return;
  if (engine.status === "won") return;
  const changed = engine.undo();
  if (!changed) return;
  if (engine.status !== "lost") wellEl.classList.remove("lost");
  if (engine.status === "playing") { ui.setFace("playing"); timer.start(() => engine.elapsedMs()); }
  else if (engine.status === "idle") { ui.setFace("idle"); timer.reset(); }
  ui.hideResult();
  for (const i of changed) renderer.paint(renderer.cells[i], i);
  ui.setMineCount(engine.minesRemaining);
  ui.setUndo(engine.canUndo);
  ui.setModeBadge(run); // assisted marker
  run.moves.push({ a: "u", t: rt() });
  announce("game.undone");
  if (engine.status === "playing") saveGame();
}

/* ---------- hint ---------- */
function doHint() {
  if (engine.status === "won" || engine.status === "lost" || replaying) return;
  if (!engine.firstClickDone) {
    const center = engine.idx((engine.width / 2) | 0, (engine.height / 2) | 0);
    engine.assisted = true;
    handlers.reveal(center);
    return;
  }
  const safe = solver.hint(engine);
  if (safe == null) {
    announce("game.noSafeMove");
    flashHintEmpty();
    return;
  }
  engine.assisted = true;
  ui.setModeBadge(run);
  const cell = renderer.cells[safe];
  cell.classList.add("cursor");
  handlers.reveal(safe);
}
function flashHintEmpty() {
  ui.el.hint.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }],
    { duration: 240 }
  );
}

/* ---------- share ---------- */
async function doShare() {
  const last = storage.get("lastGame", null);
  const ctx = last ? last.ctx : winContext(engine.status === "won", engine.elapsedMs());
  const text = buildShare(ctx, engine);
  const ok = await copyText(text);
  ui.flashShare(ok ? "share.copied" : "share.failed");
  announce(ok ? "share.announced" : "share.copyFailed");
}

/* ---------- replay ---------- */
let replaying = false;
let replayTimers = [];

function saveReplay(won, timeMs) {
  storage.set("lastGame", {
    seed: run.seed, daily: run.daily, dailyKey: run.dailyKey, noGuess: run.noGuess,
    safeFirstClick: run.safeFirstClick, allowQuestion: run.allowQuestion,
    diff: currentDiff, custom: customConfig, moves: run.moves,
    ctx: winContext(won, timeMs),
  });
}

function stopReplay() {
  replaying = false;
  replayTimers.forEach((t) => clearTimeout(t));
  replayTimers = [];
  wellEl.classList.remove("replaying");
}

function doReplay() {
  const last = storage.get("lastGame", null);
  if (!last || !last.moves || !last.moves.length) { announce("game.noReplay"); return; }
  stopReplay();
  _pendingWin = null;
  run.rankable = false;
  ui.hideResult();

  // rebuild the exact same board
  const resetOpts = { safeFirstClick: last.safeFirstClick ?? settings.safeFirstClick, allowQuestion: last.allowQuestion ?? settings.question, seed: last.seed };
  let cfg;
  if (last.daily) {
    cfg = { width: daily.DAILY_CONFIG.w, height: daily.DAILY_CONFIG.h, mines: daily.DAILY_CONFIG.m };
    resetOpts.safeFirstClick = true;
    resetOpts.prePlaceSafe = daily.dailySafeIndex();
  } else {
    cfg = last.diff === "custom"
      ? { width: last.custom.w, height: last.custom.h, mines: last.custom.m }
      : presetConfig(last.diff);
    if (last.noGuess) resetOpts.mineGenerator = makeNoGuessGenerator();
  }
  engine.reset({ ...cfg, ...resetOpts });
  renderer.build(engine);
  timer.reset();
  ui.setMineCount(engine.minesRemaining);
  ui.setFace("playing");
  wellEl.classList.remove("lost", "win-glow");
  wellEl.classList.add("replaying");
  replaying = true;
  announce("game.replaying");

  const moves = last.moves;
  let prevT = 0;
  let acc = 0;
  moves.forEach((mv, k) => {
    const dt = Math.max(60, Math.min(420, (mv.t || 0) - prevT));
    prevT = mv.t || prevT;
    acc += k === 0 ? 200 : dt;
    replayTimers.push(setTimeout(() => {
      if (!replaying) return;
      stepReplay(mv);
      if (k === moves.length - 1) { replaying = false; wellEl.classList.remove("replaying"); }
    }, acc));
  });
}

function stepReplay(mv) {
  let r = null;
  if (mv.a === "r") r = engine.reveal(mv.i);
  else if (mv.a === "f") r = engine.toggleFlag(mv.i);
  else if (mv.a === "c") r = engine.chord(mv.i);
  else if (mv.a === "n") r = engine.setNote(mv.i, mv.d);
  else if (mv.a === "u") { const ch = engine.undo(); if (ch) ch.forEach((i) => renderer.paint(renderer.cells[i], i)); ui.setMineCount(engine.minesRemaining); return; }
  if (r && r.kind !== "noop") {
    if (r.started) { timer.start(() => engine.elapsedMs()); }
    handle(r, { replay: true });
    playSound(r);
  }
}

/* ---------- persistence of in-progress game ---------- */
function saveGame() {
  storage.set("savedGame", { snap: engine.snapshot(), diff: currentDiff, custom: customConfig, run });
}
function clearSavedGame() { storage.set("savedGame", null); }

function tryRestore() {
  const saved = storage.get("savedGame", null);
  if (!saved || !saved.snap || saved.snap.status !== "playing") return false;
  try {
    engine = Engine.fromSnapshot(saved.snap);
    currentDiff = saved.diff;
    customConfig = saved.custom || customConfig;
    if (saved.run) run = { ...freshRun(), ...saved.run };
    if (run.noGuess && !engine.firstClickDone) engine.mineGenerator = makeNoGuessGenerator();
    run.threeBV = compute3BV(engine);
    renderer.build(engine);
    renderer.repaintAll();
    ui.setMineCount(engine.minesRemaining);
    ui.setActiveDifficulty(run.daily ? "daily" : currentDiff);
    ui.setBest(stats.bestFor(diffKey()));
    ui.setFace("playing");
    ui.setUndo(engine.canUndo);
    ui.setModeBadge(run);
    timer.start(() => engine.elapsedMs());
    return true;
  } catch {
    return false;
  }
}

/* ---------- live region ---------- */
let announceTimer = 0;
let lastAnnouncement = null;
function renderAnnouncement() {
  if (!lastAnnouncement) return;
  const { key, values, suffix } = lastAnnouncement;
  live.textContent = t(key, typeof values === 'function' ? values() : values) + (suffix ? t(suffix) : '');
}
function announce(key, values = {}, suffix = null) {
  lastAnnouncement = { key, values, suffix };
  clearTimeout(announceTimer);
  announceTimer = setTimeout(renderAnnouncement, 120);
}

/* ---------- zoom ---------- */
function setZoom(delta, absolute) {
  renderer.setUserZoom(absolute != null ? absolute : renderer.userZoom + delta);
  ui.setZoomLabel(renderer.userZoom);
}

/* ---------- wire UI ---------- */
ui.bind({
  onRestart: () => { stopReplay(); newGame(); },
  onDifficulty: (diff) => { stopReplay(); currentDiff = diff; newGame(); },
  onDaily: () => { stopReplay(); newGame({ daily: true }); },
  onCustom: (cfg) => {
    stopReplay();
    customConfig = cfg;
    storage.set("customConfig", cfg);
    currentDiff = "custom";
    newGame();
  },
  onHint: doHint,
  onUndo: doUndo,
  onShare: doShare,
  onReplay: doReplay,
  onZoomIn: () => setZoom(+0.15),
  onZoomOut: () => setZoom(-0.15),
  onZoomReset: () => setZoom(0, 1),
  onThemeToggle: () => {
    settings.theme = settings.theme === "system" ? "dark"
      : settings.theme === "dark" ? "light" : "system";
    applyTheme();
    settingsStore.save(settings);
    announce("theme.changed", () => ({ theme: t("theme." + (settings.theme === "system" ? "system" : settings.theme)) }));
  },
  onOpenStats: () => ui.openStats(stats.all(), achievements.unlockedSet()),
  onResetStats: () => {
    stats.reset(); achievements.reset();
    ui.refreshStats(stats.all()); ui.setBest(stats.bestFor(diffKey()));
  },
  onOpenLeaderboard: () => {
    const d = run.daily ? daily.dailyDiffKey(run.dailyKey) : (DIFFICULTIES[currentDiff] ? currentDiff : "beginner");
    ui.openLeaderboard(d);
    loadLeaderboard(d);
  },
  onLbDifficulty: (d) => loadLeaderboard(d),
  onSubmitScore: (name) => {
    const clean = (name || "").trim().slice(0, 20);
    if (clean) { settings.name = clean; settingsStore.save(settings); ui.reflectSettings(settings); }
    if (_pendingWin) submitWin(_pendingWin, clean || "Anonymous");
  },
  onSetting: (key, val) => {
    if (["safeFirstClick", "question"].includes(key) && settings[key] !== val) {
      if (engine.firstClickDone || run.moves.length) run.rankable = false;
      else if (key === "safeFirstClick") run.safeFirstClick = run.daily ? true : val;
      else run.allowQuestion = val;
    }
    settings[key] = val;
    settingsStore.save(settings);
    if (key === "language") setLanguage(val);
    if (key === "palette" || key === "animations" || key === "contrast") applyTheme();
    if (key === "sound") setSound(val);
    if (key === "safeFirstClick") { ui.safeFirstClick = val; if (!engine.firstClickDone && !run.daily) engine.safeFirstClick = val; }
    if (key === "question") engine.allowQuestion = val;
  },
});

window.addEventListener('caldera-languagechange', () => {
  ui.refreshLanguage();
  renderer.refreshLabels();
  ui.setBest(stats.bestFor(diffKey()));
  ui.refreshStats(stats.all());
  renderAnnouncement();
});

/* react to OS theme changes while in system mode */
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "system") applyTheme();
  });
}
window.addEventListener("resize", () => renderer.fit());

/* ---------- boot ---------- */
applyTranslations();
applyTheme();
setSound(settings.sound);
ui.reflectSettings(settings);
ui.setZoomLabel(renderer.userZoom);
if (!tryRestore()) newGame();

/* service worker (offline) — relative scope, GitHub-Pages friendly */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
