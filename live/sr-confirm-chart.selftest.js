'use strict';
/**
 * Confirm-before-enter (retest) + shared Paper/Live chart payload.
 */
const assert = require('assert');
const { runSrBreakout } = require('./sr-breakout');
const { bookChartPayload } = require('./sr-structure');
const { EXIT_RULES, exitOptsFor, STRATEGY_VERSION } = require('./sr-strategy-config');
const { SPEC } = require('./sr-live');
const { BOOKS, mapTrade } = require('./sr-desk');

assert.strictEqual(STRATEGY_VERSION, 'sr-breakout.2026-09-17.1');
assert.strictEqual(EXIT_RULES.nifty.retest, true);
assert.strictEqual(EXIT_RULES.banknifty.retest, true);
assert.strictEqual(EXIT_RULES.nifty.confirm, 'retest');
assert.strictEqual(EXIT_RULES.banknifty.confirm, 'retest');
assert.strictEqual(EXIT_RULES.nifty.confirmAfterBreakout, true);
assert.strictEqual(EXIT_RULES.banknifty.confirmAfterBreakout, true);
assert.deepStrictEqual(SPEC.nifty.opts, exitOptsFor('nifty'));
assert.deepStrictEqual(SPEC.banknifty.opts, exitOptsFor('banknifty'));
assert.strictEqual(SPEC.nifty.opts.retest, true);
assert.strictEqual(SPEC.banknifty.opts.retest, true);

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
function withRetestPx(min) {
  if (min < 10 * 60 + 45) {
    const lo = 24000 + (min % 10) * 0.2;
    return { o: lo + 10, c: lo + 12, h: 24080, l: 24000 };
  }
  if (min === 10 * 60 + 45) return { o: 24070, c: 24120, h: 24125, l: 24090 };
  if (min === 10 * 60 + 50) return { o: 24118, c: 24110, h: 24122, l: 24095 };
  if (min === 10 * 60 + 55) return { o: 24110, c: 24130, h: 24135, l: 24100 };
  if (min === 11 * 60) return { o: 24125, c: 24115, h: 24130, l: 24080 };
  if (min === 11 * 60 + 5) return { o: 24115, c: 24170, h: 24180, l: 24110 };
  return { o: 24170, c: 24190, h: 24200, l: 24160 };
}
function noRetestPx(min) {
  if (min < 10 * 60 + 45) {
    const lo = 24000 + (min % 10) * 0.2;
    return { o: lo + 10, c: lo + 12, h: 24080, l: 24000 };
  }
  // Breakout 15m close, then price never comes back to 24080 within 2 bars.
  if (min === 10 * 60 + 45) return { o: 24070, c: 24120, h: 24125, l: 24090 };
  if (min === 10 * 60 + 50) return { o: 24120, c: 24140, h: 24150, l: 24110 };
  if (min === 10 * 60 + 55) return { o: 24140, c: 24155, h: 24160, l: 24130 };
  return { o: 24160, c: 24180, h: 24190, l: 24150 };
}

const retestDay = warmup.concat(sessionBars(iso, withRetestPx));
const noRetestDay = warmup.concat(sessionBars(iso, noRetestPx));
const base = {
  entryPts: 27, trendBars: 20, gapLo: 0, gapHi: 1e9,
  maxTradesPerDay: 1, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
};

const paperNifty = runSrBreakout(retestDay, { ...base, ...exitOptsFor('nifty') });
const liveNifty = runSrBreakout(retestDay, { ...base, ...SPEC.nifty.opts });
assert.ok(paperNifty.trades.length >= 1, 'retest day must print');
assert.strictEqual(paperNifty.trades.length, liveNifty.trades.length);
const t = paperNifty.trades[0];
assert.ok(t.breakoutTime, 'breakoutTime is first-class');
assert.ok(t.confirmationTime, 'confirmationTime is first-class');
assert.ok(t.retestTime);
assert.strictEqual(t.confirmationTime, t.retestTime);
assert.strictEqual(t.entryTime, t.confirmationTime);
assert.notStrictEqual(t.entryTime, t.breakoutTime, 'must not enter on the breakout bar');
assert.ok(t.entryTime > t.breakoutTime);
assert.ok(t.breakoutPrice > t.level);
assert.strictEqual(t.option, 'CE');
assert.ok(t.structure.breakout);
assert.ok(t.structure.confirm);
assert.strictEqual(t.structure.support, t.wallLo);
assert.strictEqual(t.structure.resistance, t.wallHi);

