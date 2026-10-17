'use strict';

/**
 * Market Behaviour Engine.
 * Deterministic rules on completed candles. Forming bars stay provisional.
 * This is an explanation layer on top of engine.js — not a neural predictor.
 */

const { rsi, atr, ema, adx, round } = require('../research/indicators');
const {
  splitForming,
  swingPivots,
  structureScore,
  analyzeTimeframe,
  detectBreakout,
  INTERVAL_MIN,
} = require('./engine');

const TF_KEYS = {
  '5minute': 'm5',
  '15minute': 'm15',
  '60minute': 'h1',
  day: 'day',
};

const TF_LABEL = {
  '5minute': '5-minute',
  '15minute': '15-minute',
  '60minute': '1-hour',
  day: 'Daily',
};

function lastFinite(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return null;
}

function valueAt(arr, offsetFromEnd) {
  if (!Array.isArray(arr) || arr.length <= offsetFromEnd) return null;
  const v = arr[arr.length - 1 - offsetFromEnd];
  return Number.isFinite(v) ? v : null;
}

function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.floor(s.length / 2)];
}

function describeStructure(pivots, close, atrVal) {
  const base = structureScore(pivots);
  const highs = pivots.filter((p) => p.kind === 'high');
  const lows = pivots.filter((p) => p.kind === 'low');
  const lastHigh = highs.at(-1) || null;
  const lastLow = lows.at(-1) || null;
  const prevHigh = highs.at(-2) || null;
  const prevLow = lows.at(-2) || null;
  const buf = Number.isFinite(atrVal) ? atrVal * 0.15 : 0;
  let bos = null;
  let choch = null;
  if (Number.isFinite(close) && lastHigh && close > lastHigh.price + buf) bos = 'bull';
  if (Number.isFinite(close) && lastLow && close < lastLow.price - buf) bos = 'bear';
  if (base.label === 'HH/HL' && lastLow && Number.isFinite(close) && close < lastLow.price - buf) choch = 'bear';
  if (base.label === 'LH/LL' && lastHigh && Number.isFinite(close) && close > lastHigh.price + buf) choch = 'bull';
  const developing = Boolean((base.hh && !base.hl) || (base.ll && !base.lh) || (base.hl && !base.hh) || (base.lh && !base.ll));
  return {
    ...base,
    lastHigh: lastHigh ? round(lastHigh.price, 2) : null,
    lastLow: lastLow ? round(lastLow.price, 2) : null,
    prevHigh: prevHigh ? round(prevHigh.price, 2) : null,
    prevLow: prevLow ? round(prevLow.price, 2) : null,
    bos,
    choch,
    developing,
    confirmed: !developing && (base.label === 'HH/HL' || base.label === 'LH/LL' || base.label === 'range'),
  };
}

function detectRange(completed, atrVal, adxVal) {
  const window = completed.slice(-20);
  if (window.length < 10) return null;
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const width = high - low;
  if (!(width > 0)) return null;
  const mid = (high + low) / 2;
  const close = window[window.length - 1].close;
  const tol = Number.isFinite(atrVal) ? atrVal * 0.28 : width * 0.08;
  let testsHigh = 0;
  let testsLow = 0;
  let overlaps = 0;
  for (let i = 0; i < window.length; i += 1) {
    const c = window[i];
    if (c.high >= high - tol) testsHigh += 1;
    if (c.low <= low + tol) testsLow += 1;
    if (i > 0) {
      const p = window[i - 1];
      if (c.low < p.high && c.high > p.low) overlaps += 1;
    }
  }
  const widthAtr = Number.isFinite(atrVal) && atrVal > 0 ? width / atrVal : null;
  const overlapPct = window.length > 1 ? overlaps / (window.length - 1) : 0;
  const compressed = Number.isFinite(widthAtr) && widthAtr < 2.2;
  const ranging = testsHigh >= 2 && testsLow >= 2 && overlapPct >= 0.45 && (adxVal == null || adxVal < 22);
  const choppy = overlapPct >= 0.7 && (adxVal == null || adxVal < 18) && Math.abs(close - mid) / width < 0.35;
  let kind = null;
  if (ranging && compressed) kind = 'compression';
  else if (choppy && !ranging) kind = 'choppy';
  else if (ranging) kind = 'range';
  else if (compressed && (adxVal == null || adxVal < 18)) kind = 'contraction';
  if (!kind) return null;
  return {
    kind,
    high: round(high, 2),
    low: round(low, 2),
    mid: round(mid, 2),
    width: round(width, 2),
    widthAtr: round(widthAtr, 2),
    testsHigh,
    testsLow,
    position: round((close - low) / width, 3),
    overlapPct: round(overlapPct, 2),
  };
}

