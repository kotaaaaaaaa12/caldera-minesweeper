import { t } from "./i18n.js";
/* ============================================================
   timer.js — drift-free 1Hz ticker driven by the engine clock.
   The engine owns elapsed time; this just polls + renders it,
   and pauses repainting when the tab is hidden.
   ============================================================ */

export class Timer {
  constructor(onTick) {
    this.onTick = onTick;
    this._id = null;
    this._getMs = () => 0;
    this._onVis = () => {
      if (document.hidden) this._stopInterval();
      else if (this._running) this._startInterval();
    };
    document.addEventListener("visibilitychange", this._onVis);
  }

  start(getMs) {
    this._getMs = getMs;
    this._running = true;
    this.onTick(this._getMs());
    this._startInterval();
  }

  _startInterval() {
    this._stopInterval();
    this._id = setInterval(() => this.onTick(this._getMs()), 250);
  }

  _stopInterval() {
    if (this._id != null) { clearInterval(this._id); this._id = null; }
  }

  stop() {
    this._running = false;
    this._stopInterval();
    this.onTick(this._getMs());
  }

  reset() {
    this._running = false;
    this._stopInterval();
    this.onTick(0);
  }
}

export function formatClock(ms) {
  const secs = Math.floor(ms / 1000);
  if (secs < 1000) return String(secs).padStart(3, "0");
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatTime(ms) {
  const secs = ms / 1000;
  if (secs < 60) return t("time.seconds", { seconds: secs.toFixed(1) });
  const rounded = Math.round(secs);
  return t("time.minutesSeconds", { minutes: Math.floor(rounded / 60), seconds: rounded % 60 });
}
