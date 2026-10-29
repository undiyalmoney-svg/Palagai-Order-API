'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { namesFromCapital, pdhFollowCandidate, runPdhFollowBook } = require('./pdh-desk');

function sessionBars(day, overlays = {}) {
  const out = [];
  for (let m = 9 * 60 + 15; m <= 15 * 60 + 15; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const hit = overlays[t];
    out.push(
      hit
        ? { t, day, o: hit.o, h: hit.h, l: hit.l, c: hit.c, v: hit.v || 1000 }
        : { t, day, o: 100, h: 100.2, l: 99.8, c: 100.1, v: 1000 },
    );
  }
  return out;
}

test('namesFromCapital is 1 per ₹2,000 and hard-caps at 8', () => {
  assert.equal(namesFromCapital(1000), 1);
  assert.equal(namesFromCapital(2000), 1);
  assert.equal(namesFromCapital(4000), 2);
  assert.equal(namesFromCapital(10000), 5);
  assert.equal(namesFromCapital(16000), 8);
  assert.equal(namesFromCapital(40000), 8);
});

test('pdh follow candidate is prior-day break + 09:45 follow and never live', () => {
  const c = pdhFollowCandidate(10000);
  assert.equal(c.family, 'pdh_break');
  assert.equal(c.crowdFilter, 'follow');
  assert.equal(c.rankBy, 'stopPct');
  assert.equal(c.maxStocksPerDay, 2);
  assert.equal(c.entryEnd, '14:30');
  assert.equal(c.timeExit, '15:15');
  assert.match(c.entry, /prior session/i);
  assert.match(c.rules.stockCount, /2 names/i);
});

test('historical test book stays at 2 names even when capital would have bought 5–8', () => {
  assert.equal(pdhFollowCandidate(10000).maxStocksPerDay, 2);
  assert.equal(pdhFollowCandidate(40000).maxStocksPerDay, 2);
  assert.equal(pdhFollowCandidate(10000).targetR, 1);
  assert.equal(pdhFollowCandidate(10000).matchLiveScan, true);
  assert.equal(pdhFollowCandidate(10000).entryFill, 'signalClose');
});

test('live lock candidate is 2 names, compulsory 1R, and never live orders', () => {
  const c = pdhFollowCandidate(670, { liveLock: true });
  assert.equal(c.family, 'pdh_break');
  assert.equal(c.maxStocksPerDay, 2);
  assert.equal(c.targetR, 1);
  assert.notEqual(c.targetR, null);
  assert.equal(c.allowOpen, true);
  assert.equal(c.capital, 670);
  assert.equal(c.id, 'pdh-follow-live-lock');
  assert.match(c.rules.target, /compulsory 1r/i);
  assert.match(c.rules.target, /not a guaranteed/i);
  assert.match(c.rules.exit, /compulsory 1r/i);
});

test('runPdhFollowBook takes a prior-day high break on a long-crowd day', async () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 101, l: 99.5, c: 100.8 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const dayBars = sessionBars(day, {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.6, h: 102.4, l: 101.5, c: 102.3 },
    '09:35': { o: 102.3, h: 102.5, l: 102.2, c: 102.4 },
    '09:40': { o: 102.4, h: 102.6, l: 102.3, c: 102.5 },
    '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.3 },
    '09:55': { o: 103.3, h: 103.5, l: 103.2, c: 103.4 },
    '15:15': { o: 103.3, h: 103.5, l: 103.1, c: 103.4 },
  });
  const out = await runPdhFollowBook({
    symbolBars: {
      AAA: { [prev]: prevBars, [day]: dayBars },
    },
    capital: 10000,
  });
  assert.equal(out.simulated, true);
  assert.equal(out.liveOrders, false);
  assert.equal(out.family, 'pdh_break');
  assert.equal(out.config.crowdFilter, 'follow');
  assert.equal(out.config.maxStocksPerDay, 2);
  assert.ok(out.trades.length >= 1);
  assert.equal(out.trades[0].symbol, 'AAA');
  assert.equal(out.trades[0].side, 'L');
  assert.ok(out.dailyBooks.length);
});

test('historical test book takes the best two names when more than two qualify', async () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 101, l: 99.5, c: 100.8 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const first15 = {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.6, h: 102.4, l: 101.5, c: 102.3 },
    '09:35': { o: 102.3, h: 102.5, l: 102.2, c: 102.4 },
    '09:40': { o: 102.4, h: 102.6, l: 102.3, c: 102.5 },
  };
  const hold = { '09:55': { o: 104.6, h: 105.2, l: 104.4, c: 104.8 }, '15:15': { o: 104.6, h: 104.8, l: 104.3, c: 104.5 } };
  const out = await runPdhFollowBook({
    symbolBars: {
      NARROW: { [prev]: prevBars, [day]: sessionBars(day, { ...first15, '09:50': { o: 102.6, h: 103.2, l: 102.5, c: 103.1 }, ...hold }) },
      WIDE: { [prev]: prevBars, [day]: sessionBars(day, { ...first15, '09:50': { o: 102.6, h: 104.8, l: 102.5, c: 104.5 }, ...hold }) },
      THIRD: { [prev]: prevBars, [day]: sessionBars(day, { ...first15, '09:50': { o: 102.6, h: 102.8, l: 102.5, c: 102.7 }, ...hold }) },
    },
    capital: 40000,
  });
  assert.equal(out.config.maxStocksPerDay, 2);
  assert.equal(out.trades.length, 2);
  assert.deepEqual(out.trades.map((t) => t.symbol).sort(), ['NARROW', 'WIDE']);
  assert.equal(out.config.targetR, 1);
  assert.ok(out.promised);
});