function classifyFailedMove(completed, forming, range, atrVal) {
  if (!range || completed.length < 3) {
    return { status: 'none', direction: null, level: null, accepted: false };
  }
  const buf = Number.isFinite(atrVal) ? atrVal * 0.12 : range.width * 0.04;
  const last = completed[completed.length - 1];
  const prev = completed[completed.length - 2];
  const live = forming?.close;
  const beyondHigh = (c) => Number.isFinite(c?.close) && c.close > range.high + buf;
  const beyondLow = (c) => Number.isFinite(c?.close) && c.close < range.low - buf;
  const inside = (c) => Number.isFinite(c?.close) && c.close <= range.high && c.close >= range.low;
  const wickHigh = last.high > range.high + buf && last.close <= range.high;
  const wickLow = last.low < range.low - buf && last.close >= range.low;

  if (wickHigh && inside(last) && range.testsHigh >= 2) {
    return { status: 'liquidity-sweep', direction: 'bull', level: range.high, accepted: false };
  }
  if (wickLow && inside(last) && range.testsLow >= 2) {
    return { status: 'liquidity-sweep', direction: 'bear', level: range.low, accepted: false };
  }

  if (beyondHigh(prev) && inside(last)) {
    return { status: 'failed-breakout', direction: 'bull', level: range.high, accepted: false };
  }
  if (beyondLow(prev) && inside(last)) {
    return { status: 'failed-breakdown', direction: 'bear', level: range.low, accepted: false };
  }

  if (beyondHigh(last) && beyondHigh(prev)) {
    return { status: 'breakout-accepted', direction: 'bull', level: range.high, accepted: true };
  }
  if (beyondLow(last) && beyondLow(prev)) {
    return { status: 'breakdown-accepted', direction: 'bear', level: range.low, accepted: true };
  }

  if (beyondHigh(last)) {
    return { status: 'potential-breakout', direction: 'bull', level: range.high, accepted: false };
  }
  if (beyondLow(last)) {
    return { status: 'potential-breakdown', direction: 'bear', level: range.low, accepted: false };
  }

  if (Number.isFinite(live) && live > range.high) {
    return { status: 'potential-breakout', direction: 'bull', level: range.high, accepted: false, forming: true };
  }
  if (Number.isFinite(live) && live < range.low) {
    return { status: 'potential-breakdown', direction: 'bear', level: range.low, accepted: false, forming: true };
  }

  return { status: 'none', direction: null, level: null, accepted: false };
}

function momentumState({ rsiVal, prevRsi, slope, adxVal, strength }) {
  if (![rsiVal, slope].some(Number.isFinite) && !Number.isFinite(adxVal)) {
    return { state: 'insufficient', label: 'Insufficient evidence' };
  }
  const rsiDrop = Number.isFinite(rsiVal) && Number.isFinite(prevRsi) ? rsiVal - prevRsi : 0;
  if (strength === 'strong' && Number.isFinite(slope) && Math.abs(slope) >= 0.35 && Math.abs(rsiDrop) < 2) {
    return { state: 'strengthening', label: 'Momentum strengthening' };
  }
  if (Number.isFinite(slope) && Math.abs(slope) < 0.12 && (adxVal == null || adxVal < 20)) {
    return { state: 'stable', label: 'Momentum stable' };
  }
  if ((Number.isFinite(slope) && Math.abs(slope) < 0.08 && strength !== 'strong') || (rsiDrop < -4 && slope < 0.05)) {
    return { state: 'weakening', label: 'Momentum weakening' };
  }
  if (Number.isFinite(rsiVal) && ((rsiVal >= 72 && rsiDrop < -3) || (rsiVal <= 28 && rsiDrop > 3))) {
    return { state: 'exhaustion', label: 'Possible exhaustion' };
  }
  return { state: 'stable', label: 'Momentum stable' };
}

function volatilityState(atrNow, atrPrev, atrPct) {
  if (!Number.isFinite(atrNow)) return { state: 'insufficient', label: 'Insufficient evidence', atr: null, atrPct: null };
  if (Number.isFinite(atrPct) && atrPct > 3.2) {
    return { state: 'abnormal', label: 'Abnormal volatility', atr: round(atrNow, 2), atrPct: round(atrPct, 2) };
  }
  if (Number.isFinite(atrPrev) && atrPrev > 0) {
    const ratio = atrNow / atrPrev;
    if (ratio <= 0.72) return { state: 'contraction', label: 'Volatility contraction', atr: round(atrNow, 2), atrPct: round(atrPct, 2) };
    if (ratio >= 1.4) return { state: 'expansion', label: 'Volatility expansion', atr: round(atrNow, 2), atrPct: round(atrPct, 2) };
  }
  return { state: 'normal', label: 'Volatility typical', atr: round(atrNow, 2), atrPct: round(atrPct, 2) };
}

