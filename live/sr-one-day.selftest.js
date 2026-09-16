'use strict';
/**
 * Trade Bot DNA: up to two directional ATM options per book per day.
 * TIME 6 flattens the August session-hold losers. FAIL stays off.
 * TARGET stays 0. Stall give-up bar 4 / +12. Bank has a rupee stop.
 */
const assert = require('assert');
const { runSrBreakout } = require('./sr-breakout');
const {
  EXIT_RULES, CUT_LOSS_RS, OPTION_SL_MAX_RS, exitOptsFor, MAX_TRADES_PER_DAY, STRATEGY_VERSION,
} = require('./sr-strategy-config');
const { SPEC } = require('./sr-live');

assert.strictEqual(STRATEGY_VERSION, 'sr-breakout.2026-09-16.9');
assert.strictEqual(EXIT_RULES.nifty.structureExit, false);
assert.strictEqual(EXIT_RULES.banknifty.structureExit, false);
assert.strictEqual(EXIT_RULES.nifty.minStructurePts, 0);
assert.strictEqual(EXIT_RULES.banknifty.minStructurePts, 0);
assert.strictEqual(MAX_TRADES_PER_DAY, 2);
assert.strictEqual(EXIT_RULES.nifty.failStop, false);
assert.strictEqual(EXIT_RULES.nifty.timeStopBars, 6);
assert.strictEqual(EXIT_RULES.nifty.minScore, 1);
assert.strictEqual(EXIT_RULES.nifty.giveUpBar, 4);
assert.strictEqual(EXIT_RULES.nifty.giveUpMinPts, 12);
assert.strictEqual(EXIT_RULES.nifty.targetByScore[1], 0);
assert.strictEqual(EXIT_RULES.banknifty.failStop, false);
assert.strictEqual(EXIT_RULES.banknifty.timeStopBars, 8);
assert.strictEqual(EXIT_RULES.banknifty.giveUpBar, 4);
assert.strictEqual(EXIT_RULES.banknifty.giveUpMinPts, 12);
assert.strictEqual(EXIT_RULES.banknifty.sessionAlign, true);
assert.ok(!EXIT_RULES.nifty.sessionAlign);
assert.strictEqual(CUT_LOSS_RS.banknifty, 3500);
assert.strictEqual(OPTION_SL_MAX_RS.banknifty, 3500);
assert.ok(exitOptsFor('banknifty').stopPts > 0);
assert.deepStrictEqual(SPEC.nifty.opts, exitOptsFor('nifty'));
assert.deepStrictEqual(SPEC.banknifty.opts, exitOptsFor('banknifty'));
assert.strictEqual(EXIT_RULES.nifty.retest, true);
assert.strictEqual(EXIT_RULES.banknifty.retest, true);
assert.strictEqual(EXIT_RULES.nifty.confirm, 'retest');
assert.strictEqual(EXIT_RULES.banknifty.confirm, 'retest');
assert.strictEqual(EXIT_RULES.nifty.confirmAfterBreakout, true);
assert.strictEqual(EXIT_RULES.banknifty.confirmAfterBreakout, true);
assert.strictEqual(EXIT_RULES.nifty.maxRetestBars, 2);
assert.strictEqual(EXIT_RULES.banknifty.maxRetestBars, 2);

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
function driftDay(iso, start, drift) {
  let px = start;
  return sessionBars(iso, () => {
    const o = px;
    const c = px + drift;
    px = c;
    return { o, c, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4 };
  });
}

const bars = [];
for (let d = 1; d <= 8; d++) {
  bars.push(...driftDay(`2026-08-${String(d).padStart(2, '0')}`, 23680, 0.05));
}
const iso = '2026-08-11';

function failPx(min) {
  if (min < 11 * 60 + 15) {
    const px = 23555 + (min % 15) * 0.1;
    return { o: px, c: px - 0.3, h: px + 2, l: px - 3 };
  }
  if (min === 11 * 60 + 15) return { o: 23550, c: 23495, h: 23552, l: 23490 };
  if (min === 11 * 60 + 20) return { o: 23495, c: 23488, h: 23498, l: 23485 };
  if (min === 11 * 60 + 25) return { o: 23488, c: 23520, h: 23580, l: 23484 };
  if (min === 11 * 60 + 30) return { o: 23518, c: 23570, h: 23575, l: 23510 };
  const n = Math.floor((min - (11 * 60 + 35)) / 5);
  const c = 23490 - n * 3;
  return { o: c + 2, c, h: c + 4, l: c - 2 };
}

