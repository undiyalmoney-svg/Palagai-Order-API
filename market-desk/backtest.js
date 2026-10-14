'use strict';

const { detectBreakout, analyzeTimeframe, combineScore, splitForming, INTERVAL_MIN } = require('./engine');
const { DEFAULTS, normalizeSettings } = require('./settings');

/**
 * Walk-forward evaluation of breakout and trend rules on completed candles only.
 * No future bars leak into detection. Labels use a later horizon that is
 * never fed back into the detector.
 */
function evaluateBreakouts(candles, interval, rawSettings = {}, horizon = 4) {
  const settings = normalizeSettings({ ...DEFAULTS, ...rawSettings });
  const { completed } = splitForming(candles, interval, new Date('2099-01-01T00:00:00Z'));
  const signals = [];
  const start = Math.max(settings.srLookback + 2, 10);
  for (let i = start; i < completed.length; i += 1) {
    const window = completed.slice(0, i + 1);
    const mins = INTERVAL_MIN[interval] || 15;
    const now = new Date(new Date(completed[i].date).getTime() + mins * 60_000);
    const packed = detectBreakout(window, interval, settings, now);
    if (packed.status !== 'confirmed' || !packed.direction) continue;
    const future = completed.slice(i + 1, i + 1 + horizon);
    const follow =
      packed.direction === 'bull'
        ? future.some((c) => c.close > packed.close)
        : future.some((c) => c.close < packed.close);
    const failed = future.some((c) =>
      packed.direction === 'bull' ? c.close < packed.level : c.close > packed.level,
    );
    signals.push({
      at: completed[i].date,
      direction: packed.direction,
      followThrough: follow,
      falseBreak: failed && !follow,
    });
  }
  const n = signals.length;
  const follow = signals.filter((s) => s.followThrough).length;
  const falses = signals.filter((s) => s.falseBreak).length;
  return {
    interval,
    signals: n,
    followThroughRate: n ? follow / n : null,
    falseBreakoutRate: n ? falses / n : null,
    sample: signals.slice(0, 20),
    note: 'Rates are descriptive of this sample. They are not a probability of future profit.',
  };
}

function evaluateTrend(candles15, candles60, candlesDay, rawSettings = {}, horizon = 4) {
  const settings = normalizeSettings({ ...DEFAULTS, ...rawSettings });
  const { completed } = splitForming(candles15, '15minute', new Date('2099-01-01T00:00:00Z'));
  let hits = 0;
  let tried = 0;
  const min = settings.emaSlow + 8;
  for (let i = min; i < completed.length - horizon; i += 1) {
    const tf15 = analyzeTimeframe(completed.slice(0, i + 1), '15minute', settings, new Date(completed[i].date));
    const tf60 = candles60 ? analyzeTimeframe(candles60.filter((c) => new Date(c.date) <= new Date(completed[i].date)), '60minute', settings, new Date(completed[i].date)) : null;
    const tfDay = candlesDay ? analyzeTimeframe(candlesDay.filter((c) => new Date(c.date) <= new Date(completed[i].date)), 'day', settings, new Date(completed[i].date)) : null;
    const combined = combineScore(tf15, tf60, tfDay, settings);
    if (combined.score == null || combined.bias === 'insufficient' || combined.bias === 'mixed' || combined.bias === 'sideways') continue;
    const later = completed[i + horizon];
    if (!later) continue;
    const up = later.close > completed[i].close;
    const wantUp = combined.score > 0;
    tried += 1;
    if (up === wantUp) hits += 1;
  }
  return {
    labelled: tried,
    directionHits: hits,
    directionAccuracy: tried ? hits / tried : null,
    note: 'Direction accuracy is not trading profitability. No costs applied.',
  };
}

function evaluate(candlesByInterval, rawSettings = {}) {
  const br15 = candlesByInterval['15minute']
    ? evaluateBreakouts(candlesByInterval['15minute'], '15minute', rawSettings)
    : { signals: 0 };
  const br60 = candlesByInterval['60minute']
    ? evaluateBreakouts(candlesByInterval['60minute'], '60minute', rawSettings)
    : { signals: 0 };
  const trend = evaluateTrend(
    candlesByInterval['15minute'] || [],
    candlesByInterval['60minute'],
    candlesByInterval.day,
    rawSettings,
  );
  return { breakout15: br15, breakout60: br60, trend };
}

module.exports = { evaluateBreakouts, evaluateTrend, evaluate };