function analyzeTf(candles, interval, settings, now, kind) {
  const tf = analyzeTimeframe(candles, interval, settings, now, kind);
  const { completed, forming } = splitForming(candles, interval, now, kind);
  if (tf.missing || completed.length < 16) {
    return {
      interval,
      key: TF_KEYS[interval],
      label: TF_LABEL[interval],
      trend: 'insufficient',
      direction: 'insufficient',
      missing: true,
      forming: Boolean(forming),
      bars: completed.length,
      provisional: true,
    };
  }
  const closes = completed.map((c) => c.close);
  const rsiS = rsi(closes, 14);
  const atrS = atr(completed, 14);
  const emaFastS = ema(closes, settings.emaFast);
  const adxPack = adx(completed, settings.adxPeriod);
  const rsiVal = lastFinite(rsiS);
  const prevRsi = valueAt(rsiS, 3);
  const atrNow = lastFinite(atrS);
  const atrPrev = valueAt(atrS, 14);
  const close = closes[closes.length - 1];
  const atrPct = Number.isFinite(atrNow) && close ? (atrNow / close) * 100 : null;
  const fastNow = lastFinite(emaFastS);
  const fastPrev = valueAt(emaFastS, 3);
  const slope = Number.isFinite(fastNow) && Number.isFinite(fastPrev) && Number.isFinite(atrNow) && atrNow > 0
    ? (fastNow - fastPrev) / atrNow
    : null;
  const pivots = swingPivots(completed, settings.pivotStrength);
  const structure = describeStructure(pivots, close, atrNow);
  const range = detectRange(completed, atrNow, lastFinite(adxPack.adx));
  const failed = classifyFailedMove(completed, forming, range, atrNow);
  const br = detectBreakout(candles, interval, settings, now, kind);
  const mom = momentumState({ rsiVal, prevRsi, slope, adxVal: lastFinite(adxPack.adx), strength: tf.strength });
  const vol = volatilityState(atrNow, atrPrev, atrPct);
  let direction = tf.trend;
  if (tf.trend === 'insufficient') direction = 'insufficient';
  return {
    interval,
    key: TF_KEYS[interval],
    label: TF_LABEL[interval],
    trend: tf.trend,
    direction,
    close: tf.close,
    emaFast: tf.emaFast,
    emaSlow: tf.emaSlow,
    vwap: tf.vwap,
    rsi: round(rsiVal, 1),
    adx: tf.adx,
    atr: round(atrNow, 2),
    atrPct: round(atrPct, 2),
    emaSlope: round(slope, 3),
    strength: tf.strength,
    strengthLabel: tf.strengthLabel,
    structure,
    range,
    failed,
    breakout: br,
    momentum: mom,
    volatility: vol,
    forming: Boolean(forming),
    provisional: Boolean(forming),
    missing: false,
    bars: completed.length,
    lastCandleAt: tf.lastCandleAt,
  };
}

function alignmentOf(tfs) {
  const rows = ['day', 'h1', 'm15', 'm5'].map((k) => tfs[k]).filter((t) => t && !t.missing);
  const dirs = rows.map((t) => t.direction);
  const bulls = dirs.filter((d) => d === 'bullish').length;
  const bears = dirs.filter((d) => d === 'bearish').length;
  const sides = dirs.filter((d) => d === 'sideways').length;
  const conflicts = [];
  if (tfs.m15?.direction && tfs.day?.direction && tfs.m15.direction !== tfs.day.direction && tfs.m15.direction !== 'insufficient' && tfs.day.direction !== 'insufficient') {
    conflicts.push(`15-minute is ${tfs.m15.direction} while Daily is ${tfs.day.direction}`);
  }
  if (tfs.m5?.direction && tfs.h1?.direction && tfs.m5.direction !== tfs.h1.direction && tfs.m5.direction !== 'insufficient' && tfs.h1.direction !== 'insufficient') {
    conflicts.push(`5-minute is ${tfs.m5.direction} while 1-hour is ${tfs.h1.direction}`);
  }
  let label = 'Insufficient confirmation';
  let status = 'insufficient';
  if (bulls >= 3 && bears === 0) {
    label = 'Aligned bullish';
    status = 'aligned-bull';
  } else if (bears >= 3 && bulls === 0) {
    label = 'Aligned bearish';
    status = 'aligned-bear';
  } else if (bulls && bears) {
    label = 'Timeframe disagreement';
    status = 'conflict';
  } else if (sides >= 2) {
    label = 'Mostly sideways';
    status = 'sideways';
  } else if (bulls || bears) {
    label = 'Partial agreement';
    status = 'partial';
  }
  return { status, label, bulls, bears, sides, available: rows.length, conflicts };
}

function evidenceStrength({ alignment, missing, range, confirmed, stale }) {
  if (missing) return { level: 'insufficient', label: 'Insufficient or stale data' };
  if (stale) return { level: 'low', label: 'Low — data is stale' };
  if (alignment.status === 'conflict') return { level: 'weak', label: 'Weak — timeframes disagree' };
  if (range && (range.kind === 'choppy' || range.kind === 'compression')) return { level: 'weak', label: 'Weak — price is compressed or choppy' };
  if (confirmed && (alignment.status === 'aligned-bull' || alignment.status === 'aligned-bear')) {
    return { level: 'strong', label: 'Strong — structure and timeframes agree' };
  }
  if (alignment.status === 'partial' || alignment.status === 'sideways') {
    return { level: 'moderate', label: 'Moderate' };
  }
  return { level: 'moderate', label: 'Moderate' };
}

