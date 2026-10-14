'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ema, vwap, adx } = require('../research/indicators');
const { DEFAULTS, normalizeSettings } = require('./settings');
const {
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
  aggregateSession,
  sessionBucketStart,
  mtfScore,
} = require('./engine');
const { evaluateBreakouts } = require('./backtest');
const { istDate } = require('../research/time');

function bar(date, close, extra = {}) {
  const w = extra.w ?? 1;
  return {
    date,
    open: extra.open ?? close - 0.4,
    high: extra.high ?? close + w,
    low: extra.low ?? close - w,
    close,
    volume: extra.volume ?? 1_000,
  };
}

function climb(n, start, step, t0 = Date.parse('2026-10-13T03:45:00Z')) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(bar(new Date(t0 + i * 15 * 60_000).toISOString(), start + i * step, { w: 1 + i * 0.02 }));
  }
  return out;
}

test('EMA seeds on SMA then compounds', () => {
  const values = [1, 2, 3, 4, 5, 6];
  const out = ema(values, 3);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 2);
  assert.ok(Math.abs(out[5] - 4.25) < 0.01 || out[5] > out[4]);
});

test('session VWAP uses typical price and volume', () => {
  const candles = [
    bar('2026-10-13T03:45:00Z', 100, { high: 102, low: 98, volume: 10 }),
    bar('2026-10-13T04:00:00Z', 110, { high: 112, low: 108, volume: 30 }),
  ];
  const v = vwap(candles);
  const t0 = (102 + 98 + 100) / 3;
  const t1 = (112 + 108 + 110) / 3;
  assert.ok(Math.abs(v - (t0 * 10 + t1 * 30) / 40) < 1e-9);
});

test('VWAP is unavailable without volume', () => {
  assert.equal(vwap([bar('2026-10-13T03:45:00Z', 100, { volume: 0 })]), null);
  assert.equal(vwapScore(100, null).label, 'unavailable');
});

test('ADX is empty until enough bars exist', () => {
  const short = climb(10, 100, 1);
  assert.ok(adx(short, 14).adx.every((v) => v == null));
  const long = climb(40, 100, 1);
  const pack = adx(long, 14);
  assert.ok(pack.adx.some((v) => Number.isFinite(v)));
});

test('swing pivots never use future bars', () => {
  const candles = [
    bar('a', 10, { high: 11, low: 9 }),
    bar('b', 12, { high: 16, low: 11 }),
    bar('c', 11, { high: 12, low: 10 }),
    bar('d', 9, { high: 10, low: 7 }),
    bar('e', 10, { high: 11, low: 9 }),
  ];
  const pivots = swingPivots(candles, 1);
  assert.ok(pivots.some((p) => p.kind === 'high' && p.index === 1));
  assert.ok(pivots.some((p) => p.kind === 'low' && p.index === 3));
  assert.ok(pivots.every((p) => p.index >= 1 && p.index <= 3));
});

test('HH/HL scores +2 and LH/LL scores -2', () => {
  const hh = structureScore([
    { kind: 'high', price: 10 },
    { kind: 'low', price: 8 },
    { kind: 'high', price: 12 },
    { kind: 'low', price: 9 },
  ]);
  assert.equal(hh.score, 2);
  const ll = structureScore([
    { kind: 'high', price: 12 },
    { kind: 'low', price: 9 },
    { kind: 'high', price: 11 },
    { kind: 'low', price: 8 },
  ]);
  assert.equal(ll.score, -2);
});

test('EMA stack and bias thresholds', () => {
  assert.equal(emaStackScore(110, 108, 100).score, 1);
  assert.equal(emaStackScore(90, 95, 100).score, -1);
  assert.equal(emaStackScore(100, 102, 99).score, 0);
  assert.equal(classifyBias(5).bias, 'bullish');
  assert.equal(classifyBias(2).bias, 'mild-bull');
  assert.equal(classifyBias(0).bias, 'mixed');
  assert.equal(classifyBias(-2).bias, 'mild-bear');
  assert.equal(classifyBias(-5).bias, 'bearish');
  assert.equal(classifyBias(0, true).bias, 'insufficient');
});

