'use strict';
/**
 * Box geometry + Paper desk opts === Live SPEC.opts.
 */
const assert = require('assert');
const { runSrBreakout } = require('./sr-breakout');
const { structureOf, compactSessionBars, chartPayload } = require('./sr-structure');
const { exitOptsFor, MAX_TRADES_PER_DAY, STRATEGY_VERSION } = require('./sr-strategy-config');
const { SPEC, FRESH_MINUTES, mergeStructureOntoLiveTrades } = require('./sr-live');
const { BOOKS, mapTrade } = require('./sr-desk');

assert.strictEqual(STRATEGY_VERSION, 'sr-breakout.2026-09-15.4');
assert.strictEqual(MAX_TRADES_PER_DAY, 1);
assert.strictEqual(FRESH_MINUTES, 20);
assert.deepStrictEqual(SPEC.nifty.opts, exitOptsFor('nifty'), 'Live Nifty opts === Paper exitOptsFor');
assert.deepStrictEqual(SPEC.banknifty.opts, exitOptsFor('banknifty'), 'Live Bank opts === Paper exitOptsFor');
assert.strictEqual(SPEC.nifty.opts.timeStopBars, exitOptsFor('nifty').timeStopBars);
assert.strictEqual(SPEC.nifty.session.squareOffHm, BOOKS.nifty.session.squareOffHm);
assert.strictEqual(SPEC.banknifty.session.entryStartHm, BOOKS.banknifty.session.entryStartHm);
assert.strictEqual(SPEC.nifty.unitsPerLot, BOOKS.nifty.unitsPerLot);
assert.strictEqual(SPEC.banknifty.unitsPerLot, BOOKS.banknifty.unitsPerLot);

const bull = structureOf({
  dir: 1, level: 24100, wallHi: 24100, wallLo: 24020,
  breakLow: 24018, breakHigh: 24140,
  lookFromHm: '10:00', lookToHm: '10:30',
  breakoutTime: '10:45', entryTime: '10:50', exitTime: '13:15',
  entryPrice: 24100, exitPrice: 24185, exitReason: 'STRUCTURE',
});
assert.ok(bull);
assert.strictEqual(bull.wall, 24100);
assert.strictEqual(bull.height, 82);
assert.strictEqual(bull.measuredMove, 24182);
assert.strictEqual(bull.pink.lo, 24018);
assert.strictEqual(bull.pink.hi, 24100);
assert.strictEqual(bull.teal.lo, 24100);
assert.strictEqual(bull.teal.hi, 24182);
assert.strictEqual(bull.entry.price, 24100);
assert.strictEqual(bull.exit.reason, 'STRUCTURE');

const bear = structureOf({
  dir: -1, level: 24600, wallHi: 24680, wallLo: 24600,
  breakHigh: 24690, breakLow: 24540,
  lookFromHm: '09:45', lookToHm: '10:15',
  breakoutTime: '10:30', entryTime: '10:35', exitTime: '14:10',
  entryPrice: 24600, exitPrice: 24510, exitReason: 'CLOSE',
});
assert.ok(bear);
assert.strictEqual(bear.height, 90);
assert.strictEqual(bear.measuredMove, 24510);
assert.strictEqual(bear.pink.hi, 24690);
assert.strictEqual(bear.teal.lo, 24510);

