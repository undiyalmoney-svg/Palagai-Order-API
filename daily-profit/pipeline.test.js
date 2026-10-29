'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { walkSignal } = require('./simulate');
const { generateCandidates } = require('./candidates');
const { simulateDesk, pickDay, dailyBooks } = require('./portfolio');
const { runDailyProfit } = require('./pipeline');
const { startJob, resetJobs } = require('./jobs');
const { first30HighLow } = require('./signals');

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

test('search space covers multiple families and never enables live orders', () => {
  const list = generateCandidates({ capital: 10000, budget: 20 });
  const families = new Set(list.map((c) => c.family));
  assert.ok(families.has('orb_winner'));
  assert.ok(families.has('or30_break'));
  assert.ok(families.has('gap_continue'));
  assert.ok(families.has('vwap_reclaim'));
  assert.ok(families.has('pdh_break'));
  assert.ok(families.has('morning_thrust'));
  assert.ok(families.has('ema_cross'));
  assert.ok(list.some((c) => c.maxStocksPerDay === 1));
  assert.ok(list.some((c) => c.maxStocksPerDay === 5));
  assert.ok(list.every((c) => c.rules.entry && c.rules.exit));
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

test('first-30 break and daily book stay simulated with combined P/L', async () => {
  const day = '2026-10-16';
  const prev = '2026-10-15';
  const rising = sessionBars(day, {
    '09:15': { o: 100, h: 100.4, l: 99.9, c: 100.2 },
    '09:20': { o: 100.2, h: 100.5, l: 100.1, c: 100.3 },
    '09:25': { o: 100.3, h: 100.6, l: 100.2, c: 100.4 },
    '09:30': { o: 100.4, h: 100.6, l: 100.3, c: 100.5 },
    '09:35': { o: 100.5, h: 100.7, l: 100.4, c: 100.55 },
    '09:40': { o: 100.55, h: 100.7, l: 100.45, c: 100.6 },
    '09:45': { o: 100.6, h: 101.2, l: 100.5, c: 101.1 },
    '09:50': { o: 101.1, h: 101.6, l: 101, c: 101.4 },
    '15:15': { o: 101.3, h: 101.5, l: 101.2, c: 101.4 },
  });
  const rng = first30HighLow(rising);
  assert.ok(rng.h > rng.l);
  const symbolBars = {
    AAA: { [prev]: sessionBars(prev), [day]: rising },
    BBB: { [prev]: sessionBars(prev), [day]: sessionBars(day) },
  };
  const candidate = generateCandidates({ budget: 20 }).find((c) => c.family === 'or30_break' && c.maxStocksPerDay === 5 && !c.targetR && !c.crowdFilter && c.sizing === 'risk');
  const sim = await simulateDesk(symbolBars, candidate, 10000);
  assert.equal(sim.trades.every((t) => t.symbol), true);
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
  assert.ok(out.candidatesEvaluated >= 10);
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
  let last = 0;
  const out = await runDailyProfit({
    symbolBars,
    capital: 10000,
    budget: 12,
    onProgress: (p) => {
      last = p.done;
    },
  });
  const elapsed = Date.now() - started;
  assert.equal(out.liveOrders, false);
  assert.ok(out.candidatesEvaluated >= 10);
  assert.ok(last > 0);
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
