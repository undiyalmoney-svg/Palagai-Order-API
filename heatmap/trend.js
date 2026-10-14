'use strict';

const { ema, adx } = require('../research/indicators');

function round(n, dp = 2) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function lastFinite(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return null;
}

function bucketForChange(pct) {
  if (!Number.isFinite(pct)) return '1-to--1';
  if (pct > 3) return 'above-3';
  if (pct > 1) return '3-to-1';
  if (pct >= -1) return '1-to--1';
  if (pct >= -3) return '-1-to--3';
  return 'below--3';
}

/**
 * Strong trend = EMA20/EMA50 stacked with the close, plus ADX ≥ 25 or a 52-week
 * extreme. Missing dailies stay `reading` so the heatmap can still paint % tiles.
 */
function classifyTrend({ close, ema20, ema50, high52, low52, adx: adxVal } = {}) {
  if (![close, ema20, ema50].every(Number.isFinite)) {
    return { trend: 'reading', trendLabel: 'Reading', score: 0 };
  }
  const hi = Number.isFinite(high52) ? high52 : close;
  const lo = Number.isFinite(low52) ? low52 : close;
  const range = hi - lo;
  const pos52 = range > 0 ? (close - lo) / range : 0.5;
  const stackedUp = close > ema20 && ema20 > ema50;
  const stackedDown = close < ema20 && ema20 < ema50;
  const strongAdx = Number.isFinite(adxVal) && adxVal >= 25;
  const nearHigh = pos52 >= 0.72;
  const nearLow = pos52 <= 0.28;

  if (stackedUp && (strongAdx || nearHigh)) {
    return {
      trend: 'strong-up',
      trendLabel: 'Strong up',
      score: round(2 + (strongAdx ? 0.5 : 0) + (nearHigh ? 0.5 : 0), 2),
    };
  }
  if (stackedDown && (strongAdx || nearLow)) {
    return {
      trend: 'strong-down',
      trendLabel: 'Strong down',
      score: round(-2 - (strongAdx ? 0.5 : 0) - (nearLow ? 0.5 : 0), 2),
    };
  }
  if (stackedUp) return { trend: 'up', trendLabel: 'Up', score: 1 };
  if (stackedDown) return { trend: 'down', trendLabel: 'Down', score: -1 };
  return { trend: 'sideways', trendLabel: 'Sideways', score: 0 };
}

function trendFromDailies(candles, lastPrice) {
  const rows = Array.isArray(candles) ? candles.filter((c) => Number.isFinite(c?.close)) : [];
  if (!rows.length) {
    return {
      ...classifyTrend({}),
      ema20: null,
      ema50: null,
      adx: null,
      high52: null,
      low52: null,
    };
  }
  const window = rows.slice(-252);
  const closes = window.map((c) => c.close);
  if (Number.isFinite(lastPrice) && closes.length) closes[closes.length - 1] = lastPrice;
  const ema20s = ema(closes, 20);
  const ema50s = ema(closes, 50);
  const adxPack = adx(window, 14);
  const highs = window.map((c) => c.high).filter(Number.isFinite);
  const lows = window.map((c) => c.low).filter(Number.isFinite);
  const close = Number.isFinite(lastPrice) ? lastPrice : closes[closes.length - 1];
  const high52 = highs.length ? Math.max(...highs) : null;
  const low52 = lows.length ? Math.min(...lows) : null;
  const pack = classifyTrend({
    close,
    ema20: lastFinite(ema20s),
    ema50: lastFinite(ema50s),
    high52,
    low52,
    adx: lastFinite(adxPack.adx),
  });
  return {
    ...pack,
    ema20: round(lastFinite(ema20s), 2),
    ema50: round(lastFinite(ema50s), 2),
    adx: round(lastFinite(adxPack.adx), 1),
    high52: round(high52, 2),
    low52: round(low52, 2),
  };
}

function breadth(companies) {
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  for (const row of companies) {
    const pct = row.changePct;
    if (!Number.isFinite(pct)) continue;
    if (pct > 0) advances += 1;
    else if (pct < 0) declines += 1;
    else unchanged += 1;
  }
  return { advances, declines, unchanged };
}

function trendCounts(companies) {
  const counts = {
    'strong-up': 0,
    up: 0,
    sideways: 0,
    down: 0,
    'strong-down': 0,
    reading: 0,
  };
  for (const row of companies) {
    const key = counts[row.trend] != null ? row.trend : 'reading';
    counts[key] += 1;
  }
  return counts;
}

module.exports = {
  round,
  bucketForChange,
  classifyTrend,
  trendFromDailies,
  breadth,
  trendCounts,
};