function transitionFrom(flags) {
  const stages = [];
  if (flags.priorTrend) stages.push({ id: 1, label: `Existing ${flags.priorTrend} trend`, done: true });
  if (flags.momentumWeak) stages.push({ id: 2, label: 'Momentum weakens', done: true });
  if (flags.levelTested) stages.push({ id: 3, label: 'Important level tested', done: true });
  if (flags.levelBroke) stages.push({ id: 4, label: 'Level breaks', done: true });
  if (flags.swingFlip) stages.push({ id: 5, label: 'Counter swing forms', done: true });
  if (flags.followThrough) stages.push({ id: 6, label: 'Continuation confirmed', done: true });
  const current = stages.at(-1) || { id: 0, label: 'No transition in progress', done: false };
  const required = [];
  if (flags.momentumWeak && !flags.levelBroke) required.push('A close through the invalidation level');
  if (flags.levelBroke && !flags.swingFlip) required.push('A confirmed counter swing on the primary timeframe');
  if (flags.swingFlip && !flags.followThrough) required.push('Follow-through close beyond the broken level');
  return {
    stage: current.id,
    label: current.label,
    confirmed: stages.map((s) => s.label),
    required,
  };
}

function nodeAndFlow(classification) {
  const map = {
    'strong-uptrend': { node: 'BULLISH', flow: 'bull' },
    uptrend: { node: 'BULLISH', flow: 'bull' },
    'weakening-uptrend': { node: 'BULLISH', flow: 'fade' },
    'strong-downtrend': { node: 'BEARISH', flow: 'bear' },
    downtrend: { node: 'BEARISH', flow: 'bear' },
    'weakening-downtrend': { node: 'BEARISH', flow: 'fade' },
    sideways: { node: 'SIDEWAYS', flow: 'side' },
    consolidation: { node: 'SIDEWAYS', flow: 'side' },
    choppy: { node: 'SIDEWAYS', flow: 'side' },
    'pullback-up': { node: 'BULLISH', flow: 'fade' },
    'pullback-down': { node: 'BEARISH', flow: 'fade' },
    'range-breakout': { node: 'BULLISH', flow: 'bull' },
    'range-breakdown': { node: 'BEARISH', flow: 'bear' },
    'potential-bull-reversal': { node: 'POTENTIAL REVERSAL', flow: 'reversal' },
    'potential-bear-reversal': { node: 'POTENTIAL REVERSAL', flow: 'reversal' },
    'confirmed-bull-reversal': { node: 'BULLISH', flow: 'bull' },
    'confirmed-bear-reversal': { node: 'BEARISH', flow: 'bear' },
    'false-breakout': { node: 'FAILED BREAKOUT', flow: 'failed' },
    'false-breakdown': { node: 'FAILED BREAKDOWN', flow: 'failed' },
    'liquidity-sweep': { node: 'SIDEWAYS', flow: 'side' },
    'vol-contraction': { node: 'SIDEWAYS', flow: 'side' },
    insufficient: { node: 'WAIT', flow: 'wait' },
  };
  return map[classification] || { node: 'WAIT', flow: 'wait' };
}

