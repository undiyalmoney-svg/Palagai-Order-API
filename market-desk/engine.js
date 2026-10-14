'use strict';

const { ema, adx, vwap, round } = require('../research/indicators');
const { parts, minutesOfDay, OPEN_MIN, CLOSE_MIN, inSession, sessionDate, istDate } = require('../research/time');

const INTERVAL_MIN = {
  '5minute': 5,
  '15minute': 15,
  '60minute': 60,
  day: 1440,
};

function lastFinite(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return null;
}

function sessionStatus(now = new Date()) {
  const p = parts(now);
  const day = `${p.year}-${p.month}-${p.day}`;
  // Noon IST → UTC day-of-week, so the droplet's UTC clock cannot flip Saturday/Sunday.
  const weekday = new Date(`${day}T12:00:00+05:30`).getUTCDay();
  const mins = minutesOfDay(now);
  if (weekday === 0 || weekday === 6) {
    return { status: 'closed', label: 'Weekend', day, open: false };
  }
  if (mins < OPEN_MIN) return { status: 'pre', label: 'Pre-open', day, open: false };
  if (mins >= CLOSE_MIN) return { status: 'closed', label: 'Closed', day, open: false };
  return { status: 'open', label: 'Session open', day, open: true };
}

function candleEnd(candle, interval) {
  const start = new Date(candle.date).getTime();
  const mins = INTERVAL_MIN[interval] || 15;
  return start + mins * 60_000;
}

function sessionBucketStart(date, intervalMin) {
  const day = sessionDate(date);
  if (intervalMin >= 1440) return istDate(day, 9, 15);
  const mins = minutesOfDay(date);
  const aligned = OPEN_MIN + Math.floor(Math.max(0, mins - OPEN_MIN) / intervalMin) * intervalMin;
  return istDate(day, Math.floor(aligned / 60), aligned % 60);
}

/**
 * Rebuild timeframe bars from finer candles using NSE session alignment
 * (09:15 IST), never midnight.
 */
