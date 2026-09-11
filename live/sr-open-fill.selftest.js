'use strict';
/**
 * Retest fill on the LAST fetched 5m bar must still emit a trade (CLOSE/open).
 * Old code required a following bar, so Live never saw the fill until TARGET.
 *
 * A 15m bar labelled 11:30 is built from 11:30+11:35+11:40 5m. Truncating at
 * 11:45 (the first 5m AFTER that bucket) is the live-as-of case: the break is
 * known, the retest just printed, and there is no later bar yet.
 */
const assert = require('assert');
const { runSrBreakout } = require('./sr-breakout');
const { decideLiveAction, liveTransactionType, SPEC } = require('./sr-live');

function hmStr(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
function sessionBars(iso, priceAt, untilMin) {
  const out = [];
  let i = 0;
  const end = untilMin == null ? 15 * 60 + 25 : untilMin;
  for (let min = 9 * 60 + 15; min <= end; min += 5) {
    const px = priceAt(i, min);
    out.push({ date: `${iso}T${hmStr(min)}:00+05:30`, open: px.o, high: px.h, low: px.l, close: px.c });
    i += 1;
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
  // Stay ABOVE today's dump so the 20-bar trend at 11:15 is still down.
  bars.push(...driftDay(`2026-08-${String(d).padStart(2, '0')}`, 23680, 0.05));
}
const iso = '2026-08-11';
function signalPx(_i, min) {
  // 11:15 15m (11:15+11:20+11:25) dumps through the morning wall. At 11:26 the
  // last 5m is the retest — Live must see OPEN then, not wait for 11:30.
  if (min < 11 * 60 + 15) {
    const px = 23555 + (min % 15) * 0.1;
    return { o: px, c: px - 0.3, h: px + 2, l: px - 3 };
  }
  if (min === 11 * 60 + 15) return { o: 23550, c: 23495, h: 23552, l: 23490 };
  if (min === 11 * 60 + 20) return { o: 23495, c: 23488, h: 23498, l: 23485 };
  if (min === 11 * 60 + 25) return { o: 23488, c: 23520, h: 23580, l: 23484 };
  if (min === 11 * 60 + 30) return { o: 23518, c: 23470, h: 23522, l: 23465 };
  const px = 23470;
  return { o: px, c: px - 1, h: px + 1, l: px - 2 };
}

const opts = {
  entryPts: 27, trendBars: 20, gapLo: 0, gapHi: 1e9,
  targetByScore: { 1: 20, 2: 20, 3: 20 },
  maxTradesPerDay: 3, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
  wallMode: 'intraday', retest: true, maxRetestBars: 2, minScore: 0,
};

const untilFill = bars.concat(sessionBars(iso, signalPx, 11 * 60 + 25));
const atFill = runSrBreakout(untilFill, opts);
assert.ok(atFill.trades.length >= 1, `fill bar must emit a trade, got ${atFill.trades.length}`);
const open = atFill.trades[0];
assert.strictEqual(open.side, 'SELL');
assert.strictEqual(open.option, 'PE');
assert.strictEqual(open.entryTime, '11:25');
assert.strictEqual(open.exitReason, 'CLOSE');
assert.strictEqual(open.openAtFill, true);
assert.strictEqual(decideLiveAction({
  trade: open, nowHm: '11:26', alreadyOpen: false, squareOffHm: '15:15',
}), 'enter', 'Live must BUY the PE at the fill bar, not wait for TARGET');
assert.strictEqual(liveTransactionType(SPEC.nifty, open), 'BUY');

const full = runSrBreakout(bars.concat(sessionBars(iso, signalPx)), opts);
assert.ok(full.trades.length >= 1);
assert.ok(full.trades[0].exitReason === 'TARGET' || full.trades[0].points <= -15,
  `later bars should complete the short, got ${full.trades[0].exitReason} ${full.trades[0].points}`);

console.log('sr-open-fill.selftest: ok', {
  fill: { in: open.entryTime, reason: open.exitReason, pts: open.points, opt: open.option },
  later: { reason: full.trades[0].exitReason, pts: full.trades[0].points, out: full.trades[0].exitTime },
  kite: liveTransactionType(SPEC.nifty, open),
});