function classifyCombined(tfs, primaryKey) {
  const primary = tfs[primaryKey] || tfs.m15;
  const day = tfs.day;
  const h1 = tfs.h1;
  const m15 = tfs.m15;
  const m5 = tfs.m5;
  if (!primary || primary.missing) {
    return {
      classification: 'insufficient',
      classificationLabel: 'Insufficient or stale data',
      direction: 'insufficient',
      confirmed: false,
      provisional: true,
    };
  }

  const htfBull = day?.direction === 'bullish' || ((day?.missing || day?.direction === 'insufficient') && h1?.direction === 'bullish');
  const htfBear = day?.direction === 'bearish' || ((day?.missing || day?.direction === 'insufficient') && h1?.direction === 'bearish');
  const intraBear = m15?.direction === 'bearish' || m5?.direction === 'bearish';
  const intraBull = m15?.direction === 'bullish' || m5?.direction === 'bullish';
  const htfSupportIntact = day?.structure?.bos !== 'bear' && h1?.structure?.bos !== 'bear';
  const htfResistIntact = day?.structure?.bos !== 'bull' && h1?.structure?.bos !== 'bull';
  const failed = [m15, h1, primary].map((t) => t?.failed).find((f) => f && f.status && f.status !== 'none');
  const range = primary.range || m15?.range || h1?.range;

  if (failed?.status === 'failed-breakout') {
    return {
      classification: 'false-breakout',
      classificationLabel: 'Failed breakout',
      direction: 'sideways',
      confirmed: !failed.forming,
      provisional: Boolean(failed.forming),
      failed,
    };
  }
  if (failed?.status === 'failed-breakdown') {
    return {
      classification: 'false-breakdown',
      classificationLabel: 'Failed breakdown',
      direction: 'sideways',
      confirmed: !failed.forming,
      provisional: Boolean(failed.forming),
      failed,
    };
  }
  if (failed?.status === 'liquidity-sweep') {
    return {
      classification: 'liquidity-sweep',
      classificationLabel: 'Liquidity sweep — close back inside the range',
      direction: 'sideways',
      confirmed: true,
      provisional: false,
      failed,
    };
  }
  if (failed?.status === 'breakout-accepted') {
    return {
      classification: 'range-breakout',
      classificationLabel: 'Range breakout accepted',
      direction: 'bullish',
      confirmed: true,
      provisional: false,
      failed,
    };
  }
  if (failed?.status === 'breakdown-accepted') {
    return {
      classification: 'range-breakdown',
      classificationLabel: 'Range breakdown accepted',
      direction: 'bearish',
      confirmed: true,
      provisional: false,
      failed,
    };
  }

  const bearRevConfirmed =
    (day?.structure?.bos === 'bear' || h1?.structure?.bos === 'bear') &&
    (m15?.structure?.lh || h1?.structure?.lh) &&
    (m15?.direction === 'bearish' || primary.direction === 'bearish');
  const bullRevConfirmed =
    (day?.structure?.bos === 'bull' || h1?.structure?.bos === 'bull') &&
    (m15?.structure?.hl || h1?.structure?.hl) &&
    (m15?.direction === 'bullish' || primary.direction === 'bullish');
  const bearRevPotential =
    (m15?.structure?.choch === 'bear' || h1?.structure?.choch === 'bear') && htfBull;
  const bullRevPotential =
    (m15?.structure?.choch === 'bull' || h1?.structure?.choch === 'bull') && htfBear;

  if (bearRevConfirmed && !htfSupportIntact) {
    return {
      classification: 'confirmed-bear-reversal',
      classificationLabel: 'Confirmed bearish reversal',
      direction: 'bearish',
      confirmed: true,
      provisional: Boolean(primary.forming),
    };
  }
  if (bullRevConfirmed && !htfResistIntact) {
    return {
      classification: 'confirmed-bull-reversal',
      classificationLabel: 'Confirmed bullish reversal',
      direction: 'bullish',
      confirmed: true,
      provisional: Boolean(primary.forming),
    };
  }
  if (bearRevPotential) {
    return {
      classification: 'potential-bear-reversal',
      classificationLabel: 'Potential bearish reversal',
      direction: 'mixed',
      confirmed: false,
      provisional: true,
    };
  }
  if (bullRevPotential) {
    return {
      classification: 'potential-bull-reversal',
      classificationLabel: 'Potential bullish reversal',
      direction: 'mixed',
      confirmed: false,
      provisional: true,
    };
  }

  if (htfBull && intraBear && htfSupportIntact) {
    return {
      classification: 'pullback-up',
      classificationLabel: 'Potential intraday pullback within a higher-timeframe uptrend',
      direction: 'bullish',
      confirmed: false,
      provisional: true,
    };
  }
  if (htfBear && intraBull && htfResistIntact) {
    return {
      classification: 'pullback-down',
      classificationLabel: 'Potential intraday pullback within a higher-timeframe downtrend',
      direction: 'bearish',
      confirmed: false,
      provisional: true,
    };
  }

  if (range?.kind === 'choppy') {
    return {
      classification: 'choppy',
      classificationLabel: 'Choppy or indecisive market',
      direction: 'sideways',
      confirmed: false,
      provisional: Boolean(primary.forming),
    };
  }
  if (range?.kind === 'compression' || primary.volatility?.state === 'contraction') {
    return {
      classification: range?.kind === 'range' ? 'sideways' : 'vol-contraction',
      classificationLabel: range?.kind === 'range' ? 'Sideways or range-bound market' : 'Volatility contraction',
      direction: 'sideways',
      confirmed: false,
      provisional: Boolean(primary.forming),
      range,
    };
  }
  if (range?.kind === 'range' && primary.direction === 'sideways') {
    return {
      classification: 'sideways',
      classificationLabel: 'Sideways or range-bound market',
      direction: 'sideways',
      confirmed: true,
      provisional: Boolean(primary.forming),
      range,
    };
  }

  const momWeak = primary.momentum?.state === 'weakening' || primary.momentum?.state === 'exhaustion';
  if (primary.direction === 'bullish' && momWeak) {
    return {
      classification: 'weakening-uptrend',
      classificationLabel: 'Weakening uptrend',
      direction: 'bullish',
      confirmed: false,
      provisional: Boolean(primary.forming),
    };
  }
  if (primary.direction === 'bearish' && momWeak) {
    return {
      classification: 'weakening-downtrend',
      classificationLabel: 'Weakening downtrend',
      direction: 'bearish',
      confirmed: false,
      provisional: Boolean(primary.forming),
    };
  }
  if (primary.direction === 'bullish' && primary.strength === 'strong' && (h1?.direction === 'bullish' || day?.direction === 'bullish')) {
    return {
      classification: 'strong-uptrend',
      classificationLabel: 'Strong uptrend',
      direction: 'bullish',
      confirmed: !primary.forming,
      provisional: Boolean(primary.forming),
    };
  }
  if (primary.direction === 'bearish' && primary.strength === 'strong' && (h1?.direction === 'bearish' || day?.direction === 'bearish')) {
    return {
      classification: 'strong-downtrend',
      classificationLabel: 'Strong downtrend',
      direction: 'bearish',
      confirmed: !primary.forming,
      provisional: Boolean(primary.forming),
    };
  }
  if (primary.direction === 'bullish') {
    return {
      classification: 'uptrend',
      classificationLabel: 'Uptrend',
      direction: 'bullish',
      confirmed: !primary.forming,
      provisional: Boolean(primary.forming),
    };
  }
  if (primary.direction === 'bearish') {
    return {
      classification: 'downtrend',
      classificationLabel: 'Downtrend',
      direction: 'bearish',
      confirmed: !primary.forming,
      provisional: Boolean(primary.forming),
    };
  }
  if (primary.direction === 'sideways') {
    return {
      classification: 'sideways',
      classificationLabel: 'Sideways or range-bound market',
      direction: 'sideways',
      confirmed: false,
      provisional: Boolean(primary.forming),
    };
  }
  return {
    classification: 'insufficient',
    classificationLabel: 'Insufficient confirmation',
    direction: 'mixed',
    confirmed: false,
    provisional: true,
  };
}