function aggregateSession(candles, intervalMin) {
  const buckets = new Map();
  for (const c of candles || []) {
    if (!Number.isFinite(c?.close)) continue;
    if (intervalMin < 1440 && !inSession(c.date)) continue;
    const start = sessionBucketStart(c.date, intervalMin);
    const key = start.toISOString();
    const prev = buckets.get(key);
    if (!prev) {
      buckets.set(key, {
        date: start.toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: Number(c.volume) || 0,
      });
    } else {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume += Number(c.volume) || 0;
    }
  }
  return [...buckets.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function splitForming(candles, interval, now = new Date()) {
  const rows = Array.isArray(candles) ? candles.filter((c) => Number.isFinite(c?.close)) : [];
  if (!rows.length) return { completed: [], forming: null };
  const last = rows[rows.length - 1];
  if (interval === 'day') {
    const lastDay = sessionDate(last.date);
    const today = sessionDate(now);
    const sess = sessionStatus(now);
    if (lastDay === today && sess.open) {
      return { completed: rows.slice(0, -1), forming: last };
    }
    return { completed: rows, forming: null };
  }
  const end = candleEnd(last, interval);
  if (Number.isFinite(end) && end > now.getTime()) {
    return { completed: rows.slice(0, -1), forming: last };
  }
  return { completed: rows, forming: null };
}

function sessionVwap(candles, now = new Date()) {
  const day = sessionDate(now);
  const today = (candles || []).filter((c) => sessionDate(c.date) === day && inSession(c.date));
  return vwap(today);
}

/**
 * Pivot high/low using `strength` bars on each side. Confirmed only when the
 * right-hand bars exist — never uses future candles.
 */
function swingPivots(candles, strength = 2) {
  const n = candles.length;
  const out = [];
  if (n < strength * 2 + 1) return out;
  for (let i = strength; i < n - strength; i += 1) {
    let high = true;
    let low = true;
    for (let k = 1; k <= strength; k += 1) {
      if (candles[i].high <= candles[i - k].high || candles[i].high <= candles[i + k].high) high = false;
      if (candles[i].low >= candles[i - k].low || candles[i].low >= candles[i + k].low) low = false;
    }
    if (high) out.push({ kind: 'high', index: i, price: candles[i].high, date: candles[i].date });
    if (low) out.push({ kind: 'low', index: i, price: candles[i].low, date: candles[i].date });
  }
  return out;
}

function structureScore(pivots) {
  const highs = pivots.filter((p) => p.kind === 'high');
  const lows = pivots.filter((p) => p.kind === 'low');
  if (highs.length < 2 || lows.length < 2) return { score: 0, label: 'unclear', hh: false, hl: false, lh: false, ll: false };
  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  const hh = h2.price > h1.price;
  const lh = h2.price < h1.price;
  const hl = l2.price > l1.price;
  const ll = l2.price < l1.price;
  if (hh && hl) return { score: 2, label: 'HH/HL', hh, hl, lh, ll };
  if (lh && ll) return { score: -2, label: 'LH/LL', hh, hl, lh, ll };
  return { score: 0, label: 'range', hh, hl, lh, ll };
}

function emaStackScore(close, emaFast, emaSlow) {
  if (![close, emaFast, emaSlow].every(Number.isFinite)) return { score: null, label: 'insufficient' };
  if (close > emaFast && emaFast > emaSlow) return { score: 1, label: 'stacked-up' };
  if (close < emaFast && emaFast < emaSlow) return { score: -1, label: 'stacked-down' };
  return { score: 0, label: 'mixed' };
}

function vwapScore(close, sessionVw) {
  if (!Number.isFinite(close) || !Number.isFinite(sessionVw)) return { score: null, label: 'unavailable' };
  if (close > sessionVw) return { score: 1, label: 'above' };
  if (close < sessionVw) return { score: -1, label: 'below' };
  return { score: 0, label: 'at' };
}

function classifyBias(score, missing) {
  if (missing) return { bias: 'insufficient', label: 'Insufficient data', confirmed: false };
  if (score >= 4) return { bias: 'bullish', label: 'Bullish', confirmed: true };
  if (score >= 1) return { bias: 'mild-bull', label: 'Mild bullish bias', confirmed: false };
  if (score <= -4) return { bias: 'bearish', label: 'Bearish', confirmed: true };
  if (score <= -1) return { bias: 'mild-bear', label: 'Mild bearish bias', confirmed: false };
  return { bias: 'mixed', label: 'Mixed', confirmed: false };
}

function adxStrength(adxVal, settings) {
  if (!Number.isFinite(adxVal)) return { strength: 'insufficient', label: 'Insufficient data', adx: null };
  if (adxVal >= settings.adxStrong) return { strength: 'strong', label: 'Strong', adx: round(adxVal, 1) };
  if (adxVal >= settings.adxWeak) return { strength: 'moderate', label: 'Moderate', adx: round(adxVal, 1) };
  return { strength: 'weak', label: 'Weak', adx: round(adxVal, 1) };
}

function localTrend(emaPack, structure) {
  if (emaPack.score == null) return 'insufficient';
  if (emaPack.score === 1 && structure.score >= 0) return 'bullish';
  if (emaPack.score === -1 && structure.score <= 0) return 'bearish';
  if (emaPack.score === 0 && structure.score === 0) return 'sideways';
  return 'mixed';
}

function mtfScore(t15, t60) {
  if (t15 === 'insufficient' || t60 === 'insufficient') return { score: 0, label: 'unavailable' };
  if (t15 === 'bullish' && t60 === 'bullish') return { score: 2, label: 'both-bullish' };
  if (t15 === 'bearish' && t60 === 'bearish') return { score: -2, label: 'both-bearish' };
  if ((t15 === 'bullish' && t60 === 'bearish') || (t15 === 'bearish' && t60 === 'bullish')) {
    return { score: 0, label: 'conflict' };
  }
  return { score: 0, label: 'mixed' };
}

function vwapCrossings(candles, sessionVw) {
  if (!Number.isFinite(sessionVw) || candles.length < 4) return 0;
  let crosses = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const a = candles[i - 1].close - sessionVw;
    const b = candles[i].close - sessionVw;
    if (a === 0 || b === 0) continue;
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) crosses += 1;
  }
  return crosses;
}

function detectSideways({ structure, emaPack, strength, close, emaFast, emaSlow, vwapCrosses }) {
  if (emaPack.score == null) return false;
  const flatMa =
    Number.isFinite(close) &&
    Number.isFinite(emaFast) &&
    Number.isFinite(emaSlow) &&
    close !== 0 &&
    Math.abs(emaFast - emaSlow) / close < 0.003;
  const weak = strength.strength === 'weak';
  const range = structure.score === 0;
  return range && weak && flatMa && vwapCrosses >= 2;
}

