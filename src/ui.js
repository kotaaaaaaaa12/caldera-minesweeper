/* ============================================================
   ui.js — chrome: HUD, difficulty control, dialogs, theme,
   result overlay, best-time badge. Pure view + event wiring;
   game state lives in the engine (see main.js).
   ============================================================ */

import { formatClock, formatTime } from "./timer.js";
import { ACHIEVEMENTS } from "./achievements.js";
import { dailyDiffKey } from "./daily.js";

export const DIFFICULTIES = {
  beginner:     { w: 9,  h: 9,  m: 10, label: "Beginner" },
  intermediate: { w: 16, h: 16, m: 40, label: "Intermediate" },
  expert:       { w: 30, h: 16, m: 99, label: "Expert" },
};

const FACES = { idle: "🙂", playing: "🙂", surprise: "😮", won: "😎", lost: "😵" };

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class UI {
  constructor() {
    this.el = {
      mineCount: $("mine-count"),
      timer: $("timer"),
      mineReadout: $("mine-readout"),
      timerReadout: $("timer-readout"),
      face: $("btn-reset"),
      faceGlyph: $("btn-reset").querySelector(".face-glyph"),
      segs: [...document.querySelectorAll(".seg")],
      segThumb: document.querySelector(".seg-thumb"),
      segmented: document.querySelector(".segmented"),
      flagMode: $("btn-flag-mode"),
      hint: $("btn-hint"),
      undo: $("btn-undo"),
      theme: $("btn-theme"),
      settingsBtn: $("btn-settings"),
      statsBtn: $("btn-stats"),
      lbBtn: $("btn-leaderboard"),
      dailyBtn: $("btn-daily"),
      bestTime: $("best-time"),
      modeBadge: $("mode-badge"),
      // zoom
      zoomIn: $("btn-zoom-in"),
      zoomOut: $("btn-zoom-out"),
      zoomLabel: $("zoom-label"),
      // transient toasts
      toasts: $("toasts"),
      // leaderboard dialog
      lbDlg: $("leaderboard-dialog"),
      lbSegs: [...document.querySelectorAll(".lb-seg")],
      lbList: $("lb-list"),
      lbClose: $("lb-close"),
      // overlay
      overlay: $("overlay"),
      ovEmoji: $("overlay-emoji"),
      ovTitle: $("overlay-title"),
      ovSub: $("overlay-sub"),
      ovBest: $("overlay-best"),
      ovAgain: $("overlay-again"),
      ovDismiss: $("overlay-dismiss"),
      ovRank: $("overlay-rank"),
      ovMetrics: $("overlay-metrics"),
      ovShare: $("overlay-share"),
      ovReplay: $("overlay-replay"),
      ovLb: $("overlay-lb"),
      ovName: $("overlay-name"),
      ovSubmit: $("overlay-submit"),
      // custom dialog
      customDlg: $("custom-dialog"),
      inpW: $("inp-width"), outW: $("out-width"),
      inpH: $("inp-height"), outH: $("out-height"),
      inpM: $("inp-mines"), outM: $("out-mines"),
      densFill: $("density-fill"), densPct: $("density-pct"), densNote: $("density-note"),
      // stats dialog
      statsDlg: $("stats-dialog"), statsContent: $("stats-content"),
      statsReset: $("stats-reset"), statsClose: $("stats-close"),
      // settings dialog
      setDlg: $("settings-dialog"),
      setName: $("set-name"),
      setPalette: $("set-palette"), setQuestion: $("set-question"),
      setChord: $("set-chord"), setSafe: $("set-safe"),
      setAnim: $("set-anim"), setHaptics: $("set-haptics"),
      setSound: $("set-sound"), setNoGuess: $("set-noguess"), setContrast: $("set-contrast"),
      setClose: $("settings-close"),
    };
    this._cb = {};
    this.safeFirstClick = true; // mirrors the setting; bounds custom mine count
  }

  _mineCeiling(w, h) {
    return Math.max(1, w * h - (this.safeFirstClick ? 9 : 1));
  }

  bind(callbacks) {
    this._cb = callbacks;
    const e = this.el;

    e.face.addEventListener("click", () => this._cb.onRestart && this._cb.onRestart());

    e.segs.forEach((seg) => seg.addEventListener("click", () => {
      const diff = seg.dataset.diff;
      if (diff === "custom") this.openCustom();
      else this._cb.onDifficulty && this._cb.onDifficulty(diff);
    }));

    e.flagMode.addEventListener("click", () => {
      const next = e.flagMode.getAttribute("aria-pressed") !== "true";
      e.flagMode.setAttribute("aria-pressed", String(next));
      this._cb.onSetting && this._cb.onSetting("flagMode", next);
    });

    e.hint.addEventListener("click", () => this._cb.onHint && this._cb.onHint());
    if (e.undo) e.undo.addEventListener("click", () => this._cb.onUndo && this._cb.onUndo());
    if (e.dailyBtn) e.dailyBtn.addEventListener("click", () => this._cb.onDaily && this._cb.onDaily());
    e.theme.addEventListener("click", () => this._cb.onThemeToggle && this._cb.onThemeToggle());
    e.settingsBtn.addEventListener("click", () => this.openSettings());
    e.statsBtn.addEventListener("click", () => this._cb.onOpenStats && this._cb.onOpenStats());

    if (e.zoomIn) e.zoomIn.addEventListener("click", () => this._cb.onZoomIn && this._cb.onZoomIn());
    if (e.zoomOut) e.zoomOut.addEventListener("click", () => this._cb.onZoomOut && this._cb.onZoomOut());
    if (e.zoomLabel) e.zoomLabel.addEventListener("click", () => this._cb.onZoomReset && this._cb.onZoomReset());

    e.ovAgain.addEventListener("click", () => { this.hideResult(); this._cb.onRestart && this._cb.onRestart(); });
    e.ovDismiss.addEventListener("click", () => this.hideResult());
    if (e.ovShare) e.ovShare.addEventListener("click", () => this._cb.onShare && this._cb.onShare());
    if (e.ovReplay) e.ovReplay.addEventListener("click", () => { this.hideResult(); this._cb.onReplay && this._cb.onReplay(); });

    // leaderboard
    e.lbBtn.addEventListener("click", () => this._cb.onOpenLeaderboard && this._cb.onOpenLeaderboard());
    e.lbClose.addEventListener("click", () => e.lbDlg.close());
    e.lbSegs.forEach((seg) => seg.addEventListener("click", () => {
      const diff = seg.dataset.lbdiff === "daily" ? dailyDiffKey() : seg.dataset.lbdiff;
      this.setLbActive(diff);
      this._cb.onLbDifficulty && this._cb.onLbDifficulty(diff);
    }));
    e.ovLb.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this._cb.onSubmitScore && this._cb.onSubmitScore(e.ovName.value);
    });
    e.setName.addEventListener("change", () => this._cb.onSetting && this._cb.onSetting("name", e.setName.value.trim()));

    // custom dialog: live density + submit
    const syncCustom = () => this._syncCustom();
    [e.inpW, e.inpH, e.inpM].forEach((inp) => inp.addEventListener("input", syncCustom));
    e.customDlg.addEventListener("close", () => {
      if (e.customDlg.returnValue === "start") {
        const cfg = {
          w: +e.inpW.value, h: +e.inpH.value,
          m: Math.min(+e.inpM.value, this._mineCeiling(+e.inpW.value, +e.inpH.value)),
        };
        this._cb.onCustom && this._cb.onCustom(cfg);
      }
    });

    // stats dialog
    e.statsClose.addEventListener("click", () => e.statsDlg.close());
    e.statsReset.addEventListener("click", () => this._cb.onResetStats && this._cb.onResetStats());

    // settings dialog
    const setMap = {
      setPalette: "palette", setQuestion: "question", setChord: "chord",
      setSafe: "safeFirstClick", setAnim: "animations", setHaptics: "haptics",
      setSound: "sound", setNoGuess: "noGuess", setContrast: "contrast",
    };
    Object.entries(setMap).forEach(([refKey, settingKey]) => {
      const node = e[refKey];
      node.addEventListener("change", () => {
        const val = node.type === "checkbox" ? node.checked : node.value;
        this._cb.onSetting && this._cb.onSetting(settingKey, val);
      });
    });
    e.setClose.addEventListener("click", () => e.setDlg.close());

    window.addEventListener("resize", () => this.moveSegThumb());
  }

  /* ---------- HUD ---------- */
  setMineCount(n) {
    const v = Math.max(-99, Math.min(999, n));
    const str = (v < 0 ? "-" : "") + String(Math.abs(v)).padStart(v < 0 ? 2 : 3, "0");
    this.el.mineCount.textContent = str;
    this.el.mineReadout.classList.toggle("danger", n <= 0);
  }

  setTimer(ms) { this.el.timer.textContent = formatClock(ms); }

  setFace(state) {
    this.el.face.dataset.face = state;
    this.el.faceGlyph.textContent = FACES[state] || FACES.idle;
  }

  pulseTimer() {
    this.el.timer.classList.remove("pulse");
    void this.el.timer.offsetWidth;
    this.el.timer.classList.add("pulse");
    this.el.timerReadout.classList.add("record");
  }
  clearTimerRecord() { this.el.timerReadout.classList.remove("record"); this.el.timer.classList.remove("pulse"); }

  setActiveDifficulty(diff) {
    this.el.segs.forEach((s) => s.setAttribute("aria-pressed", String(s.dataset.diff === diff)));
    this.moveSegThumb();
  }

  moveSegThumb() {
    if (!this.el.segThumb) return;
    const active = this.el.segs.find((s) => s.getAttribute("aria-pressed") === "true");
    // no preset active (e.g. Daily mode) → retract the thumb
    this.el.segThumb.style.opacity = active ? "1" : "0";
    const ref = active || this.el.segs[0];
    if (!ref) return;
    this.el.segThumb.style.width = ref.offsetWidth + "px";
    this.el.segThumb.style.transform = `translateX(${ref.offsetLeft - 4}px)`;
  }

  setBest(ms) {
    this.el.bestTime.textContent = ms == null ? "—" : formatTime(ms);
  }

  /* ---------- undo / mode badge / zoom ---------- */
  setUndo(enabled) {
    const u = this.el.undo;
    if (!u) return;
    u.disabled = !enabled;
    u.setAttribute("aria-disabled", String(!enabled));
  }

  setModeBadge(run) {
    const b = this.el.modeBadge;
    if (!b) return;
    const tags = [];
    if (run.daily) tags.push("📅 Daily");
    if (run.noGuess) tags.push("🧠 No-guess");
    b.innerHTML = tags.map((t) => `<span class="mode-tag">${t}</span>`).join("");
    b.classList.toggle("hidden", tags.length === 0);
  }

  setZoomLabel(zoom) {
    if (this.el.zoomLabel) this.el.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  /* ---------- transient toasts ---------- */
  toast(icon, label, sub) {
    const host = this.el.toasts;
    if (!host) return;
    const node = document.createElement("div");
    node.className = "toast";
    node.innerHTML = `<span class="toast-ico">${icon}</span>
      <span class="toast-text"><strong>${escapeHtml(label)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</span>`;
    host.appendChild(node);
    requestAnimationFrame(() => node.classList.add("in"));
    setTimeout(() => {
      node.classList.remove("in");
      setTimeout(() => node.remove(), 320);
    }, 3200);
  }
  toastAchievements(list) {
    list.forEach((a, i) => setTimeout(() => this.toast(a.icon, `Achievement: ${a.label}`, a.desc), i * 400));
  }
  flashShare(msg) { this.toast("📋", msg); }

  /* ---------- result overlay ---------- */
  showResult({ won, timeMs, isBest, metrics }) {
    const e = this.el;
    e.ovEmoji.textContent = won ? "🎉" : "💥";
    e.ovTitle.textContent = won ? "You win!" : "Boom.";
    e.ovSub.textContent = won ? `Cleared in ${formatTime(timeMs)}` : "You hit a mine.";
    e.ovBest.classList.toggle("hidden", !(won && isBest));
    e.ovRank.classList.add("hidden");
    e.ovLb.classList.add("hidden");
    if (e.ovMetrics) {
      if (won && metrics && metrics.threeBV) {
        const bits = [`3BV ${metrics.threeBV}`];
        if (metrics.threeBVps != null) bits.push(`${metrics.threeBVps.toFixed(2)}/s`);
        if (metrics.efficiency != null) bits.push(`${Math.round(metrics.efficiency * 100)}% eff`);
        e.ovMetrics.textContent = bits.join("  ·  ");
        e.ovMetrics.classList.remove("hidden");
      } else {
        e.ovMetrics.classList.add("hidden");
      }
    }
    this._prevFocus = document.activeElement;
    e.overlay.classList.remove("hidden");
    // move focus into the result card so keyboard/SR users land on the action
    requestAnimationFrame(() => e.ovAgain.focus());
  }

  /** show the inline name-entry form in the win overlay */
  showOverlaySubmit(prefill = "") {
    const e = this.el;
    e.ovName.value = prefill;
    e.ovLb.classList.remove("hidden");
    requestAnimationFrame(() => e.ovName.focus());
  }
  /** replace the submit form with a rank confirmation */
  setOverlayRank(text) {
    const e = this.el;
    e.ovLb.classList.add("hidden");
    e.ovRank.textContent = text;
    e.ovRank.classList.remove("hidden");
  }

  /* ---------- leaderboard dialog ---------- */
  openLeaderboard(diff) {
    this.setLbActive(diff);
    this.renderLeaderboardLoading();
    this.el.lbDlg.showModal();
  }
  setLbActive(diff) {
    this.el.lbSegs.forEach((s) => s.setAttribute("aria-pressed", String(s.dataset.lbdiff === (diff.startsWith("daily-") ? "daily" : diff))));
  }
  renderLeaderboardLoading() {
    this.el.lbList.innerHTML = `<div class="lb-empty">Loading…</div>`;
  }
  renderLeaderboard({ rows, offline, error }) {
    const el = this.el.lbList;
    if (offline) {
      el.innerHTML = `<div class="lb-empty">Online leaderboard is unavailable.<br>Your local records are still saved on this device.</div>`;
      return;
    }
    if (error) { el.innerHTML = `<div class="lb-empty">Couldn't load scores.<br>${escapeHtml(error)}</div>`; return; }
    if (!rows || !rows.length) { el.innerHTML = `<div class="lb-empty">No scores yet — be the first!</div>`; return; }
    el.innerHTML = rows.map((r, i) => `
      <div class="lb-row${i < 3 ? " podium" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="who">${escapeHtml(r.name)}</span>
        <span class="when">${formatTime(r.time_ms)}</span>
      </div>`).join("");
  }
  hideResult() {
    this.el.overlay.classList.add("hidden");
    const prev = this._prevFocus;
    this._prevFocus = null;
    if (prev && prev.focus) prev.focus();
    else this.el.face.focus();
  }

  /* ---------- custom dialog ---------- */
  openCustom(initial) {
    const e = this.el;
    if (initial) { e.inpW.value = initial.w; e.inpH.value = initial.h; e.inpM.value = initial.m; }
    this._syncCustom();
    e.customDlg.showModal();
  }
  _syncCustom() {
    const e = this.el;
    const w = +e.inpW.value, h = +e.inpH.value;
    const maxMines = this._mineCeiling(w, h);
    e.inpM.max = maxMines;
    if (+e.inpM.value > maxMines) e.inpM.value = maxMines;
    const m = +e.inpM.value;
    e.outW.textContent = w; e.outH.textContent = h; e.outM.textContent = m;
    const pct = Math.round((m / (w * h)) * 100);
    e.densFill.style.width = Math.min(100, pct) + "%";
    e.densPct.textContent = pct + "%";
    e.densNote.textContent = pct < 12 ? "easy" : pct < 18 ? "comfortable" : pct < 25 ? "tricky" : "brutal";
  }

  /* ---------- stats dialog ---------- */
  openStats(statsData, unlocked) {
    const e = this.el;
    if (unlocked) this._unlocked = unlocked;
    const rows = [];
    for (const [key, d] of Object.entries(DIFFICULTIES)) {
      const best = statsData.best[key];
      const games = statsData.games[key] || 0;
      const wins = statsData.wins[key] || 0;
      const rate = games ? Math.round((wins / games) * 100) : 0;
      rows.push(`<div class="stat-row">
        <span class="name">${d.label}</span>
        <span class="best">${best != null ? formatTime(best) : "—"}</span>
        <span class="meta">${wins}/${games} · ${rate}%</span>
      </div>`);
    }
    e.statsContent.innerHTML = rows.join("") +
      `<div class="stat-summary">Current streak: ${statsData.streak || 0} · Best streak: ${statsData.bestStreak || 0}</div>` +
      this._achievementsHtml(this._unlocked || new Set());
    e.statsDlg.showModal();
  }
  _achievementsHtml(unlocked) {
    if (!ACHIEVEMENTS.length) return "";
    const cells = ACHIEVEMENTS.map((a) => {
      const got = unlocked.has(a.id);
      return `<div class="ach ${got ? "got" : "locked"}" title="${escapeHtml(a.desc)}">
        <span class="ach-ico">${a.icon}</span>
        <span class="ach-label">${escapeHtml(a.label)}</span>
      </div>`;
    }).join("");
    const n = [...unlocked].filter((id) => ACHIEVEMENTS.some((a) => a.id === id)).length;
    return `<div class="ach-head">Achievements <span>${n}/${ACHIEVEMENTS.length}</span></div>
      <div class="ach-grid">${cells}</div>`;
  }
  refreshStats(statsData) { if (this.el.statsDlg.open) this.openStats(statsData, this._unlocked); }

  /* ---------- settings dialog ---------- */
  openSettings() { this.el.setDlg.showModal(); }
  reflectSettings(s) {
    const e = this.el;
    this.safeFirstClick = s.safeFirstClick;
    e.setName.value = s.name || "";
    e.setPalette.value = s.palette;
    e.setQuestion.checked = s.question;
    e.setChord.checked = s.chord;
    e.setSafe.checked = s.safeFirstClick;
    e.setAnim.checked = s.animations;
    e.setHaptics.checked = s.haptics;
    if (e.setSound) e.setSound.checked = s.sound;
    if (e.setNoGuess) e.setNoGuess.checked = s.noGuess;
    if (e.setContrast) e.setContrast.checked = s.contrast;
    e.flagMode.setAttribute("aria-pressed", String(s.flagMode));
  }
}
