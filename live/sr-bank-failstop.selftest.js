'use strict';
/**
 * Bank 29-Jul-shaped dump: 10:00 CE break, then 45 min TIME −105 pts.
 * failStop must exit on the first 5m CLOSE back through the wall, not wait TIME.
 */
const assert = require('assert');
const { runSrBreakout } = require('./sr-breakout');

function hmStr(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
function sessionBars(iso, priceAt) {
  const out = [];
  let i = 0;
  for (let min = 9 * 60 + 15; min <= 15 * 60 + 25; min += 5) {
    const px = priceAt(i, min);
    const hm = hmStr(min);
    out.push({ date: `${iso}T${hm}:00+05:30`, open: px.o, high: px.h, low: px.l, close: px.c });
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
for (let d = 1; d <= 7; d++) {
  bars.push(...driftDay(`2026-07-${String(d).padStart(2, '0')}`, 56800 + d * 40, 1.1));
}
const iso = '2026-07-29';
bars.push(...sessionBars(iso, (i, min) => {
  // Quiet morning range ~57120–57140. 10:00 15m (10:00/05/10) closes 57172.
  // Then 10:15+ walks to 57066 like the real TIME dump.
  if (min < 10 * 60) {
    const px = 57120 + (min % 15) * 0.2;
    return { o: px, c: px + 0.2, h: px + 1, l: px - 1 };
  }
  if (min === 10 * 60) return { o: 57140, c: 57155, h: 57158, l: 57138 };
  if (min === 10 * 60 + 5) return { o: 57155, c: 57165, h: 57168, l: 57152 };
  if (min === 10 * 60 + 10) return { o: 57165, c: 57172.35, h: 57178, l: 57162 };
  // First 5m after the 10:00 15m bucket: close back through the ~57140 wall.
  if (min === 10 * 60 + 15) return { o: 57170, c: 57120, h: 57172, l: 57110 };
  if (min === 10 * 60 + 20) return { o: 57120, c: 57090, h: 57122, l: 57080 };
  if (min === 10 * 60 + 45) return { o: 57080, c: 57066.85, h: 57085, l: 57060 };
  const px = 57070;
  return { o: px, c: px - 0.5, h: px + 1, l: px - 8 };
}));

const opts = {
  entryPts: 60, trendBars: 20, gapLo: 0, gapHi: 1e9,
  targetByScore: { 1: 20, 2: 20, 3: 20 },
  maxTradesPerDay: 3, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
  wallMode: 'intraday', timeStopBars: 9,
};

const timeOnly = runSrBreakout(bars, { ...opts, failStop: false });
const withFail = runSrBreakout(bars, { ...opts, failStop: true });

const t0 = timeOnly.trades[0];
const t1 = withFail.trades[0];
assert.ok(t0, 'TIME-only must take the 10:00 break');
assert.ok(t1, 'failStop must still take the 10:00 break');
assert.strictEqual(t0.option, 'CE');
assert.ok(t0.exitReason === 'TIME' || t0.points < -40, `expected a large TIME dump, got ${t0.exitReason} ${t0.points}`);
assert.strictEqual(t1.exitReason, 'FAIL', `expected FAIL, got ${t1.exitReason} ${t1.points}`);
assert.ok(t1.points > t0.points, `FAIL ${t1.points} should lose less than TIME ${t0.points}`);
assert.ok(t1.exitTime < '10:45', `FAIL should be before 10:45 TIME, got ${t1.exitTime}`);

console.log('sr-bank-failstop.selftest: ok', {
  time: { in: t0.entryTime, out: t0.exitTime, pts: t0.points, reason: t0.exitReason },
  fail: { in: t1.entryTime, out: t1.exitTime, pts: t1.points, reason: t1.exitReason },
});