const base = {
  entryPts: 27, trendBars: 20, gapLo: 0, gapHi: 1e9,
  maxTradesPerDay: MAX_TRADES_PER_DAY, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
  wallMode: 'intraday', retest: true, maxRetestBars: 2, minScore: 0,
};

const day = bars.concat(sessionBars(iso, failPx));
const scratched = runSrBreakout(day, {
  ...base, maxTradesPerDay: 3, timeStopBars: 6, failStop: true,
  targetByScore: { 1: 0, 2: 0, 3: 0 },
});
const held = runSrBreakout(day, { ...base, ...exitOptsFor('nifty') });

assert.ok(scratched.trades.length >= 1);
assert.strictEqual(scratched.trades[0].exitReason, 'FAIL',
  `old DNA must FAIL the 11:30 wall close, got ${scratched.trades[0].exitReason}`);
assert.ok(scratched.trades[0].exitTime <= '11:35',
  `FAIL should be minutes after fill, got ${scratched.trades[0].exitTime}`);

assert.ok(held.trades.length >= 1);
assert.notStrictEqual(held.trades[0].exitReason, 'FAIL',
  `new DNA must not FAIL-scratch, got ${held.trades[0].exitReason} @ ${held.trades[0].exitTime}`);
assert.ok(held.trades[0].exitReason === 'TIME' || held.trades[0].exitReason === 'GIVEUP',
  `TIME 6 or stall give-up, got ${held.trades[0].exitReason}`);
assert.ok(held.trades.length <= MAX_TRADES_PER_DAY, `max ${MAX_TRADES_PER_DAY}/day, got ${held.trades.length}`);
const outMin = held.trades[0].exitTime.split(':').map(Number);
const inMin = held.trades[0].entryTime.split(':').map(Number);
const heldBars = ((outMin[0] * 60 + outMin[1]) - (inMin[0] * 60 + inMin[1])) / 5;
assert.ok(heldBars <= 6, `TIME 6 must flatten by 6×5m, got ${heldBars} bars (${held.trades[0].entryTime}→${held.trades[0].exitTime})`);

function grindPx(min) {
  if (min < 11 * 60 + 15) {
    const px = 23555 + (min % 15) * 0.1;
    return { o: px, c: px - 0.3, h: px + 2, l: px - 3 };
  }
  if (min === 11 * 60 + 15) return { o: 23550, c: 23495, h: 23552, l: 23490 };
  if (min === 11 * 60 + 20) return { o: 23495, c: 23488, h: 23498, l: 23485 };
  if (min === 11 * 60 + 25) return { o: 23488, c: 23520, h: 23580, l: 23484 };
  const n = Math.floor((min - (11 * 60 + 30)) / 5);
  const c = 23518 - (n + 1) * 2;
  return { o: c + 1, c, h: c + 2, l: c - 8 };
}
const grind = bars.concat(sessionBars(iso, grindPx, 12 * 60 + 30));
const timeSix = runSrBreakout(grind, {
  ...base, maxTradesPerDay: 3, timeStopBars: 6, failStop: false,
  targetByScore: { 1: 0, 2: 0, 3: 0 },
});
const sessionHold = runSrBreakout(grind, { ...base, ...exitOptsFor('nifty') });
assert.strictEqual(timeSix.trades[0].exitReason, 'TIME');
assert.ok(sessionHold.trades[0].exitReason === 'TIME' || sessionHold.trades[0].exitReason === 'GIVEUP',
  `shared DNA is TIME 6 / give-up, got ${sessionHold.trades[0].exitReason}`);
if (sessionHold.trades[0].exitReason === 'TIME') {
  assert.strictEqual(sessionHold.trades[0].exitTime, timeSix.trades[0].exitTime);
}

console.log('sr-one-day.selftest: ok', {
  failOld: { reason: scratched.trades[0].exitReason, out: scratched.trades[0].exitTime, n: scratched.trades.length },
  holdNew: { reason: held.trades[0].exitReason, in: held.trades[0].entryTime, out: held.trades[0].exitTime, n: held.trades.length, bars: heldBars },
  timeSix: { reason: timeSix.trades[0].exitReason, out: timeSix.trades[0].exitTime },
  session: { reason: sessionHold.trades[0].exitReason, out: sessionHold.trades[0].exitTime },
});