function buildExplanation(pack, tfs, primaryKey) {
  const primary = tfs[primaryKey] || tfs.m15;
  const supporting = [];
  const conflicting = [];
  if (tfs.day && !tfs.day.missing) supporting.push(`Daily is ${tfs.day.direction}.`);
  if (tfs.h1 && !tfs.h1.missing) supporting.push(`1-hour is ${tfs.h1.direction}.`);
  if (primary?.structure?.label) supporting.push(`Primary structure is ${primary.structure.label}.`);
  if (primary?.momentum?.label) supporting.push(primary.momentum.label + '.');
  if (pack.failed?.status && pack.failed.status !== 'none') {
    supporting.push(`${pack.failed.status.replace(/-/g, ' ')} at ${pack.failed.level}.`);
  }
  if (tfs.m15 && tfs.day && tfs.m15.direction !== tfs.day.direction && !tfs.m15.missing && !tfs.day.missing) {
    conflicting.push(`15-minute ${tfs.m15.direction} disagrees with Daily ${tfs.day.direction}.`);
  }
  if (primary?.structure?.developing) conflicting.push('Latest swing is still developing, not confirmed.');
  if (primary?.forming) conflicting.push('The latest primary candle is still forming.');

  let confirmation = 'A completed close that holds the current structure.';
  let invalidation = 'A completed close that breaks the last confirmed swing against this reading.';
  if (pack.classification === 'pullback-up') {
    confirmation = 'Higher-timeframe support holds and 15-minute selling momentum fades.';
    invalidation = tfs.h1?.structure?.lastLow
      ? `Completed close below 1-hour swing low ${tfs.h1.structure.lastLow}.`
      : 'Completed close that breaks higher-timeframe support.';
  } else if (pack.classification === 'pullback-down') {
    confirmation = 'Higher-timeframe resistance holds and 15-minute buying fades.';
    invalidation = tfs.h1?.structure?.lastHigh
      ? `Completed close above 1-hour swing high ${tfs.h1.structure.lastHigh}.`
      : 'Completed close that breaks higher-timeframe resistance.';
  } else if (pack.classification.startsWith('potential-bear')) {
    confirmation = 'A lower high plus a close below the broken support on the 1-hour.';
    invalidation = 'A close back above the broken support that restores higher highs.';
  } else if (pack.classification.startsWith('potential-bull')) {
    confirmation = 'A higher low plus a close above the broken resistance on the 1-hour.';
    invalidation = 'A close back below the broken resistance that restores lower lows.';
  } else if (pack.classification === 'false-breakout') {
    confirmation = 'Price remains inside the prior range on the next completed bar.';
    invalidation = `A completed close back above ${pack.failed?.level ?? 'the range high'}.`;
  } else if (pack.classification === 'false-breakdown') {
    confirmation = 'Price remains inside the prior range on the next completed bar.';
    invalidation = `A completed close back below ${pack.failed?.level ?? 'the range low'}.`;
  }

  return {
    behaviour: pack.classificationLabel,
    higherTf: tfs.day?.missing ? 'Insufficient' : `${tfs.day.direction} (${tfs.day.strengthLabel || tfs.day.direction})`,
    intraday: tfs.m15?.missing ? 'Insufficient' : `${tfs.m15.direction} (${tfs.m15.strengthLabel || tfs.m15.direction})`,
    momentum: primary?.momentum?.label || 'Insufficient evidence',
    structure: primary?.structure?.label
      ? `${primary.structure.label}${primary.structure.bos ? ` · BOS ${primary.structure.bos}` : ''}${primary.structure.choch ? ` · CHoCH ${primary.structure.choch}` : ''}`
      : 'Unclear',
    breakout: pack.failed?.status && pack.failed.status !== 'none' ? pack.failed.status.replace(/-/g, ' ') : 'No confirmed breakout',
    reversal: pack.classification.includes('reversal') ? pack.classificationLabel : 'Not confirmed',
    supporting: supporting.slice(0, 5),
    conflicting: conflicting.slice(0, 3),
    confirmation,
    invalidation,
  };
}

