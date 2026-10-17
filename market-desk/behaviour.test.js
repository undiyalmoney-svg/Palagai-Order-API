'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS } = require('./settings');
const {
  analyzeBehaviour,
  classifyFailedMove,
  detectRange,
  describeStructure,
  sampleBehaviour,
} = require('./behaviour');
const { swingPivots } = require('./engine');

function bar(date, close, extra = {}) {
  const w = extra.w ?? 1;
  return {
    date,
    open: extra.open ?? close - 0.3,
    high: extra.high ?? close + w,
    low: extra.low ?? close - w,
    close,
    volume: extra.volume ?? 1_200,
  };
}

function series(n, start, step, t0, extra = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(bar(new Date(t0 + i * 15 * 60_000).toISOString(), start + i * step, extra));
  }
  return out;
}

const T0 = Date.parse('2026-10-13T03:45:00Z');
const NOW = new Date('2026-10-14T08:00:00Z');

test('higher highs and higher lows support an uptrend, not a reversal', () => {
  const up = series(80, 22000, 8, T0, { w: 6 });
  const out = analyzeBehaviour({
    candles15: up,
    candles60: series(80, 22000, 18, T0, { w: 12 }),
    candlesDay: series(80, 21000, 25, Date.parse('2026-06-01T03:45:00Z'), { w: 40 }),
    candles5: series(80, 22000, 3, T0, { w: 3 }),
    settings: DEFAULTS,
    now: NOW,
    symbol: 'NIFTY50',
    name: 'NIFTY 50',
    ltp: up.at(-1).close,
    changePct: 0.4,
  });
  assert.equal(out.sample, false);
  assert.match(out.classification, /uptrend|strong-uptrend|pullback/);
  assert.equal(out.direction === 'bullish' || out.classification === 'pullback-up', true);
  assert.notEqual(out.classification, 'confirmed-bear-reversal');
  assert.ok(out.explanation.supporting.length >= 1);
  assert.ok(out.explanation.invalidation.length > 8);
});

test('a short-term drop inside a higher-timeframe uptrend is a pullback', () => {
  const day = series(80, 21000, 30, Date.parse('2026-06-01T03:45:00Z'), { w: 40 });
  const hour = series(80, 22400, 10, T0, { w: 8 });
  const down15 = series(80, 22800, -6, T0, { w: 5 });
  const out = analyzeBehaviour({
    candles15: down15,
    candles60: hour,
    candlesDay: day,
    candles5: series(80, 22800, -2, T0, { w: 2 }),
    settings: DEFAULTS,
    now: NOW,
    symbol: 'NIFTY50',
    name: 'NIFTY 50',
    ltp: down15.at(-1).close,
    changePct: -0.3,
  });
  assert.ok(
    out.classification === 'pullback-up' ||
      out.classification === 'weakening-uptrend' ||
      out.classification === 'potential-bear-reversal',
  );
  assert.notEqual(out.classification, 'confirmed-bear-reversal');
  assert.notEqual(out.classification, 'strong-downtrend');
  assert.match(out.explanation.behaviour, /pullback|Weakening|Potential|Uptrend|uptrend/i);
});

test('failed breakout requires a completed close back inside the range', () => {
  const rangeBars = [];
  for (let i = 0; i < 18; i += 1) {
    rangeBars.push(bar(new Date(T0 + i * 15 * 60_000).toISOString(), 100 + (i % 2 ? 0.4 : -0.4), { high: 102, low: 98, w: 1.5 }));
  }
  const broke = bar(new Date(T0 + 18 * 15 * 60_000).toISOString(), 104.2, { high: 104.6, low: 101.5 });
  const back = bar(new Date(T0 + 19 * 15 * 60_000).toISOString(), 100.4, { high: 101.2, low: 99.6 });
  const range = detectRange([...rangeBars, broke, back], 1.2, 14);
  assert.ok(range);
  const failed = classifyFailedMove([...rangeBars, broke, back], null, { ...range, high: 102, low: 98, width: 4, testsHigh: 3, testsLow: 3 }, 1.2);
  assert.equal(failed.status, 'failed-breakout');
  const wickOnly = classifyFailedMove(
    [...rangeBars, bar(new Date(T0 + 18 * 15 * 60_000).toISOString(), 100.2, { high: 104.8, low: 99.4 })],
    null,
    { high: 102, low: 98, width: 4, testsHigh: 3, testsLow: 3 },
    1.2,
  );
  assert.equal(wickOnly.status, 'liquidity-sweep');
});

test('a single lower low is not a confirmed bearish reversal', () => {
  const climb = series(40, 100, 1.2, T0, { w: 0.8 });
  const dip = bar(new Date(T0 + 40 * 15 * 60_000).toISOString(), 138, { high: 142, low: 136 });
  const candles = [...climb, dip];
  const pivots = swingPivots(candles, 2);
  const structure = describeStructure(pivots, dip.close, 1.4);
  assert.equal(structure.ll === true && structure.lh === true, false);
  const out = analyzeBehaviour({
    candles15: candles,
    candles60: series(40, 100, 2, T0, { w: 1.2 }),
    candlesDay: series(40, 90, 3, Date.parse('2026-07-01T03:45:00Z'), { w: 4 }),
    candles5: candles,
    settings: DEFAULTS,
    now: NOW,
    symbol: 'BANKNIFTY',
    name: 'NIFTY BANK',
    ltp: dip.close,
  });
  assert.notEqual(out.classification, 'confirmed-bear-reversal');
});

test('sample behaviour is labelled so the UI cannot pretend it is live', () => {
  const sample = sampleBehaviour({
    id: 'CRUDEOILM',
    name: 'Crude Oil Mini',
    ltp: 5452,
    change: 30,
    changePct: 0.55,
    bias: 'mild-bull',
    dayTrend: 'bullish',
  });
  assert.equal(sample.sample, true);
  assert.match(sample.classificationLabel, /sample/i);
  assert.match(sample.explanation.supporting[0], /sample|DEMO/i);
});

test('insufficient candles stay insufficient instead of inventing a trend', () => {
  const out = analyzeBehaviour({
    candles15: series(8, 100, 1, T0),
    candles60: [],
    candlesDay: [],
    candles5: [],
    settings: DEFAULTS,
    now: NOW,
    symbol: 'SENSEX',
    name: 'SENSEX',
    ltp: 108,
  });
  assert.equal(out.classification, 'insufficient');
  assert.equal(out.nodeLabel, 'WAIT');
  assert.equal(out.flow, 'wait');
  assert.equal(out.confirmed, false);
});