function analyzeTimeframe(candles, interval, settings, now = new Date()) {
  const { completed, forming } = splitForming(candles, interval, now);
  if (completed.length < settings.emaSlow + 2) {
    return {
      interval,
      trend: 'insufficient',
      score: null,
      missing: true,
      forming: Boolean(forming),
      bars: completed.length,
    };
  }
  const closes = completed.map((c) => c.close);
  const emaFastS = ema(closes, settings.emaFast);
  const emaSlowS = ema(closes, settings.emaSlow);
  const adxPack = adx(completed, settings.adxPeriod);
  const close = closes[closes.length - 1];
  const eFast = lastFinite(emaFastS);
  const eSlow = lastFinite(emaSlowS);
  const adxVal = lastFinite(adxPack.adx);
  const pivots = swingPivots(completed, settings.pivotStrength);
  const structure = structureScore(pivots);
  const emaPack = emaStackScore(close, eFast, eSlow);
  const sessionVw = interval === 'day' ? null : sessionVwap(completed, now);
  const vw = vwapScore(close, sessionVw);
  const strength = adxStrength(adxVal, settings);
  const trend = localTrend(emaPack, structure);
  const vwapCrosses = sessionVw == null ? 0 : vwapCrossings(completed.slice(-12), sessionVw);
  const sideways = detectSideways({
    structure,
    emaPack,
    strength,
    close,
    emaFast: eFast,
    emaSlow: eSlow,
    vwapCrosses,
  });
  return {
    interval,
    trend: sideways ? 'sideways' : trend,
    close: round(close, 2),
    emaFast: round(eFast, 2),
    emaSlow: round(eSlow, 2),
    vwap: round(sessionVw, 2),
    adx: strength.adx,
    strength: strength.strength,
    strengthLabel: strength.label,
    structure,
    emaPack,
    vwapPack: vw,
    pivots: pivots.slice(-6),
    forming: Boolean(forming),
    bars: completed.length,
    missing: false,
    lastCandleAt: completed[completed.length - 1].date,
  };
}

function combineScore(tf15, tf60, tfDay, settings) {
  const missing = !tf15 || tf15.missing || tf15.emaPack?.score == null;
  if (missing) {
    return { ...classifyBias(0, true), score: null, parts: {}, agreement: 'insufficient' };
  }
  const mtf = mtfScore(tf15.trend, tf60?.trend || 'insufficient');
  const vwapPart = tf15.vwapPack?.score == null ? 0 : tf15.vwapPack.score;
  const vwapMissing = tf15.vwapPack?.score == null;
  const score = (tf15.structure?.score || 0) + (tf15.emaPack?.score || 0) + vwapPart + mtf.score;
  const pack = classifyBias(score, false);
  if (tf15.trend === 'sideways' && pack.bias === 'mixed') {
    pack.bias = 'sideways';
    pack.label = 'Sideways';
  }
  let agreement = 'mixed';
  const day = tfDay?.trend;
  if (mtf.label === 'both-bullish' && (day === 'bullish' || !day || day === 'insufficient')) agreement = 'aligned-bull';
  else if (mtf.label === 'both-bearish' && (day === 'bearish' || !day || day === 'insufficient')) agreement = 'aligned-bear';
  else if (mtf.label === 'conflict') agreement = 'conflict';
  else if (mtf.label === 'both-bullish' || mtf.label === 'both-bearish') agreement = mtf.label;
  return {
    ...pack,
    score,
    confirmed: pack.confirmed && mtf.label !== 'conflict' && !vwapMissing,
    parts: {
      structure: tf15.structure?.score || 0,
      ema: tf15.emaPack?.score || 0,
      vwap: vwapMissing ? null : vwapPart,
      mtf: mtf.score,
    },
    mtf,
    agreement,
    dayTrend: day || 'insufficient',
    h1Trend: tf60?.trend || 'insufficient',
    m15Trend: tf15.trend,
  };
}

function levelsFromLookback(completed, lookback) {
  const window = completed.slice(-lookback);
  if (!window.length) return { resistance: null, support: null };
  return {
    resistance: Math.max(...window.map((c) => c.high)),
    support: Math.min(...window.map((c) => c.low)),
  };
}

