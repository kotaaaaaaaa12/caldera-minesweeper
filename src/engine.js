/* ============================================================
   engine.js — PURE, DOM-free Minesweeper logic.

   Model: two flat typed arrays indexed by idx = y*width + x.
     - adjacency: Uint8Array  (0..8 neighbor mine count)
     - state:     Uint8Array  (packed bitflags, see board.js)
   Win is O(1): revealedCount === width*height - mineCount.
   Every mutating method returns a result describing what changed
   so the renderer can do O(changed) DOM updates.

   Extras layered on the pure core (all opt-in, all deterministic
   when a seed is supplied):
     - undo()           rewind the last reveal/flag/chord
     - pencil notes     candidate digit on a covered cell
     - layout injection  setLayout()/mineGenerator (daily + no-guess)
   ============================================================ */

import {
  MINE,
  mulberry32,
  isMine, isRevealed, isFlagged, isQuestion, isExploded, isWrongFlag,
  setMine, setRevealed, setFlagged, clearFlagged, setQuestion, clearQuestion,
  setExploded, setWrongFlag,
} from "./board.js";

const NOOP = Object.freeze({ changed: [], origin: -1, started: false, ended: null, kind: "noop" });
const HISTORY_CAP = 240;

export class Engine {
  constructor(config = {}) {
    this.reset(config);
  }

  reset({
    width = 9, height = 9, mines = 10, seed = null,
    safeFirstClick = true, allowQuestion = false,
    mineGenerator = null, prePlaceSafe = null,
  } = {}) {
    width = clampInt(width, 2, 200);
    height = clampInt(height, 2, 200);
    const cells = width * height;
    // a board must keep at least 1 safe cell; with safe-first-click reserve 9.
    const maxMines = safeFirstClick ? Math.max(1, cells - 9) : cells - 1;
    mines = clampInt(mines, 1, maxMines);

    this.width = width;
    this.height = height;
    this.mineCount = mines;
    this.safeFirstClick = safeFirstClick;
    this.allowQuestion = allowQuestion;
    this.mineGenerator = mineGenerator; // (engine, safeIdx) => number[] | null

    this.adjacency = new Uint8Array(cells);
    this.state = new Uint8Array(cells);
    this.notes = new Uint8Array(cells); // 0 = none, 1..8 = pencil candidate digit
    this._stack = new Int32Array(cells);

    this.revealedCount = 0;
    this.flagCount = 0;
    this.status = "idle"; // idle | playing | won | lost
    this.firstClickDone = false;
    this.startTime = 0;
    this.endTime = 0;
    this.seed = seed;
    this.assisted = false;
    this._placed = false;
    this._history = [];
    this._rand = seed == null ? Math.random : mulberry32(seed >>> 0);

    // Pre-placed, click-independent layout (daily challenge): the board is
    // identical for everyone, placement does NOT defer to the first click,
    // so the canonical safe opening is the only first-click guarantee.
    if (prePlaceSafe != null) {
      this._placeMines(clampInt(prePlaceSafe, 0, cells - 1));
      this._placed = true;
    }
    return this;
  }

  get totalCells() { return this.width * this.height; }
  get safeCells() { return this.totalCells - this.mineCount; }
  get minesRemaining() { return this.mineCount - this.flagCount; }
  idx(x, y) { return y * this.width + x; }
  xOf(i) { return i % this.width; }
  yOf(i) { return (i / this.width) | 0; }