function timelineFrom(symbol, tfs, pack, nowIso) {
  const events = [];
  const push = (type, tf, extra = {}) => {
    events.push({
      instrument: symbol,
      timestamp: tf?.lastCandleAt || nowIso,
      timeframe: tf?.label || '15-minute',
      type,
      level: extra.level ?? null,
      evidence: extra.evidence || pack.classificationLabel,
      status: extra.status || (tf?.provisional ? 'provisional' : 'confirmed'),
    });
  };
  const primary = tfs.m15 || tfs.h1;
  if (primary?.range) push('range-established', primary, { level: primary.range.high, evidence: `Range ${primary.range.low}–${primary.range.high}` });
  if (pack.failed?.status === 'potential-breakout') push('breakout-attempt', primary, { level: pack.failed.level, status: 'provisional' });
  if (pack.failed?.status === 'breakout-accepted') push('breakout-accepted', primary, { level: pack.failed.level });
  if (pack.failed?.status === 'failed-breakout') push('failed-breakout', primary, { level: pack.failed.level });
  if (pack.failed?.status === 'failed-breakdown') push('failed-breakdown', primary, { level: pack.failed.level });
  if (pack.failed?.status === 'liquidity-sweep') push('liquidity-sweep', primary, { level: pack.failed.level });
  if (primary?.momentum?.state === 'weakening') push('momentum-weakening', primary);
  if (pack.classification.includes('reversal')) push(pack.confirmed ? 'structure-change' : 'potential-reversal', tfs.h1 || primary);
  if (pack.classification === 'pullback-up' || pack.classification === 'pullback-down') push('pullback', tfs.m15 || primary, { status: 'provisional' });
  return events.slice(0, 8);
}

function analyzeBehaviour({
  candles5,
  candles15,
  candles60,
  candlesDay,
  settings,
  now = new Date(),
  kind = 'cash',
  symbol,
  name,
  ltp,
  change,
  changePct,
  primary = '15minute',
  stale = false,
}) {
  const iv = ['5minute', '15minute', '60minute', 'day'].includes(primary) ? primary : '15minute';
  const tfs = {
    m5: analyzeTf(candles5 || [], '5minute', settings, now, kind),
    m15: analyzeTf(candles15 || [], '15minute', settings, now, kind),
    h1: analyzeTf(candles60 || [], '60minute', settings, now, kind),
    day: analyzeTf(candlesDay || [], 'day', settings, now, kind),
  };
  const primaryKey = TF_KEYS[iv];
  const pack = classifyCombined(tfs, primaryKey);
  const alignment = alignmentOf(tfs);
  const primaryTf = tfs[primaryKey] || tfs.m15;
  const visual = nodeAndFlow(pack.classification);
  const missing = !primaryTf || primaryTf.missing;
  const strength = evidenceStrength({
    alignment,
    missing,
    range: pack.range || primaryTf?.range,
    confirmed: pack.confirmed,
    stale,
  });
  const flags = {
    priorTrend: tfs.day?.direction === 'bullish' || tfs.h1?.direction === 'bullish'
      ? 'bullish'
      : tfs.day?.direction === 'bearish' || tfs.h1?.direction === 'bearish'
        ? 'bearish'
        : null,
    momentumWeak: primaryTf?.momentum?.state === 'weakening' || primaryTf?.momentum?.state === 'exhaustion',
    levelTested: Boolean(primaryTf?.range && (primaryTf.range.position > 0.85 || primaryTf.range.position < 0.15)),
    levelBroke: Boolean(primaryTf?.structure?.bos || pack.failed?.accepted),
    swingFlip: Boolean(primaryTf?.structure?.choch),
    followThrough: pack.confirmed && pack.classification.includes('confirmed'),
  };
  const explanation = buildExplanation(pack, tfs, primaryKey);
  const nowIso = now.toISOString();
  return {
    instrument: symbol,
    name,
    ltp: Number.isFinite(ltp) ? ltp : primaryTf?.close ?? null,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    classification: pack.classification,
    classificationLabel: pack.classificationLabel,
    direction: pack.direction,
    nodeLabel: visual.node,
    flow: visual.flow,
    trendStrength: primaryTf?.strength || 'insufficient',
    trendStrengthLabel: primaryTf?.strengthLabel || 'Insufficient data',
    evidenceStrength: strength.level,
    evidenceStrengthLabel: strength.label,
    confirmed: Boolean(pack.confirmed),
    provisional: Boolean(pack.provisional || missing),
    primaryTimeframe: iv,
    timeframes: {
      m5: slimTf(tfs.m5),
      m15: slimTf(tfs.m15),
      h1: slimTf(tfs.h1),
      day: slimTf(tfs.day),
    },
    alignment,
    structure: primaryTf?.structure || null,
    range: pack.range || primaryTf?.range || null,
    breakout: pack.failed || primaryTf?.failed || { status: 'none', direction: null, level: null },
    reversal: {
      status: pack.classification.includes('reversal') ? (pack.confirmed ? 'confirmed' : 'potential') : 'none',
      side: pack.classification.includes('bull') ? 'bull' : pack.classification.includes('bear') ? 'bear' : null,
      timeframe: pack.classification.includes('reversal') ? (tfs.h1?.structure?.choch ? '1-hour' : '15-minute') : null,
    },
    momentum: primaryTf?.momentum || { state: 'insufficient', label: 'Insufficient evidence' },
    volatility: primaryTf?.volatility || { state: 'insufficient', label: 'Insufficient evidence' },
    transition: transitionFrom(flags),
    explanation,
    levels: {
      support: primaryTf?.structure?.lastLow ?? primaryTf?.range?.low ?? primaryTf?.breakout?.support ?? null,
      resistance: primaryTf?.structure?.lastHigh ?? primaryTf?.range?.high ?? primaryTf?.breakout?.resistance ?? null,
      invalidation: explanation.invalidation,
    },
    timeline: timelineFrom(symbol, tfs, pack, nowIso),
    lastUpdateAt: nowIso,
    sample: false,
  };
}

