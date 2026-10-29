'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { walkSignal } = require('./simulate');
const { generateCandidates } = require('./candidates');
const { simulateDesk, pickDay, dailyBooks } = require('./portfolio');
const { runDailyProfit } = require('./pipeline');
const { startJob, resetJobs } = require('./jobs');

function sessionBars(day, overlays = {}) {
  const out = [];
  for (let m = 9 * 60 + 15; m <= 15 * 60 + 15; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const hit = overlays[t];
    out.push(
      hit
        ? { t, day, o: hit.o, h: hit.h, l: hit.l, c: hit.c, v: hit.v || 1000 }
        : { t, day, o: 100, h: 100.15, l: 99.9, c: 100.05, v: 1000 },
    );
  }
  return out;
}

test('walkSignal fills a long stop, charges the book, and never marks live', () => {
  const day = '2026-10-16';
  const bars = sessionBars(day, {
    '10:05': { o: 101, h: 101.8, l: 100.9, c: 101.6 },
    '10:10': { o: 101.6, h: 102.2, l: 101.4, c: 102 },
    '15:15': { o: 102, h: 102.1, l: 101.9, c: 102.05 },
  });
  const trade = walkSignal(
    bars,
    {
      symbol: 'AAA',
      day,
      side: 'L',
      signalT: '10:00',
      entryPx: 101.5,
      stopPx: 100.4,
      reason: 'test',
      family: 'or30_break',
    },
    { capital: 10000, maxStocksPerDay: 5, sizing: 'risk', timeExit: '15:15', entryEnd: '14:30' },
  );
  assert.ok(trade);
  assert.equal(trade.side, 'L');
  assert.ok(trade.exitReason === 'EOD' || trade.exitReason === 'SL');
  assert.ok(trade.qty >= 1);
  assert.ok(trade.chargesRs > 0);
  assert.ok(Number.isFinite(trade.netRs));
});

test('walkSignal locks 1R as TARGET and never marks live', () => {
  const day = '2026-10-16';
  const bars = sessionBars(day, {
    '10:05': { o: 101.5, h: 101.6, l: 101.4, c: 101.55 },
    '10:10': { o: 101.6, h: 104.5, l: 101.5, c: 104.2 },
  });
  const trade = walkSignal(
    bars,
    {
      symbol: 'AAA',
      day,
      side: 'L',
      signalT: '10:00',
      entryPx: 101.5,
      stopPx: 100.4,
      reason: 'test',
      family: 'pdh_break',
    },
    { capital: 10000, maxStocksPerDay: 1, sizing: 'risk', timeExit: '15:15', entryEnd: '14:30', targetR: 1 },
  );
  assert.ok(trade);
  assert.equal(trade.exitReason, 'TARGET');
  assert.ok(trade.promisedRs > 0);
  assert.ok(trade.tgtPx > trade.entryPx);
});

test('walkSignal marks OPEN when the session is still running', () => {
  const day = '2026-10-16';
  const bars = sessionBars(day, {
    '10:05': { o: 101.5, h: 101.6, l: 101.4, c: 101.55 },
    '10:10': { o: 101.6, h: 101.8, l: 101.5, c: 101.7 },
  }).filter((b) => b.t <= '10:10');
  const trade = walkSignal(
    bars,
    {
      symbol: 'AAA',
      day,
      side: 'L',
      signalT: '10:00',
      entryPx: 101.5,
      stopPx: 100.4,
      reason: 'test',
      family: 'pdh_break',
    },
    {
      capital: 670,
      maxStocksPerDay: 1,
      sizing: 'risk',
      timeExit: '15:15',
      entryEnd: '14:30',
      targetR: 1,
      allowOpen: true,
    },
  );
  assert.ok(trade);
  assert.equal(trade.exitReason, 'OPEN');
  assert.equal(trade.exitT, '10:10');
});

test('search space is only prior-day follow and never enables live orders', () => {
  const list = generateCandidates({ capital: 10000, budget: 20 });
  assert.equal(list.length, 1);
  assert.equal(list[0].family, 'pdh_break');
  assert.equal(list[0].crowdFilter, 'follow');
  assert.equal(list[0].maxStocksPerDay, 5);
  assert.ok(list[0].rules.entry && list[0].rules.exit);
});

test('pickDay keeps the requested name count using only rankScore', () => {
  const picked = pickDay(
    [
      { symbol: 'A', rankScore: 1 },
      { symbol: 'B', rankScore: 3 },
      { symbol: 'C', rankScore: 2 },
    ],
    2,
  );
  assert.deepEqual(
    picked.map((s) => s.symbol),
    ['B', 'C'],
  );
});

test('prior-day follow desk and daily book stay simulated with combined P/L', async () => {
  const day = '2026-10-16';
  const prev = '2026-10-15';
  const rising = sessionBars(day, {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.5, h: 102.2, l: 101.4, c: 102.1 },
    '09:50': { o: 102.2, h: 103.2, l: 102.1, c: 103.1 },
    '15:15': { o: 103.1, h: 103.3, l: 102.9, c: 103.2 },
  });
  const symbolBars = {
    AAA: { [prev]: sessionBars(prev, { '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 } }), [day]: rising },
  };
  const candidate = generateCandidates({ capital: 10000 })[0];
  assert.equal(candidate.family, 'pdh_break');
  const sim = await simulateDesk(symbolBars, candidate, 10000);
  const books = dailyBooks(sim.trades, sim.signals, [day], 10000);
  assert.equal(books[0].day, day);
  assert.ok(Object.prototype.hasOwnProperty.call(books[0], 'netPnl'));
  assert.ok(Object.prototype.hasOwnProperty.call(books[0], 'costs'));
});

test('runDailyProfit reports honestly when evidence is thin and never live-orders', async () => {
  const day = '2026-10-16';
  const symbolBars = { AAA: { [day]: sessionBars(day) } };
  const out = await runDailyProfit({ symbolBars, capital: 10000, budget: 12 });
  assert.equal(out.simulated, true);
  assert.equal(out.liveOrders, false);
  assert.ok(out.candidatesEvaluated >= 1);
  assert.ok(out.leaderboard.length);
  assert.ok(out.assumptions.some((a) => /not guaranteed|No live orders/i.test(a) || /Simulated MIS/i.test(a)));
  if (!out.recommended) {
    assert.match(out.noRobust, /No sufficiently robust profitable method/i);
  } else {
    assert.ok(out.recommended.risks.some((r) => /not guaranteed/i.test(r)));
  }
});

test('runDailyProfit evaluates a 25-name batched book without blocking forever', async () => {
  const days = ['2026-09-15', '2026-09-16', '2026-10-16'];
  const symbolBars = {};
  for (let i = 1; i <= 25; i += 1) {
    const symbol = `SYM${String(i).padStart(2, '0')}`;
    symbolBars[symbol] = {};
    for (const day of days) symbolBars[symbol][day] = sessionBars(day);
  }
  const started = Date.now();
  const out = await runDailyProfit({
    symbolBars,
    capital: 10000,
    budget: 12,
  });
  const elapsed = Date.now() - started;
  assert.equal(out.liveOrders, false);
  assert.equal(out.candidatesEvaluated, 1);
  assert.ok(elapsed < 30_000, `batched daily-profit took ${elapsed}ms`);
});

test('startJob rejects a future range and a missing date', () => {
  resetJobs();
  assert.throws(() => startJob({ headers: {} }, {}), (err) => err.status === 400);
  assert.throws(
    () => startJob({ headers: {} }, { from: '2026-10-16', to: '2099-01-01' }),
    (err) => err.status === 400 && /future/i.test(err.message),
  );
  resetJobs();
});