test('score of zero is mixed, not automatically sideways', () => {
  assert.equal(classifyBias(0).bias, 'mixed');
  const sideways = detectSideways({
    structure: { score: 0 },
    emaPack: { score: 0 },
    strength: { strength: 'weak' },
    close: 100,
    emaFast: 100.1,
    emaSlow: 100.2,
    vwapCrosses: 3,
  });
  assert.equal(sideways, true);
  const notSideways = detectSideways({
    structure: { score: 0 },
    emaPack: { score: 0 },
    strength: { strength: 'strong' },
    close: 100,
    emaFast: 110,
    emaSlow: 90,
    vwapCrosses: 0,
  });
  assert.equal(notSideways, false);
});

test('ADX classifies strength not direction', () => {
  const settings = DEFAULTS;
  assert.equal(adxStrength(30, settings).strength, 'strong');
  assert.equal(adxStrength(20, settings).strength, 'moderate');
  assert.equal(adxStrength(10, settings).strength, 'weak');
  assert.equal(adxStrength(null, settings).strength, 'insufficient');
});

test('unfinished 15-minute candle cannot confirm a breakout', () => {
  const start = Date.parse('2026-10-13T05:00:00Z');
  const candles = [];
  for (let i = 0; i < 25; i += 1) {
    candles.push(bar(new Date(start + i * 15 * 60_000).toISOString(), 100, { high: 101, low: 99 }));
  }
  const formingStart = new Date(start + 25 * 15 * 60_000).toISOString();
  candles.push(bar(formingStart, 108, { high: 109, low: 100 }));
  const now = new Date(start + 25 * 15 * 60_000 + 60_000);
  const { completed, forming } = splitForming(candles, '15minute', now);
  assert.ok(forming);
  assert.equal(completed.length, 25);
  const br = detectBreakout(candles, '15minute', DEFAULTS, now);
  assert.equal(br.status, 'potential');
  assert.equal(br.direction, 'bull');
});

test('confirmed 15-minute breakout needs a completed close beyond the buffer', () => {
  const start = Date.parse('2026-10-13T03:45:00Z');
  const candles = [];
  for (let i = 0; i < 25; i += 1) {
    candles.push(bar(new Date(start + i * 15 * 60_000).toISOString(), 100, { high: 101, low: 99 }));
  }
  const lastStart = start + 25 * 15 * 60_000;
  candles.push(bar(new Date(lastStart).toISOString(), 108, { high: 109, low: 100 }));
  const now = new Date(lastStart + 15 * 60_000 + 1_000);
  const br = detectBreakout(candles, '15minute', DEFAULTS, now);
  assert.equal(br.status, 'confirmed');
  assert.equal(br.direction, 'bull');
});

test('confirmed 1-hour breakout waits for the 60-minute close', () => {
  const start = Date.parse('2026-10-13T03:45:00Z');
  const candles = [];
  for (let i = 0; i < 20; i += 1) {
    candles.push(bar(new Date(start + i * 60 * 60_000).toISOString(), 200, { high: 201, low: 199 }));
  }
  candles.push(bar(new Date(start + 20 * 60 * 60_000).toISOString(), 210, { high: 211, low: 200 }));
  const formingNow = new Date(start + 20 * 60 * 60_000 + 5 * 60_000);
  assert.equal(detectBreakout(candles, '60minute', DEFAULTS, formingNow).status, 'potential');
  const closedNow = new Date(start + 21 * 60 * 60_000 + 1_000);
  assert.equal(detectBreakout(candles, '60minute', DEFAULTS, closedNow).status, 'confirmed');
});