test('historical test fills at the signal close like live, even if the next bar never takes the high', async () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 101, l: 99.5, c: 100.8 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const dayBars = sessionBars(day, {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.6, h: 102.4, l: 101.5, c: 102.3 },
    '09:35': { o: 102.3, h: 102.5, l: 102.2, c: 102.4 },
    '09:40': { o: 102.4, h: 102.6, l: 102.3, c: 102.5 },
    '09:50': { o: 102.6, h: 110, l: 102.5, c: 103.3 },
    '09:55': { o: 103.2, h: 103.4, l: 103.0, c: 103.1 },
    '15:15': { o: 103.1, h: 103.2, l: 102.9, c: 103.0 },
  });
  const out = await runPdhFollowBook({
    symbolBars: { WICK: { [prev]: prevBars, [day]: dayBars } },
    capital: 10000,
  });
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].symbol, 'WICK');
  assert.equal(out.trades[0].entryT, '09:50');
  assert.equal(out.trades[0].entryPx, 103.3);
});

test('historical test does not let a later wider stop replace the first two live-style fills', async () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 101, l: 99.5, c: 100.8 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const first15 = {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.6, h: 102.4, l: 101.5, c: 102.3 },
    '09:35': { o: 102.3, h: 102.5, l: 102.2, c: 102.4 },
    '09:40': { o: 102.4, h: 102.6, l: 102.3, c: 102.5 },
  };
  const eod = { '15:15': { o: 103, h: 103.2, l: 102.8, c: 103 } };
  const out = await runPdhFollowBook({
    symbolBars: {
      EARLY_A: {
        [prev]: prevBars,
        [day]: sessionBars(day, { ...first15, '09:50': { o: 102.6, h: 102.8, l: 102.5, c: 102.7 }, ...eod }),
      },
      EARLY_B: {
        [prev]: prevBars,
        [day]: sessionBars(day, { ...first15, '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.2 }, ...eod }),
      },
      LATE: {
        [prev]: prevBars,
        [day]: sessionBars(day, { ...first15, '13:00': { o: 102, h: 112, l: 101.8, c: 111 }, ...eod }),
      },
    },
    capital: 10000,
  });
  assert.equal(out.trades.length, 2);
  assert.deepEqual(out.trades.map((t) => t.symbol).sort(), ['EARLY_A', 'EARLY_B']);
  assert.ok(!out.trades.some((t) => t.symbol === 'LATE'));
});

test('historical test takes 1R the same way live does', async () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 101, l: 99.5, c: 100.8 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const dayBars = sessionBars(day, {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.6, h: 102.4, l: 101.5, c: 102.3 },
    '09:35': { o: 102.3, h: 102.5, l: 102.2, c: 102.4 },
    '09:40': { o: 102.4, h: 102.6, l: 102.3, c: 102.5 },
    '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.3 },
    '09:55': { o: 103.3, h: 103.5, l: 103.2, c: 103.4 },
    '10:00': { o: 103.4, h: 108, l: 103.3, c: 107.5 },
    '10:05': { o: 107.4, h: 107.6, l: 107.2, c: 107.5 },
    '15:15': { o: 107, h: 107.2, l: 106.8, c: 107 },
  });
  const out = await runPdhFollowBook({
    symbolBars: { AAA: { [prev]: prevBars, [day]: dayBars } },
    capital: 10000,
  });
  assert.equal(out.config.targetR, 1);
  assert.equal(out.liveOrders, false);
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].exitReason, 'TARGET');
  assert.ok(out.promised.lockedRs !== 0 || out.trades[0].promisedRs > 0);
});

test('live lock book uses 1R, marks OPEN before 15:15, and never places orders', async () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 101, l: 99.5, c: 100.8 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const dayBars = sessionBars(day, {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.6, h: 102.4, l: 101.5, c: 102.3 },
    '09:35': { o: 102.3, h: 102.5, l: 102.2, c: 102.4 },
    '09:40': { o: 102.4, h: 102.6, l: 102.3, c: 102.5 },
    '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.3 },
    '09:55': { o: 103.3, h: 103.5, l: 103.2, c: 103.4 },
    '10:00': { o: 103.4, h: 103.5, l: 103.2, c: 103.45 },
    '10:05': { o: 103.4, h: 103.6, l: 103.3, c: 103.5 },
    '10:10': { o: 103.5, h: 103.7, l: 103.4, c: 103.6 },
  }).filter((b) => b.t <= '10:10');
  const out = await runPdhFollowBook({
    symbolBars: {
      AAA: { [prev]: prevBars, [day]: dayBars },
    },
    capital: 670,
    liveLock: true,
    fundsRs: 670,
  });
  assert.equal(out.simulated, true);
  assert.equal(out.liveOrders, false);
  assert.equal(out.config.targetR, 1);
  assert.equal(out.config.maxStocksPerDay, 2);
  assert.equal(out.config.liveLock, true);
  assert.ok(out.promised);
  assert.equal(out.promised.names, 2);
  assert.equal(out.promised.targetR, 1);
  assert.equal(out.promised.guaranteed, false);
  assert.equal(out.promised.liveOrders, false);
  assert.equal(out.promised.fundsRs, 670);
  assert.ok(out.trades.length >= 1);
  assert.equal(out.trades[0].exitReason, 'OPEN');
});
