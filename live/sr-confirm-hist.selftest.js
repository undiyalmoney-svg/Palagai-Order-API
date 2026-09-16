'use strict';
/**
 * Play is S/R → 15m breakout close → confirm direction → retest enter.
 * A 5m fill still inside the signal 15m bar is a raw-breakout entry.
 */
const assert = require('assert');
const { runSrBreakout } = require('./sr-breakout');
const { EXIT_RULES, exitOptsFor } = require('./sr-strategy-config');

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

/** 11:15 15m (11:15/11:20/11:25) dumps through the wall. Intra-bar 11:25
 *  touches the wall; first bar AFTER the 15m close is 11:30. */
function signalPx(min) {
  if (min < 11 * 60 + 15) {
    const px = 23555 + (min % 15) * 0.1;
    return { o: px, c: px - 0.3, h: px + 2, l: px - 3 };
  }
  if (min === 11 * 60 + 15) return { o: 23550, c: 23495, h: 23552, l: 23490 };
  if (min === 11 * 60 + 20) return { o: 23495, c: 23480, h: 23498, l: 23475 };
  if (min === 11 * 60 + 25) return { o: 23480, c: 23470, h: 23490, l: 23460 };
  if (min === 11 * 60 + 30) return { o: 23470, c: 23485, h: 23555, l: 23465 };
  if (min === 11 * 60 + 35) return { o: 23485, c: 23470, h: 23495, l: 23460 };
  const px = 23470;
  return { o: px, c: px - 1, h: px + 1, l: px - 2 };
}

const opts = {
  entryPts: 27, trendBars: 20, gapLo: 0, gapHi: 1e9,
  targetByScore: { 1: 0, 2: 0, 3: 0 },
  maxTradesPerDay: 3, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
  wallMode: 'intraday', retest: true, confirmAfterBreakout: true, maxRetestBars: 2, minScore: 0,
};

const untilIntra = bars.concat(sessionBars(iso, signalPx, 11 * 60 + 25));
const intra = runSrBreakout(untilIntra, opts);
assert.strictEqual(intra.trades.length, 0,
  `must not enter on the 15m signal bar (11:15–11:25), got ${intra.trades.length} ${intra.trades[0] && intra.trades[0].entryTime}`);

const untilConfirm = bars.concat(sessionBars(iso, signalPx, 11 * 60 + 35));
const after = runSrBreakout(untilConfirm, opts);
assert.ok(after.trades.length >= 1, `retest after 15m close must enter, got ${after.trades.length}`);
const t = after.trades[0];
assert.strictEqual(t.option, 'PE');
assert.ok(t.retestTime, 'retestTime must exist');
assert.ok(t.entryTime >= '11:30', `entry on/after confirm (11:30), got ${t.entryTime}`);
assert.ok(t.entryTime > t.breakoutTime, `entry after breakout ${t.breakoutTime}, got ${t.entryTime}`);
assert.ok(t.retestTime >= '11:30', `retest on/after confirm, got ${t.retestTime}`);
assert.strictEqual(EXIT_RULES.nifty.confirmAfterBreakout, true);
assert.ok(exitOptsFor('nifty').confirmAfterBreakout);

console.log('sr-confirm-hist.selftest: ok', {
  breakoutTime: t.breakoutTime, retestTime: t.retestTime, entryTime: t.entryTime, option: t.option,
});