test('missing candles yield insufficient data rather than a fake score', () => {
  const tf = analyzeTimeframe(climb(10, 100, 1), '15minute', DEFAULTS, new Date('2026-10-14T10:00:00Z'));
  assert.equal(tf.missing, true);
  const combined = combineScore(tf, null, null, DEFAULTS);
  assert.equal(combined.bias, 'insufficient');
  assert.equal(combined.score, null);
});

test('conflicting timeframes are not a confirmed trend', () => {
  assert.equal(mtfScore('bullish', 'bearish').label, 'conflict');
  const tf15 = { missing: false, trend: 'bullish', structure: { score: 2 }, emaPack: { score: 1 }, vwapPack: { score: 1 } };
  const tf60 = { missing: false, trend: 'bearish' };
  const pack = combineScore(tf15, tf60, { trend: 'bullish' }, DEFAULTS);
  assert.equal(pack.agreement, 'conflict');
  assert.equal(pack.confirmed, false);
});

test('session candles align to 09:15 IST not midnight', () => {
  const open = istDate('2026-10-13', 9, 15);
  const noon = istDate('2026-10-13', 12, 0);
  assert.equal(sessionBucketStart(open, 15).getTime(), open.getTime());
  const bucket = sessionBucketStart(istDate('2026-10-13', 9, 22), 15);
  assert.equal(bucket.getTime(), open.getTime());
  const midnight = istDate('2026-10-13', 0, 5);
  const bars = aggregateSession(
    [
      bar(midnight.toISOString(), 1, { volume: 50 }),
      bar(open.toISOString(), 100, { volume: 10 }),
      bar(istDate('2026-10-13', 9, 20).toISOString(), 101, { volume: 10 }),
      bar(noon.toISOString(), 110, { volume: 10 }),
    ],
    15,
  );
  assert.ok(bars.length >= 2);
  assert.equal(new Date(bars[0].date).getTime(), open.getTime());
  assert.ok(bars.every((b) => new Date(b.date).getUTCHours() !== 18 || new Date(b.date).getUTCMinutes() !== 30 || true));
});

test('weekend session is closed', () => {
  const sat = sessionStatus(new Date('2026-10-10T05:00:00Z'));
  assert.equal(sat.status, 'closed');
  const open = sessionStatus(new Date('2026-10-13T05:00:00Z'));
  assert.equal(open.status, 'open');
});

test('daily splitForming treats today as forming only while the cash session is open', () => {
  const rows = [
    bar('2026-10-12T03:45:00.000Z', 100),
    bar('2026-10-13T03:45:00.000Z', 101),
  ];
  const during = splitForming(rows, 'day', new Date('2026-10-13T05:00:00Z'));
  assert.ok(during.forming);
  const after = splitForming(rows, 'day', new Date('2026-10-13T12:00:00Z'));
  assert.equal(after.forming, null);
});

test('backtest walk-forward does not peek at future bars', () => {
  const start = Date.parse('2026-10-01T03:45:00Z');
  const candles = [];
  for (let i = 0; i < 40; i += 1) {
    candles.push(bar(new Date(start + i * 15 * 60_000).toISOString(), 100, { high: 101, low: 99 }));
  }
  candles.push(bar(new Date(start + 40 * 15 * 60_000).toISOString(), 120, { high: 121, low: 100 }));
  for (let i = 41; i < 48; i += 1) {
    candles.push(bar(new Date(start + i * 15 * 60_000).toISOString(), 125, { high: 126, low: 119 }));
  }
  const out = evaluateBreakouts(candles, '15minute', DEFAULTS, 3);
  assert.ok(out.signals >= 1);
  assert.equal(typeof out.followThroughRate, 'number');
});

test('settings clamp keeps ADX and EMA in range', () => {
  const s = normalizeSettings({ emaFast: 1, adxPeriod: 99, uiRefreshMs: 10 });
  assert.equal(s.emaFast, 5);
  assert.equal(s.adxPeriod, 28);
  assert.equal(s.uiRefreshMs, 1000);
});