const rawBreakout = runSrBreakout(retestDay, { ...base, ...exitOptsFor('nifty'), retest: false, confirmAfterBreakout: false, maxRetestBars: 0 });
assert.ok(rawBreakout.trades.length >= 1);
assert.strictEqual(rawBreakout.trades[0].entryTime, rawBreakout.trades[0].breakoutTime);
assert.ok(!rawBreakout.trades[0].confirmationTime);

const skipped = runSrBreakout(noRetestDay, { ...base, ...exitOptsFor('nifty'), squareOffHm: '10:55' });
assert.strictEqual(skipped.trades.length, 0, 'no confirm (retest) → no entry');
const wouldEnterRawCut = runSrBreakout(noRetestDay, {
  ...base, ...exitOptsFor('nifty'), retest: false, maxRetestBars: 0, confirmAfterBreakout: false, squareOffHm: '10:55',
});
assert.ok(wouldEnterRawCut.trades.length >= 1, 'same day enters if confirm is off');

const paperBank = runSrBreakout(retestDay, { ...base, ...exitOptsFor('banknifty'), sessionAlign: false });
const liveBank = runSrBreakout(retestDay, { ...base, ...SPEC.banknifty.opts, sessionAlign: false });
assert.ok(paperBank.trades.length >= 1);
assert.notStrictEqual(paperBank.trades[0].entryTime, paperBank.trades[0].breakoutTime);
assert.strictEqual(paperBank.trades[0].entryTime, liveBank.trades[0].entryTime);

const niftyChart = bookChartPayload(retestDay, paperNifty.trades, {
  id: 'nifty', label: 'Nifty 50', sessionDay: iso, fromHm: '09:15', toHm: '15:15',
});
const bankChart = bookChartPayload(retestDay, paperBank.trades, {
  id: 'bank', label: 'Bank Nifty', sessionDay: iso, fromHm: '09:15', toHm: '15:15',
});
for (const chart of [niftyChart, bankChart]) {
  assert.ok(chart.candles.length > 20, `${chart.label} 5m candles`);
  assert.ok(chart.days[iso].length);
  assert.ok(chart.resistance > 0);
  assert.ok(chart.support > 0);
  assert.ok(chart.breakout && chart.breakout.hm);
  assert.ok(chart.confirmation && chart.confirmation.hm);
  assert.notStrictEqual(chart.breakout.hm, chart.entry.hm);
  assert.strictEqual(chart.confirmation.hm, chart.entry.hm);
  assert.ok(chart.option === 'CE' || chart.option === 'PE');
  assert.ok(chart.trades[0].breakoutTime);
  assert.ok(chart.trades[0].confirmationTime);
}

const emptyChart = bookChartPayload(retestDay, [], {
  id: 'nifty', label: 'Nifty 50', sessionDay: iso,
});
assert.ok(emptyChart.candles.length > 20, 'book chart still has today 5m with no trades');

const mapped = mapTrade(t, BOOKS.nifty, 1, 65);
assert.strictEqual(mapped.breakoutTime, t.breakoutTime);
assert.strictEqual(mapped.confirmationTime, t.confirmationTime);
assert.strictEqual(mapped.optionKind, 'CE');

console.log('sr-confirm-chart.selftest: ok', {
  breakout: t.breakoutTime,
  confirm: t.confirmationTime,
  entry: t.entryTime,
  option: t.option,
  books: [niftyChart.label, bankChart.label],
});
