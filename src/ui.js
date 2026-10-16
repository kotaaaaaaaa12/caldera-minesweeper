import { t, applyTranslations, difficultyLabel, languagePreference } from "./i18n.js";
/* ============================================================
   ui.js — chrome: HUD, difficulty control, dialogs, theme,
   result overlay, best-time badge. Pure view + event wiring;
   game state lives in the engine (see main.js).
   ============================================================ */

import { formatClock, formatTime } from "./timer.js";
import { ACHIEVEMENTS } from "./achievements.js";
import { dailyDiffKey } from "./daily.js";

export const DIFFICULTIES = {
  beginner:     { w: 9,  h: 9,  m: 10, get label() { return t("difficulty.beginner"); } },
  intermediate: { w: 16, h: 16, m: 40, get label() { return t("difficulty.intermediate"); } },
  expert:       { w: 30, h: 16, m: 99, get label() { return t("difficulty.expert"); } },
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
      segs: [...document.querySelectorAll("[data-diff]")],
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
      setLanguage: $("set-language"),
      setPalette: $("set-palette"), setQuestion: $("set-question"),
      setChord: $("set-chord"), setSafe: $("set-safe"),
      setAnim: $("set-anim"), setHaptics: $("set-haptics"),
      setSound: $("set-sound"), setNoGuess: $("set-noguess"), setContrast: $("set-contrast"),
      setClose: $("settings-close"),
    };
    this._cb = {};
    this.safeFirstClick = true; // mirrors the setting; bounds custom mine count
  }

  openDialog(dialog) {
    if (dialog.open) return;
    dialog.showModal();
    dialog.querySelector('[data-panel-title]')?.focus({ preventScroll: true });
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
      setLanguage: "language", setPalette: "palette", setQuestion: "question", setChord: "chord",
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
    this._modeRun = run;
    if (run.daily) tags.push("📅 " + t("difficulty.daily"));
    if (run.noGuess) tags.push("🧠 " + t("game.noGuess"));
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
    node._translateToast = () => {
      const title = typeof label === 'function' ? label() : label;
      const description = typeof sub === 'function' ? sub() : sub;
      node.innerHTML = `<span class="toast-ico">${icon}</span>
        <span class="toast-text"><strong>${escapeHtml(title)}</strong>${description ? `<span>${escapeHtml(description)}</span>` : ""}</span>`;
    };
    node._translateToast();
    host.appendChild(node);
    requestAnimationFrame(() => node.classList.add("in"));
    setTimeout(() => {
      node.classList.remove("in");
      setTimeout(() => node.remove(), 320);
    }, 3200);
  }
  toastAchievements(list) {
    list.forEach((a, i) => setTimeout(() => this.toast(a.icon, () => t("achievements.unlocked", { name: a.label }), () => a.desc), i * 400));
  }
  flashShare(key) { this.toast("📋", () => t(key)); }

  /* ---------- result overlay ---------- */
  showResult({ won, timeMs, isBest, metrics }) {
    const e = this.el;
    e.ovEmoji.textContent = won ? "🎉" : "💥";
    this._result = { won, timeMs, isBest, metrics };
    this._rank = null;
    this.renderResultText();
    e.ovBest.classList.toggle("hidden", !(won && isBest));
    e.ovRank.classList.add("hidden");
    e.ovLb.classList.add("hidden");
    this._prevFocus = document.activeElement;
    e.overlay.classList.remove("hidden");
    // Keep the result announced without selecting a button or opening a keyboard.
    e.ovTitle.focus({ preventScroll: true });
  }

  renderResultText() {
    if (!this._result) return;
    const { won, timeMs, metrics } = this._result;
    const e = this.el;
    e.ovTitle.textContent = t(won ? 'game.won' : 'game.lost');
    e.ovSub.textContent = won ? t('game.cleared', { time: formatTime(timeMs) }) : t('game.hitMine');
    if (e.ovMetrics) {
      if (won && metrics && metrics.threeBV) {
        const bits = [`3BV ${metrics.threeBV}`];
        if (metrics.threeBVps != null) bits.push(t("metric.speed", { value: metrics.threeBVps.toFixed(2) }));
        if (metrics.efficiency != null) bits.push(t("metric.efficiency", { value: Math.round(metrics.efficiency * 100) }));
        e.ovMetrics.textContent = bits.join("  ·  ");
        e.ovMetrics.classList.remove("hidden");
      } else {
        e.ovMetrics.classList.add("hidden");
      }
    }
  }

  refreshLanguage() {
    applyTranslations();
    this.el.setLanguage.value = languagePreference();
    if (this._modeRun) this.setModeBadge(this._modeRun);
    this.renderResultText();
    this.el.toasts.querySelectorAll(".toast").forEach(node => node._translateToast?.());
    if (this._rank) this.renderRankText();
    if (this._leaderboardData) this.renderLeaderboard(this._leaderboardData);
    else if (this._leaderboardLoading) this.renderLeaderboardLoading();
    this._syncCustom();
    this.moveSegThumb();
  }

  /** show the inline name-entry form in the win overlay */
  showOverlaySubmit(prefill = "") {
    const e = this.el;
    e.ovName.value = prefill;
    e.ovLb.classList.remove("hidden");

  }
  /** replace the submit form with a rank confirmation */
  setOverlayRank(key, values = {}) {
    this._rank = { key, values };
    const e = this.el;
    e.ovLb.classList.add("hidden");
    this.renderRankText();
    e.ovRank.classList.remove("hidden");
  }

  renderRankText() {
    const { key, values } = this._rank;
    const translated = { ...values };
    if (translated.difficulty) translated.difficulty = difficultyLabel(translated.difficulty);
    if (translated.bestTimeMs != null) translated.time = formatTime(translated.bestTimeMs);
    this.el.ovRank.textContent = t(key, translated);
  }

  /* ---------- leaderboard dialog ---------- */
  openLeaderboard(diff) {
    this.setLbActive(diff);
    this.renderLeaderboardLoading();
    this.openDialog(this.el.lbDlg);
  }
  setLbActive(diff) {
    this.el.lbSegs.forEach((s) => s.setAttribute("aria-pressed", String(s.dataset.lbdiff === (diff.startsWith("daily-") ? "daily" : diff))));
  }
  renderLeaderboardLoading() {
    this._leaderboardLoading = true;
    this._leaderboardData = null;
    this.el.lbList.innerHTML = `<div class="lb-empty">${t("leaderboard.loading")}</div>`;
  }
  renderLeaderboard(data) {
    this._leaderboardData = data;
    this._leaderboardLoading = false;
    const { rows, offline, error, errorKey } = data;
    const el = this.el.lbList;
    if (offline) {
      el.innerHTML = `<div class="lb-empty">${t("leaderboard.offline")}</div>`;
      return;
    }
    if (error) { el.innerHTML = `<div class="lb-empty">${t("leaderboard.loadError")}<br>${escapeHtml(t(errorKey || "error.unavailable"))}</div>`; return; }
    if (!rows || !rows.length) { el.innerHTML = `<div class="lb-empty">${t("leaderboard.empty")}</div>`; return; }
    el.innerHTML = rows.map((r, i) => `
      <div class="lb-row${i < 3 ? " podium" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="who">${escapeHtml(r.name === "Anonymous" ? t("ui.anonymous") : r.name)}</span>
        <span class="when">${formatTime(r.time_ms)}</span>
      </div>`).join("");
  }
  hideResult() {
    this.el.overlay.classList.add("hidden");
    const prev = this._prevFocus;
    this._prevFocus = null;
    if (document.documentElement.dataset.input === 'keyboard') {
      if (prev?.isConnected && prev.focus) prev.focus({ preventScroll: true });
      else this.el.face.focus({ preventScroll: true });
    } else if (this.el.overlay.contains(document.activeElement)) document.activeElement.blur();
  }

  /* ---------- custom dialog ---------- */
  openCustom(initial) {
    const e = this.el;
    if (initial) { e.inpW.value = initial.w; e.inpH.value = initial.h; e.inpM.value = initial.m; }
    this._syncCustom();
    this.openDialog(e.customDlg);
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
    e.densNote.textContent = t(pct < 12 ? "density.easy" : pct < 18 ? "density.comfortable" : pct < 25 ? "density.tricky" : "density.brutal");
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
      `<div class="stat-summary">${t("stats.streak", { current: statsData.streak || 0, best: statsData.bestStreak || 0 })}</div>` +
      this._achievementsHtml(this._unlocked || new Set());
    if (!e.statsDlg.open) this.openDialog(e.statsDlg);
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
    return `<div class="ach-head">${t("achievements.title")} <span>${n}/${ACHIEVEMENTS.length}</span></div>
      <div class="ach-grid">${cells}</div>`;
  }
  refreshStats(statsData) { if (this.el.statsDlg.open) this.openStats(statsData, this._unlocked); }

  /* ---------- settings dialog ---------- */
  openSettings() { this.openDialog(this.el.setDlg); }
  reflectSettings(s) {
    const e = this.el;
    this.safeFirstClick = s.safeFirstClick;
    e.setLanguage.value = s.language || "auto";
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
