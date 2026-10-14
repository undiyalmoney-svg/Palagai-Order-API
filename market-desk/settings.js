'use strict';

const DEFAULTS = {
  emaFast: 20,
  emaSlow: 50,
  adxPeriod: 14,
  adxWeak: 18,
  adxStrong: 25,
  pivotStrength: 2,
  srLookback: 20,
  breakoutBufferPct: 0.08,
  volumeFilter: false,
  retestRequired: false,
  cooldownBars: 4,
  uiRefreshMs: 5_000,
  alertCooldownMs: 120_000,
};

function clamp(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

function normalizeSettings(raw = {}) {
  return {
    emaFast: clamp(raw.emaFast, 5, 50, DEFAULTS.emaFast),
    emaSlow: clamp(raw.emaSlow, 10, 200, DEFAULTS.emaSlow),
    adxPeriod: clamp(raw.adxPeriod, 7, 28, DEFAULTS.adxPeriod),
    adxWeak: clamp(raw.adxWeak, 10, 30, DEFAULTS.adxWeak),
    adxStrong: clamp(raw.adxStrong, 20, 40, DEFAULTS.adxStrong),
    pivotStrength: clamp(raw.pivotStrength, 1, 5, DEFAULTS.pivotStrength),
    srLookback: clamp(raw.srLookback, 8, 80, DEFAULTS.srLookback),
    breakoutBufferPct: clamp(raw.breakoutBufferPct, 0, 1, DEFAULTS.breakoutBufferPct),
    volumeFilter: raw.volumeFilter === true,
    retestRequired: raw.retestRequired === true,
    cooldownBars: clamp(raw.cooldownBars, 1, 20, DEFAULTS.cooldownBars),
    uiRefreshMs: clamp(raw.uiRefreshMs, 1_000, 60_000, DEFAULTS.uiRefreshMs),
    alertCooldownMs: clamp(raw.alertCooldownMs, 30_000, 600_000, DEFAULTS.alertCooldownMs),
  };
}

module.exports = { DEFAULTS, normalizeSettings };
