'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  backtestStock,
  selectDeskTrades,
  runOrbBacktest,
  groupByDay,
  barsFromCandles,
  aggregate15,
  clampConfig,
  toMin,
  filterByCrowd,
  dayCrowdFromCrosses,
} = require('./engine');
const { NIFTY_500 } = require('./universe');

function bar(day, hm, o, h, l, c, v = 1000) {
  return { t: hm, day, o, h, l, c, v };
}

function fmt(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function sessionBars(day, overlay = {}, rest = { o: 101, h: 101.2, l: 100.8, c: 101.05, v: 800 }) {
  const bars = [];
  for (let m = toMin('09:15'); m <= toMin('15:15'); m += 5) {
    const hm = fmt(m);
    if (overlay[hm]) {
      bars.push({ t: hm, day, v: 1000, ...overlay[hm] });
    } else {
      bars.push({ t: hm, day, v: rest.v || 800, ...rest });
    }
  }
  return bars;
}

/** First 15m high 102 / low 99.8. Next 15m fully closes at 103 (> 102). Two red 5m lows, then green. */
function longSetup(day) {
  return sessionBars(
    day,
    {
      '09:15': { o: 100, h: 101.2, l: 99.8, c: 100.6 },
      '09:20': { o: 100.6, h: 101.8, l: 100.4, c: 101.4 },
      '09:25': { o: 101.4, h: 102, l: 101.2, c: 101.7 },
      '09:30': { o: 101.8, h: 102.6, l: 101.7, c: 102.4 },
      '09:35': { o: 102.4, h: 102.9, l: 102.2, c: 102.7 },
      '09:40': { o: 102.7, h: 103.4, l: 102.5, c: 103.1 },
      '09:45': { o: 103.1, h: 103.2, l: 102.4, c: 102.5 },
      '09:50': { o: 102.5, h: 102.6, l: 101.9, c: 102.0 },
      '09:55': { o: 102.0, h: 103.0, l: 101.85, c: 102.8 },
      '10:00': { o: 102.9, h: 103.6, l: 102.7, c: 103.4 },
      '10:30': { o: 103.4, h: 104.8, l: 103.2, c: 104.5 },
      '11:00': { o: 104.5, h: 105.2, l: 104.3, c: 105.0 },
      '15:15': { o: 104.8, h: 105.0, l: 104.4, c: 104.7 },
    },
    { o: 104.2, h: 104.6, l: 103.9, c: 104.3, v: 800 },
  );
}

test('Nifty 500 universe has about 500 equity symbols', () => {
  assert.ok(NIFTY_500.length >= 490);
  assert.ok(NIFTY_500.includes('RELIANCE'));
  assert.ok(NIFTY_500.includes('TCS'));
});

test('aggregate15 builds the first 09:15–09:30 candle from three 5-minute bars', () => {
  const day = '2026-10-16';
  const bars15 = aggregate15(longSetup(day));
  assert.equal(bars15[0].t, '09:15');
  assert.equal(bars15[0].h, 102);
  assert.equal(bars15[0].l, 99.8);
  assert.equal(bars15[1].t, '09:30');
  assert.equal(bars15[1].c, 103.1);
  assert.ok(bars15[1].c > bars15[0].h);
});

test('15-minute full close then two 5-minute lows and a green candle sets entry at green high and SL at green low', () => {
  const day = '2026-10-16';
  const { trades, crosses } = backtestStock(
    'AAA',
    { [day]: longSetup(day) },
    clampConfig({ capital: 40000, maxStocksPerDay: 3 }),
  );
  assert.equal(crosses.length, 1);
  assert.equal(crosses[0].side, 'L');
  assert.equal(crosses[0].orh, 102);
  assert.ok(crosses[0].close > 102);
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.equal(t.side, 'L');
  assert.equal(t.stopPx, 101.85);
  assert.ok(t.entryPx >= 103);
  assert.equal(t.exitReason, 'EOD');
  assert.ok(t.maxWentRs > 0);
  assert.ok((t.marks || []).some((m) => m.t === '10:30'));
});

test('a 15-minute wick above the first-15 high without a full close is not a cross', () => {
  const day = '2026-10-16';
  const bars = sessionBars(day, {
    '09:15': { o: 100, h: 101.2, l: 99.8, c: 100.6 },
    '09:20': { o: 100.6, h: 101.8, l: 100.4, c: 101.4 },
    '09:25': { o: 101.4, h: 102, l: 101.2, c: 101.7 },
    '09:30': { o: 101.6, h: 102.8, l: 101.4, c: 101.5 },
    '09:35': { o: 101.5, h: 101.7, l: 101.3, c: 101.4 },
    '09:40': { o: 101.4, h: 101.6, l: 101.2, c: 101.3 },
  });
  const { trades, crosses } = backtestStock('WICK', { [day]: bars }, clampConfig({}));
  assert.equal(crosses.length, 0);
  assert.equal(trades.length, 0);
});

test('SL hit closes the whole trade and keeps max amount went', () => {
  const day = '2026-10-16';
  const bars = sessionBars(day, {
    '09:15': { o: 100, h: 101.2, l: 99.8, c: 100.6 },
    '09:20': { o: 100.6, h: 101.8, l: 100.4, c: 101.4 },
    '09:25': { o: 101.4, h: 102, l: 101.2, c: 101.7 },
    '09:30': { o: 101.8, h: 102.6, l: 101.7, c: 102.4 },
    '09:35': { o: 102.4, h: 102.9, l: 102.2, c: 102.7 },
    '09:40': { o: 102.7, h: 103.4, l: 102.5, c: 103.1 },
    '09:45': { o: 103.1, h: 103.2, l: 102.4, c: 102.5 },
    '09:50': { o: 102.5, h: 102.6, l: 101.9, c: 102.0 },
    '09:55': { o: 102.0, h: 103.0, l: 101.85, c: 102.8 },
    '10:00': { o: 102.9, h: 104.0, l: 101.5, c: 101.6 },
  });
  const { trades } = backtestStock('SLN', { [day]: bars }, clampConfig({}));
  assert.equal(trades.length, 1);
  assert.equal(trades[0].exitReason, 'SL');
  assert.equal(trades[0].exitPx, 101.85);
  assert.ok(trades[0].maxWentRs > 0);
});

test('desk keeps at most N stocks per day and never places a live order flag', () => {
  const trades = [
    { symbol: 'A', day: '2026-10-16', entryT: '10:00', exitT: '10:20', netRs: 100 },
    { symbol: 'B', day: '2026-10-16', entryT: '10:05', exitT: '10:25', netRs: 80 },
    { symbol: 'C', day: '2026-10-16', entryT: '10:40', exitT: '11:00', netRs: 40 },
  ];
  const desk = selectDeskTrades(trades, { maxStocksPerDay: 2, cooldownMin: 15 });
  assert.equal(desk.length, 2);
  assert.deepEqual(
    desk.map((t) => t.symbol),
    ['A', 'C'],
  );
  const out = runOrbBacktest({
    symbolBars: { AAA: { '2026-10-16': longSetup('2026-10-16') } },
    config: { capital: 40000, maxStocksPerDay: 3 },
  });
  assert.equal(out.simulated, true);
  assert.equal(out.liveOrders, false);
  assert.equal(out.crosses.length, 1);
  assert.equal(out.crosses[0].taken, true);
  assert.equal(out.summary.orbCrossed, 1);
  assert.equal(out.config.timeExit, '15:15');
  assert.ok(out.summary.snapshots.length >= 12);
  assert.equal(out.summary.snapshots[out.summary.snapshots.length - 1].label, 'EOD');
  assert.ok(out.summary.maxWentRs > 0);
});

test('clampConfig keeps capital and max stocks and does not mark the book live', () => {
  const cfg = clampConfig({ capital: 100000, maxStocksPerDay: 5, targetR: 3 });
  assert.equal(cfg.capital, 100000);
  assert.equal(cfg.maxStocksPerDay, 5);
  assert.equal(cfg.orEnd, '09:30');
  assert.equal(cfg.timeExit, '15:15');
  const out = runOrbBacktest({ symbolBars: {}, config: cfg });
  assert.equal(out.summary.trades, 0);
  assert.equal(out.simulated, true);
  assert.equal(out.liveOrders, false);
});

test('15-minute full close is listed even when the 5-minute two-low pattern never prints', () => {
  const day = '2026-10-16';
  const bars = sessionBars(day, {
    '09:15': { o: 100, h: 101.2, l: 99.8, c: 100.6 },
    '09:20': { o: 100.6, h: 101.8, l: 100.4, c: 101.4 },
    '09:25': { o: 101.4, h: 102, l: 101.2, c: 101.7 },
    '09:30': { o: 101.8, h: 102.6, l: 101.7, c: 102.4 },
    '09:35': { o: 102.4, h: 102.9, l: 102.2, c: 102.7 },
    '09:40': { o: 102.7, h: 103.4, l: 102.5, c: 103.1 },
  });
  const out = runOrbBacktest({
    symbolBars: { BBB: { [day]: bars } },
    config: { capital: 40000, maxStocksPerDay: 3 },
  });
  assert.equal(out.trades.length, 0);
  assert.equal(out.crosses.length, 1);
  assert.equal(out.crosses[0].symbol, 'BBB');
  assert.equal(out.crosses[0].side, 'L');
  assert.equal(out.crosses[0].qualified, false);
  assert.equal(out.crosses[0].taken, false);
  assert.equal(out.summary.orbCrossed, 1);
  assert.equal(out.summary.orbCrossedTaken, 0);
});

test('stopPct ranking takes the widest signal-candle stop first, not the earliest fill', () => {
  const trades = [
    { symbol: 'TIGHT', day: '2026-10-16', side: 'L', entryT: '10:00', exitT: '15:15', entryPx: 100, stopPx: 99.8, netRs: 1 },
    { symbol: 'WIDE', day: '2026-10-16', side: 'L', entryT: '10:05', exitT: '15:15', entryPx: 100, stopPx: 98.5, netRs: 1 },
  ];
  const desk = selectDeskTrades(trades, { maxStocksPerDay: 1, rankBy: 'stopPct', cooldownMin: 0 });
  assert.equal(desk.length, 1);
  assert.equal(desk[0].symbol, 'WIDE');
});

test('skipShort crowd filter drops a day whose 09:45 closes are mostly short', () => {
  const crosses = [
    { symbol: 'A', day: '2026-10-16', side: 'S', t: '09:45' },
    { symbol: 'B', day: '2026-10-16', side: 'S', t: '09:45' },
    { symbol: 'C', day: '2026-10-16', side: 'S', t: '09:45' },
    { symbol: 'D', day: '2026-10-16', side: 'L', t: '09:45' },
    { symbol: 'E', day: '2026-10-17', side: 'L', t: '09:45' },
    { symbol: 'F', day: '2026-10-17', side: 'L', t: '09:45' },
  ];
  const crowd = dayCrowdFromCrosses(crosses);
  assert.equal(crowd['2026-10-16'], 'S');
  assert.equal(crowd['2026-10-17'], 'L');
  const trades = [
    { symbol: 'A', day: '2026-10-16', side: 'S', netRs: 10 },
    { symbol: 'E', day: '2026-10-17', side: 'L', netRs: 10 },
  ];
  const kept = filterByCrowd(trades, crowd, 'skipShort');
  assert.deepEqual(
    kept.map((t) => t.symbol),
    ['E'],
  );
});

test('barsFromCandles drop pre-open prints', () => {
  const bars = barsFromCandles([
    { date: '2026-10-16T03:30:00+05:30', open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { date: '2026-10-16T09:15:00+05:30', open: 10, high: 11, low: 9, close: 10, volume: 1 },
  ]);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].t, '09:15');
  assert.equal(Object.keys(groupByDay(bars))[0], '2026-10-16');
});