function slimTf(tf) {
  if (!tf) return { missing: true, direction: 'insufficient', trend: 'insufficient', label: '' };
  return {
    interval: tf.interval,
    key: tf.key,
    label: tf.label,
    trend: tf.trend,
    direction: tf.direction,
    rsi: tf.rsi ?? null,
    adx: tf.adx ?? null,
    atr: tf.atr ?? null,
    strength: tf.strength || 'insufficient',
    strengthLabel: tf.strengthLabel || 'Insufficient data',
    structure: tf.structure?.label || 'unclear',
    bos: tf.structure?.bos || null,
    choch: tf.structure?.choch || null,
    momentum: tf.momentum?.state || 'insufficient',
    volatility: tf.volatility?.state || 'insufficient',
    forming: Boolean(tf.forming),
    provisional: Boolean(tf.provisional),
    missing: Boolean(tf.missing),
  };
}

function sampleBehaviour({ id, name, ltp, change, changePct, bias, dayTrend, now = new Date() }) {
  const bull = bias === 'bullish' || bias === 'mild-bull';
  const bear = bias === 'bearish' || bias === 'mild-bear';
  const side = bias === 'sideways' || bias === 'mixed' || (!bull && !bear);
  const classification = side ? 'sideways' : bull ? 'uptrend' : 'downtrend';
  const visual = nodeAndFlow(classification);
  const dir = side ? 'sideways' : bull ? 'bullish' : 'bearish';
  return {
    instrument: id,
    name,
    ltp,
    change,
    changePct,
    classification,
    classificationLabel: side ? 'Sideways or range-bound market (sample)' : bull ? 'Uptrend (sample)' : 'Downtrend (sample)',
    direction: dir,
    nodeLabel: visual.node,
    flow: visual.flow,
    trendStrength: 'moderate',
    trendStrengthLabel: 'Moderate',
    evidenceStrength: 'low',
    evidenceStrengthLabel: 'Low — sample data, not live candles',
    confirmed: false,
    provisional: true,
    primaryTimeframe: '15minute',
    timeframes: {
      m5: { key: 'm5', label: '5-minute', trend: 'insufficient', direction: 'insufficient', missing: true, provisional: true },
      m15: { key: 'm15', label: '15-minute', trend: dir, direction: dir, missing: false, provisional: true },
      h1: { key: 'h1', label: '1-hour', trend: dir, direction: dir, missing: false, provisional: true },
      day: { key: 'day', label: 'Daily', trend: dayTrend || dir, direction: dayTrend || dir, missing: false, provisional: true },
    },
    alignment: { status: 'partial', label: 'Sample alignment', bulls: bull ? 2 : 0, bears: bear ? 2 : 0, sides: side ? 2 : 0, available: 2, conflicts: [] },
    structure: null,
    range: null,
    breakout: { status: 'none', direction: null, level: null },
    reversal: { status: 'none', side: null, timeframe: null },
    momentum: { state: 'insufficient', label: 'Insufficient evidence' },
    volatility: { state: 'insufficient', label: 'Insufficient evidence' },
    transition: { stage: 0, label: 'No transition in progress', confirmed: [], required: [] },
    explanation: {
      behaviour: side ? 'Sample sideways read' : bull ? 'Sample bullish read' : 'Sample bearish read',
      higherTf: dayTrend || dir,
      intraday: dir,
      momentum: 'Insufficient evidence',
      structure: 'Unclear',
      breakout: 'No confirmed breakout',
      reversal: 'Not confirmed',
      supporting: ['DEMO / sample card — connect Kite for a live classification.'],
      conflicting: ['Intraday candles are not loaded in this sample.'],
      confirmation: 'Connect Kite so completed candles can confirm the read.',
      invalidation: 'Treat this card as a labelled sample until live history arrives.',
    },
    levels: { support: null, resistance: null, invalidation: 'Sample only.' },
    timeline: [],
    lastUpdateAt: now.toISOString(),
    sample: true,
  };
}

module.exports = {
  analyzeBehaviour,
  analyzeTf,
  classifyCombined,
  classifyFailedMove,
  detectRange,
  describeStructure,
  sampleBehaviour,
  nodeAndFlow,
  INTERVAL_MIN,
};