function detectBreakout(candles, interval, settings, now = new Date()) {
  const { completed, forming } = splitForming(candles, interval, now);
  if (completed.length < Math.max(8, Math.floor(settings.srLookback / 2))) {
    return {
      status: 'insufficient',
      direction: null,
      level: null,
      close: null,
      closeTime: null,
      interval,
    };
  }
  const prior = completed.slice(0, -1);
  const last = completed[completed.length - 1];
  const { resistance, support } = levelsFromLookback(prior, settings.srLookback);
  const buf = (settings.breakoutBufferPct / 100) * last.close;
  const volOk = !settings.volumeFilter || prior.length < 5 || last.volume >= median(prior.slice(-10).map((c) => c.volume));
  let status = 'none';
  let direction = null;
  let level = null;

  const live = forming?.close;
  if (Number.isFinite(resistance) && last.close > resistance + buf && volOk) {
    status = 'confirmed';
    direction = 'bull';
    level = resistance;
  } else if (Number.isFinite(support) && last.close < support - buf && volOk) {
    status = 'confirmed';
    direction = 'bear';
    level = support;
  } else if (Number.isFinite(live) && Number.isFinite(resistance) && live > resistance) {
    status = 'potential';
    direction = 'bull';
    level = resistance;
  } else if (Number.isFinite(live) && Number.isFinite(support) && live < support) {
    status = 'potential';
    direction = 'bear';
    level = support;
  }

  if (status === 'confirmed' && settings.retestRequired && forming) {
    const dist = Math.abs(forming.close - level);
    if (dist <= buf * 4) status = 'retest';
  }

  if (status === 'confirmed' && prior.length) {
    const prev = prior[prior.length - 1];
    const prevBroke =
      (direction === 'bull' && prev.close > resistance + buf) ||
      (direction === 'bear' && prev.close < support - buf);
    if (prevBroke) {
      const backInside =
        (direction === 'bull' && last.close < resistance) ||
        (direction === 'bear' && last.close > support);
      if (backInside) status = 'failed';
    }
  }

  return {
    status,
    direction,
    level: round(level, 2),
    close: round(last.close, 2),
    closeTime: last.date,
    support: round(support, 2),
    resistance: round(resistance, 2),
    volumeOk: volOk,
    interval,
    forming: Boolean(forming),
  };
}

function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.floor(s.length / 2)];
}

function setupFrom(row, br15, br60, combined) {
  const br = br60?.status === 'confirmed' ? br60 : br15?.status === 'confirmed' ? br15 : br15?.status === 'potential' ? br15 : br60;
  if (!br || (br.status !== 'confirmed' && br.status !== 'potential' && br.status !== 'retest')) return null;
  const dir = br.direction === 'bull' ? 'long' : 'short';
  const level = br.level;
  if (!Number.isFinite(level) || !Number.isFinite(row.ltp)) return null;
  const buffer = Math.max(row.ltp * 0.0015, 0.05);
  const entry = br.direction === 'bull' ? level + buffer : level - buffer;
  const stop = br.direction === 'bull' ? (br.support ?? level - buffer * 6) : (br.resistance ?? level + buffer * 6);
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const target = br.direction === 'bull' ? entry + risk * 1.5 : entry - risk * 1.5;
  const rr = 1.5;
  return {
    symbol: row.symbol,
    name: row.name,
    direction: dir,
    timeframe: br.interval === '60minute' ? '1h' : '15m',
    status: br.status,
    level,
    support: br.support,
    resistance: br.resistance,
    entry: round(entry, 2),
    stop: round(stop, 2),
    target: round(target, 2),
    rr,
    trendAgreement: combined.agreement,
    invalidation: br.direction === 'bull' ? `Close back below ${round(level, 2)}` : `Close back above ${round(level, 2)}`,
    reason: `${br.status} ${dir} on ${br.interval} · score ${combined.score ?? 'n/a'} · ${combined.label}`,
  };
}

function formatIst(now = new Date()) {
  const p = parts(now);
  return `${p.hour.toString().padStart(2, '0')}:${p.minute.toString().padStart(2, '0')}:${p.second.toString().padStart(2, '0')} IST`;
}

function isAuthError(err) {
  const msg = String(err?.message || err || '');
  return /HTTP 401|HTTP 403|Incorrect `api_key`|Token is invalid|invalid.*token|expired/i.test(msg);
}

module.exports = {
  sessionStatus,
  splitForming,
  swingPivots,
  structureScore,
  emaStackScore,
  vwapScore,
  classifyBias,
  adxStrength,
  detectSideways,
  analyzeTimeframe,
  combineScore,
  detectBreakout,
  setupFrom,
  sessionVwap,
  mtfScore,
  localTrend,
  aggregateSession,
  sessionBucketStart,
  formatIst,
  isAuthError,
  INTERVAL_MIN,
};
