'use strict';
const assert = require('assert');
const { runSrBreakout } = require('./sr-breakout');

function hmStr(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

function sessionBars(iso, priceAtBar) {
  const out = [];
  let i = 0;
  for (let min = 9 * 60 + 15; min <= 15 * 60 + 25; min += 5) {
    const px = priceAtBar(i, min);
    const hm = hmStr(min);
    out.push({
      date: `${iso}T${hm}:00+05:30`,
      open: px.o, high: px.h, low: px.l, close: px.c,
    });
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
    return { o, c, h: Math.max(o, c) + 0.2, l: Math.min(o, c) - 0.2 };
  });
}

const bars = [];
for (let d = 1; d <= 7; d++) {
  bars.push(...driftDay(`2026-08-${String(d).padStart(2, '0')}`, 56000 + d * 80, 1.2));
}
const iso = '2026-08-08';
bars.push(...sessionBars(iso, (i, min) => {
  // Quiet tape. 11:30 15m (11:30/35/40) closes through the morning high.
  // 5m after 11:40 dumps 40+ pts — STOP should fire, TIME would wait.
  if (min < 11 * 60 + 30) {
    const px = 57120 + (min % 15) * 0.1;
    return { o: px, c: px + 0.1, h: px + 0.3, l: px - 0.3 };
  }
  if (min === 11 * 60 + 30) return { o: 57122, c: 57240, h: 57245, l: 57120 };
  if (min === 11 * 60 + 35) return { o: 57240, c: 57300, h: 57305, l: 57235 };
  if (min === 11 * 60 + 40) return { o: 57300, c: 57350, h: 57355, l: 57295 };
  if (min === 11 * 60 + 45) return { o: 57350, c: 57290, h: 57352, l: 57280 };
  if (min === 11 * 60 + 50) return { o: 57290, c: 57240, h: 57295, l: 57220 };
  if (min === 11 * 60 + 55) return { o: 57240, c: 57200, h: 57245, l: 57190 };
  const px = 57200;
  return { o: px, c: px, h: px + 0.2, l: px - 0.2 };
}));

const baseOpts = {
  entryPts: 60, trendBars: 20, gapLo: 0, gapHi: 1e9,
  targetByScore: { 1: 20, 2: 20, 3: 20 },
  maxTradesPerDay: 3, reportFromDate: iso,
  entryStartHm: '09:45', entryEndHm: '14:30', squareOffHm: '15:15',
  wallMode: 'intraday', timeStopBars: 9,
};

const uncapped = runSrBreakout(bars, { ...baseOpts, maxLossPts: 0 });
const capped = runSrBreakout(bars, { ...baseOpts, maxLossPts: 40 });
assert.ok(capped.trades.some((t) => t.exitReason === 'STOP'),
  `expected a STOP, got ${JSON.stringify(capped.trades.map((t) => t.exitReason + ':' + t.points + '@' + t.entryTime))}`);
const c = capped.trades.find((t) => t.exitReason === 'STOP');
assert.ok(Math.abs(c.points + 40) < 0.2, `STOP should pin -40, got ${c.points}`);
const u = uncapped.trades.find((t) => t.entryTime === c.entryTime) || uncapped.trades[uncapped.trades.length - 1];
assert.ok(u.points < c.points - 1, `uncapped ${u.points} should lose more than STOP ${c.points}`);

console.log('sr-breakout.selftest: ok', {
  stop: { t: c.entryTime, pts: c.points },
  uncappedSame: { t: u.entryTime, pts: u.points, reason: u.exitReason },
});
