'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { backtestStock, selectDeskTrades, runOrbBacktest, groupByDay, barsFromCandles, clampConfig } = require('./engine');
const { NIFTY_500 } = require('./universe');

function bar(day, hm, o, h, l, c, v = 1000) {
  return { t: hm, day, o, h, l, c, v };
}

function orDay(day) {
  const bars = [];
  // 09:15–09:45 opening range around 100–102
  bars.push(bar(day, '09:15', 100, 101, 99.8, 100.5, 800));
  bars.push(bar(day, '09:20', 100.5, 101.4, 100.2, 101.1, 900));
  bars.push(bar(day, '09:25', 101.1, 101.8, 100.9, 101.5, 900));
  bars.push(bar(day, '09:30', 101.5, 102, 101.2, 101.7, 950));
  bars.push(bar(day, '09:35', 101.7, 102, 101.4, 101.6, 900));
  bars.push(bar(day, '09:40', 101.6, 101.9, 101.3, 101.5, 850));
  bars.push(bar(day, '09:45', 101.5, 102, 101.2, 101.8, 900));
  // Build EMA20 with quiet bars, then a close above ORH=102
  let px = 101.8;
  for (let m = 50; m < 70; m += 5) {
    const hm = `09:${String(m).padStart(2, '0')}`;
    bars.push(bar(day, hm, px, px + 0.2, px - 0.2, px + 0.05, 2000));
    px += 0.05;
  }
  bars.push(bar(day, '10:10', 101.9, 103.2, 101.8, 103.0, 3000));
  bars.push(bar(day, '10:15', 103.0, 104.5, 102.8, 104.2, 2500));
  bars.push(bar(day, '10:20', 104.2, 105.8, 104.0, 105.5, 2200));
  return bars;
}

test('Nifty 500 universe has about 500 equity symbols', () => {
  assert.ok(NIFTY_500.length >= 490);
  assert.ok(NIFTY_500.includes('RELIANCE'));
  assert.ok(NIFTY_500.includes('TCS'));
});

test('ORB long uses opening-range high and a 1R stop with configurable target', () => {
  const day = '2026-10-16';
  const { trades, crosses } = backtestStock(
    'AAA',
    { [day]: orDay(day) },
    {
      orEnd: '09:45',
      entryStart: '09:50',
      entryEnd: '14:30',
      timeExit: '14:50',
      breakPct: 0.0004,
      volMult: 1.2,
      orMinPct: 0.002,
      orMaxPct: 0.03,
      maxGapPct: 0.02,
      rPctFloor: 0.003,
      rPctCeil: 0.006,
      rPctFromOr: 0.5,
      targetR: 2,
      slippage: 0,
      riskPerTrade: 300,
      buyPower: 200000,
    },
    null,
  );
  assert.ok(trades.length >= 1);
  const t = trades[0];
  assert.equal(t.side, 'L');
  assert.equal(t.day, day);
  assert.ok(t.entryPx > 102);
  assert.ok(t.stopPx < t.entryPx);
  assert.ok(t.exitReason === 'TARGET' || t.exitReason === 'TIME' || t.exitReason === 'SL');
  assert.equal(crosses.length, 1);
  assert.equal(crosses[0].symbol, 'AAA');
  assert.equal(crosses[0].side, 'L');
  assert.equal(crosses[0].t, '10:10');
});

test('desk keeps at most N stocks per day and never places a live order flag', () => {
  const trades = [
    { symbol: 'A', day: '2026-10-16', entryT: '10:00', exitT: '10:20', netRs: 100 },
    { symbol: 'B', day: '2026-10-16', entryT: '10:05', exitT: '10:25', netRs: 80 },
    { symbol: 'C', day: '2026-10-16', entryT: '10:40', exitT: '11:00', netRs: 40 },
  ];
  const desk = selectDeskTrades(trades, { maxStocksPerDay: 2, cooldownMin: 15 });
  assert.equal(desk.length, 2);
  assert.deepEqual(desk.map((t) => t.symbol), ['A', 'C']);
  const out = runOrbBacktest({
    symbolBars: { AAA: { '2026-10-16': orDay('2026-10-16') } },
    config: { capital: 40000, maxStocksPerDay: 3, targetR: 2 },
  });
  assert.equal(out.simulated, true);
  assert.equal(out.liveOrders, false);
  assert.equal(out.crosses.length, 1);
  assert.equal(out.crosses[0].taken, true);
  assert.equal(out.summary.orbCrossed, 1);
});

test('clampConfig keeps target R configurable and never marks the book live', () => {
  const cfg = clampConfig({ capital: 100000, maxStocksPerDay: 5, targetR: 3 });
  assert.equal(cfg.capital, 100000);
  assert.equal(cfg.maxStocksPerDay, 5);
  assert.equal(cfg.targetR, 3);
  assert.equal(cfg.orEnd, '09:45');
  assert.equal(cfg.entryStart, '09:50');
  const out = runOrbBacktest({ symbolBars: {}, config: cfg });
  assert.equal(out.summary.trades, 0);
  assert.equal(out.simulated, true);
  assert.equal(out.liveOrders, false);
});

test('ORB crossed list includes a close-through even when volume blocks the trade', () => {
  const day = '2026-10-16';
  const bars = orDay(day).map((b) => (b.t === '10:10' ? { ...b, v: 10 } : b));
  const out = runOrbBacktest({
    symbolBars: { BBB: { [day]: bars } },
    config: { capital: 40000, maxStocksPerDay: 3, targetR: 2 },
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

test('barsFromCandles drop pre-open prints', () => {
  const bars = barsFromCandles([
    { date: '2026-10-16T03:30:00+05:30', open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { date: '2026-10-16T09:15:00+05:30', open: 10, high: 11, low: 9, close: 10, volume: 1 },
  ]);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].t, '09:15');
  assert.equal(Object.keys(groupByDay(bars))[0], '2026-10-16');
});