  /* up-to-8 in-bounds neighbor indices */
  neighbors(i) {
    const { width, height } = this;
    const x = i % width;
    const y = (i / width) | 0;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        out.push(ny * width + nx);
      }
    }
    return out;
  }

  /* ----- mine placement ----- */
  /** Build the candidate pool around a safe cell and place mines into it.
      Uses an injected generator (no-guess) when present, else a partial
      Fisher–Yates over the non-excluded cells (no rejection sampling). */
  _placeMines(safeIdx) {
    const { state, totalCells } = this;

    if (this.mineGenerator) {
      const layout = this.mineGenerator(this, safeIdx);
      if (layout && layout.length === this.mineCount) {
        this._applyLayout(layout);
        return;
      }
      // generator gave up — fall through to a plain random board.
    }

    const forbidden = new Set([safeIdx]);
    if (this.safeFirstClick) {
      for (const n of this.neighbors(safeIdx)) forbidden.add(n);
    }
    // If exclusion zone leaves too few candidates (tiny custom boards),
    // shrink it to just the clicked cell — still first-click-safe.
    if (totalCells - forbidden.size < this.mineCount) {
      forbidden.clear();
      forbidden.add(safeIdx);
    }

    const pool = [];
    for (let i = 0; i < totalCells; i++) if (!forbidden.has(i)) pool.push(i);
    for (let k = 0; k < this.mineCount; k++) {
      const j = k + Math.floor(this._rand() * (pool.length - k));
      const tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
      setMine(state, pool[k]);
    }
    this._recomputeAdjacency();
  }

  /** Place an explicit set of mine indices (daily / generator output). */
  _applyLayout(indices) {
    const s = this.state;
    for (const i of indices) setMine(s, i);
    this._recomputeAdjacency();
  }

  _recomputeAdjacency() {
    const adj = this.adjacency;
    adj.fill(0);
    const s = this.state;
    for (let i = 0; i < this.totalCells; i++) {
      if (!isMine(s, i)) continue;
      for (const n of this.neighbors(i)) adj[n]++;
    }
  }

  /* ----- reveal (entry for left-click / keyboard) ----- */
  reveal(i) {
    if (this.status === "won" || this.status === "lost") return NOOP;
    if (i < 0 || i >= this.totalCells) return NOOP;
    const s = this.state;
    if (isFlagged(s, i)) return NOOP;
    if (isRevealed(s, i)) return NOOP;

    let started = false;
    if (!this.firstClickDone) {
      if (!this._placed) this._placeMines(i);
      this.firstClickDone = true;
      if (this.status === "idle") this.startTime = now();
      this.status = "playing";
      started = true;
    }
    this._pushHistory();

    if (isMine(s, i)) {
      const changed = this._lose(i);
      return { changed, origin: i, started, ended: "lost", kind: "lose" };
    }

    const changed = this._flood(i);
    if (this.revealedCount === this.safeCells) {
      const more = this._win();
      return { changed: changed.concat(more), origin: i, started, ended: "won", kind: "win" };
    }
    return { changed, origin: i, started, ended: null, kind: "reveal" };
  }

  /* iterative flood-fill (never recursion).
     Cells are marked revealed at ENQUEUE time and only zero-adjacency
     cells are pushed, so every cell is handled exactly once and the
     preallocated stack can never overflow. */
  _flood(start) {
    const { state: s, adjacency: adj } = this;
    const stack = this._stack;
    let sp = 0;
    const changed = [];

    const open = (i) => {
      setRevealed(s, i);
      if (isQuestion(s, i)) clearQuestion(s, i);
      if (this.notes[i]) this.notes[i] = 0;
      this.revealedCount++;
      changed.push(i);
      if (adj[i] === 0) stack[sp++] = i;
    };

    if (isRevealed(s, start) || isFlagged(s, start)) return changed;
    open(start);
    while (sp > 0) {
      const i = stack[--sp];
      const ns = this.neighbors(i);
      for (let k = 0; k < ns.length; k++) {
        const n = ns[k];
        if (!isRevealed(s, n) && !isFlagged(s, n)) open(n);
      }
    }
    return changed;
  }

  /* ----- chord (reveal neighbors of a satisfied number) ----- */
  chord(i) {
    if (this.status !== "playing") return NOOP;
    const s = this.state;
    if (!isRevealed(s, i)) return NOOP;
    const adj = this.adjacency[i];
    if (adj === 0) return NOOP;

    const ns = this.neighbors(i);
    let flagged = 0;
    for (const n of ns) if (isFlagged(s, n)) flagged++;
    if (flagged !== adj) return NOOP;

    this._pushHistory();

    // any non-flagged mine under the chord → loss
    let hitMine = -1;
    for (const n of ns) {
      if (!isFlagged(s, n) && !isRevealed(s, n) && isMine(s, n)) { hitMine = n; break; }
    }
    if (hitMine !== -1) {
      const changed = this._lose(hitMine);
      return { changed, origin: i, started: false, ended: "lost", kind: "lose" };
    }

    let changed = [];
    for (const n of ns) {
      if (!isFlagged(s, n) && !isRevealed(s, n)) changed = changed.concat(this._flood(n));
    }
    if (changed.length === 0) { this._history.pop(); return NOOP; }
    if (this.revealedCount === this.safeCells) {
      const more = this._win();
      return { changed: changed.concat(more), origin: i, started: false, ended: "won", kind: "win" };
    }
    return { changed, origin: i, started: false, ended: null, kind: "reveal" };
  }

  /* ----- flag / question cycle ----- */
  toggleFlag(i) {
    if (this.status === "won" || this.status === "lost") return NOOP;
    const s = this.state;
    if (isRevealed(s, i)) return NOOP;

    // begin the game on first flag too (so timer/face react), but do NOT
    // place mines yet — placement still defers to the first reveal.
    let started = false;
    if (this.status === "idle") { this.status = "playing"; started = true; this.startTime = now(); this.firstClickDone = false; }

    this._pushHistory();
    if (this.notes[i]) this.notes[i] = 0;

    if (isFlagged(s, i)) {
      clearFlagged(s, i);
      this.flagCount--;
      if (this.allowQuestion) setQuestion(s, i);
    } else if (isQuestion(s, i)) {
      clearQuestion(s, i);
    } else {
      setFlagged(s, i);
      this.flagCount++;
    }
    return { changed: [i], origin: i, started, ended: null, kind: "flag" };
  }

  /* ----- pencil notes (candidate digit on a covered cell) ----- */
  /** Set/clear a pencil candidate digit (1..8) on a covered cell.
      Passing the same digit again clears it. Returns a flag-kind result. */
  setNote(i, digit) {
    if (this.status === "won" || this.status === "lost") return NOOP;
    const s = this.state;
    if (isRevealed(s, i) || isFlagged(s, i)) return NOOP;
    digit = clampInt(digit, 0, 8);
    this.notes[i] = this.notes[i] === digit ? 0 : digit;
    return { changed: [i], origin: i, started: false, ended: null, kind: "note" };
  }

  _lose(struck) {
    const s = this.state;
    setRevealed(s, struck);
    setExploded(s, struck);
    this.revealedCount++;
    const changed = [struck];
    for (let i = 0; i < this.totalCells; i++) {
      if (i === struck) continue;
      if (isMine(s, i) && !isFlagged(s, i)) { setRevealed(s, i); this.revealedCount++; changed.push(i); }
      else if (!isMine(s, i) && isFlagged(s, i)) { setWrongFlag(s, i); changed.push(i); }
    }
    this.status = "lost";
    this.endTime = now();
    return changed;
  }

  _win() {
    const s = this.state;
    const changed = [];
    // auto-flag any remaining covered mines for a tidy finish
    for (let i = 0; i < this.totalCells; i++) {
      if (isMine(s, i) && !isFlagged(s, i)) { setFlagged(s, i); this.flagCount++; changed.push(i); }
    }
    this.status = "won";
    this.endTime = now();
    return changed;
  }

  /* ----- undo: rewind the last reveal/flag/chord ----- */
  _pushHistory() {
    if (this._history.length >= HISTORY_CAP) this._history.shift();
    this._history.push({
      state: this.state.slice(),
      notes: this.notes.slice(),
      revealedCount: this.revealedCount,
      flagCount: this.flagCount,
      status: this.status,
    });
  }

  get canUndo() { return this._history.length > 0; }

  /** Rewind one move. Returns the indices that changed, or null if empty.
      Using undo marks the run assisted (no best-time / leaderboard). */
  undo() {
    const prev = this._history.pop();
    if (!prev) return null;
    const before = this.state;
    const after = prev.state;
    const changed = [];
    for (let i = 0; i < after.length; i++) if (before[i] !== after[i] || this.notes[i] !== prev.notes[i]) changed.push(i);
    this.state = after;
    this.notes = prev.notes;
    this.revealedCount = prev.revealedCount;
    this.flagCount = prev.flagCount;
    this.status = prev.status;
    this.assisted = true;
    return changed;
  }

  elapsedMs() {
    if (this.status === "idle") return 0;
    const end = (this.status === "won" || this.status === "lost") ? this.endTime : now();
    return end - this.startTime;
  }

  /* snapshot for persistence of an in-progress game */
  snapshot() {
    return {
      width: this.width, height: this.height, mineCount: this.mineCount,
      state: Array.from(this.state), adjacency: Array.from(this.adjacency),
      notes: Array.from(this.notes),
      revealedCount: this.revealedCount, flagCount: this.flagCount,
      status: this.status, firstClickDone: this.firstClickDone, placed: this._placed,
      startTime: this.startTime, endTime: this.endTime, seed: this.seed,
      assisted: this.assisted, allowQuestion: this.allowQuestion,
      safeFirstClick: this.safeFirstClick, elapsedBefore: this.elapsedMs(),
    };
  }

  static fromSnapshot(snap) {
    const e = new Engine({
      width: snap.width, height: snap.height, mines: snap.mineCount,
      safeFirstClick: snap.safeFirstClick, allowQuestion: snap.allowQuestion,
      seed: snap.seed,
    });
    e.state = Uint8Array.from(snap.state);
    e.adjacency = Uint8Array.from(snap.adjacency);
    if (snap.notes) e.notes = Uint8Array.from(snap.notes);
    e.revealedCount = snap.revealedCount;
    e.flagCount = snap.flagCount;
    e.status = snap.status;
    e.firstClickDone = snap.firstClickDone;
    e._placed = !!snap.placed;
    e.assisted = snap.assisted;
    // rebase the clock so the displayed elapsed continues smoothly
    e.startTime = now() - (snap.elapsedBefore || 0);
    e.endTime = snap.endTime;
    return e;
  }
}

function clampInt(v, lo, hi) { v = Math.floor(Number(v) || 0); return Math.max(lo, Math.min(hi, v)); }
function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