function hmStr(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
function sessionBars(iso, priceAt, untilMin) {
  const out = [];
  const end = untilMin == null ? 15 * 60 + 25 : untilMin;
  for (let min = 9 * 60 + 15; min <= end; min += 5) {
    const px = priceAt(min);
    out.push({ date: `${iso}T${hmStr(min)}:00+05:30`, open: px.o, high: px.h, low: px.l, close: px.c });
  }
  return out;
}

const warmup = [];
for (let d = 1; d <= 8; d++) {
  let px = 24000;
  warmup.push(...sessionBars(`2026-08-${String(d).padStart(2, '0')}`, () => {
    const o = px;
    const c = px + 0.2;
    px = c;
    return { o, c, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5 };
  }));
}
const iso = '2026-08-11';
function structurePx(min) {
  // 80-pt lookback wall 24000–24080, then a clean 10:45 15m close above it.
  if (min < 10 * 60 + 45) {
    const lo = 24000 + (min % 10) * 0.2;
    return { o: lo + 10, c: lo + 12, h: 24080, l: 24000 };
  }
  if (min === 10 * 60 + 45) return { o: 24070, c: 24120, h: 24125, l: 24068 };
  if (min === 10 * 60 + 50) return { o: 24118, c: 24090, h: 24120, l: 24080 };
  if (min === 10 * 60 + 55) return { o: 24090, c: 24110, h: 24115, l: 24085 };
  if (min === 11 * 60) return { o: 24110, c: 24140, h: 24145, l: 24105 };
  if (min === 11 * 60 + 5) return { o: 24140, c: 24170, h: 24180, l: 24135 };
  return { o: 24170, c: 24190, h: 24200, l: 24160 };
}
const day = warmup.concat(sessionBars(iso, structurePx));
const paperOpts = { ...exitOptsFor('nifty'), maxTradesPerDay: MAX_TRADES_PER_DAY };
const liveOpts = { ...SPEC.nifty.opts, maxTradesPerDay: MAX_TRADES_PER_DAY };
assert.deepStrictEqual(paperOpts, liveOpts);

const base = {
  entryPts: 27, trendBars: 20, gapLo: 0, gapHi: 1e9,
  maxTradesPerDay: 1, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
  ...paperOpts,
};
const paperRun = runSrBreakout(day, base);
const liveRun = runSrBreakout(day, { ...base, ...liveOpts });
assert.ok(paperRun.trades.length >= 1, 'wide-wall day must print');
assert.strictEqual(paperRun.trades[0].exitReason, liveRun.trades[0].exitReason);
assert.strictEqual(paperRun.trades[0].exitTime, liveRun.trades[0].exitTime);
assert.strictEqual(paperRun.trades[0].exitReason, 'STRUCTURE');
assert.ok(paperRun.trades[0].structure);
assert.ok(paperRun.trades[0].structure.height >= 40);
assert.strictEqual(paperRun.trades[0].structure.wall, paperRun.trades[0].level);
assert.strictEqual(
  paperRun.trades[0].structure.measuredMove,
  paperRun.trades[0].level + paperRun.trades[0].structure.height,
);

const noStruct = runSrBreakout(day, { ...base, structureExit: false });
assert.notStrictEqual(noStruct.trades[0].exitReason, 'STRUCTURE');
assert.ok(noStruct.trades[0].structure, 'boxes still attach when STRUCTURE exit is off');

const chart = chartPayload(day, paperRun.trades, { id: 'nifty', label: 'Nifty 50' });
assert.ok(chart.days[iso].length > 20);
const compact = compactSessionBars(day, iso);
assert.strictEqual(compact[0].o != null, true);

const mapped = mapTrade(paperRun.trades[0], BOOKS.nifty, 1, 65);
assert.ok(mapped.structure);
assert.strictEqual(mapped.quantity, 65);
assert.strictEqual(mapped.lots, 1);

const merged = mergeStructureOntoLiveTrades(
  [{ instrumentName: 'Nifty 50', instrumentId: 'nifty', entryTime: paperRun.trades[0].entryTime, optionSymbol: 'NIFTY25AUG24100CE' }],
  { books: [{ id: 'nifty', label: 'Nifty 50', trades: paperRun.trades }] },
);
assert.ok(merged[0].structure);
assert.strictEqual(merged[0].structure.wall, paperRun.trades[0].structure.wall);

console.log('sr-structure.selftest: ok', {
  reason: paperRun.trades[0].exitReason,
  in: paperRun.trades[0].entryTime,
  out: paperRun.trades[0].exitTime,
  height: paperRun.trades[0].structure.height,
  wall: paperRun.trades[0].structure.wall,
});
