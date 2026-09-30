'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp } = require('./helpers');
const { runBacktest } = require('../backtest/backtester');
const { whatIf } = require('../research/whatif');
const { splitDates, runOptimization } = require('../research/optimizer');

const USER = 'u1';
const RANGE = { from: '2021-01-04', to: '2022-12-30' };

function run(app, extra = {}) {
  const cfg = app.momentum.config(USER);
  return runBacktest({ panel: app.marketData.loadPanel(), params: cfg.params, capital: 1_000_000, costs: cfg.costs, slippageBps: cfg.slippageBps, ...RANGE, ...extra });
}

test('backtest is deterministic and reports every trade with reason and P&L', async () => {
  const app = await makeApp();
  const a = run(app);
  const b = run(app);
  assert.deepEqual(a.metrics, b.metrics);
  assert.deepEqual(a.fills, b.fills);
  assert.ok(a.fills.length > 0, 'the strategy traded');
  for (const f of a.fills) {
    assert.ok(f.reason && f.reason.length > 5, `fill ${f.symbol} has a reason`);
    assert.ok(['BUY', 'SELL'].includes(f.side));
    if (f.side === 'SELL') assert.ok(Number.isFinite(f.pnl));
  }
  const m = a.metrics;
  for (const k of ['startCapital', 'endCapital', 'cagrPct', 'totalReturnPct', 'maxDrawdownPct', 'sharpe', 'sortino', 'winRatePct', 'profitFactor', 'trades', 'avgHoldingDays']) {
    assert.ok(k in m, `metric ${k} present`);
  }
  assert.equal(m.startCapital, 1_000_000);
  assert.ok(a.equity.every((e) => Number.isFinite(e.equity) && e.equity > 0));
  app.close();
});

test('backtest never sells only because of holding time: round trips exceed the review period', async () => {
  const app = await makeApp();
  const r = run(app);
  assert.ok(!r.fills.some((f) => /holding period|held for \d+ days|time stop/i.test(f.reason)));
  const long = r.roundTrips.filter((t) => t.holdingDays > 60);
  assert.ok(long.length > 0, 'winners are allowed to run beyond any review interval');
  app.close();
});

test('costs and slippage reduce returns', async () => {
  const app = await makeApp();
  const free = run(app, { slippageBps: 0, costs: { ...app.momentum.config(USER).costs, brokeragePerOrder: 0, sttPct: 0, stampPct: 0, exchangePct: 0, sebiPct: 0, gstPct: 0, dpChargePerSell: 0 } });
  const real = run(app);
  assert.ok(real.metrics.endCapital < free.metrics.endCapital);
  assert.ok(real.metrics.totalCosts > 0);
  app.close();
});

test('same engine: what-if on a date reproduces the first backtest day and cannot see the future', async () => {
  const app = await makeApp();
  const cfg = app.momentum.config(USER);
  const panel = app.marketData.loadPanel();
  const date = '2021-03-31';
  const w = whatIf({ panel, params: cfg.params, date, capital: 1_000_000, costs: cfg.costs, slippageBps: cfg.slippageBps });
  assert.equal(w.verifiedNoLookahead, true);
  assert.equal(w.asOf, date);
  const bt = runBacktest({ panel, params: cfg.params, capital: 1_000_000, from: date, to: '2021-06-30', costs: cfg.costs, slippageBps: cfg.slippageBps });
  const buys = w.result.decisions.filter((d) => d.action === 'BUY').map((d) => d.symbol).sort();
  assert.ok(buys.length > 0, 'fixture date produces a BUY');
  const firstDay = bt.fills[0].date;
  const firstFills = bt.fills.filter((f) => f.side === 'BUY' && f.date === firstDay).map((f) => f.symbol).sort();
  assert.deepEqual(firstFills, buys.slice(0, firstFills.length), 'backtest day one buys what the live engine says to buy');
  assert.equal(bt.fills[0].qty, w.result.decisions.find((d) => d.symbol === bt.fills[0].symbol).quantity);

  const truncated = whatIf({ panel: panel.truncate(panel.indexOnOrBefore(date)), params: cfg.params, date, capital: 1_000_000, costs: cfg.costs, slippageBps: cfg.slippageBps });
  assert.deepEqual(truncated.result.decisions.map((d) => [d.symbol, d.action, d.quantity]), w.result.decisions.map((d) => [d.symbol, d.action, d.quantity]));
  app.close();
});

test('research service persists backtests with trades and rejects bad input', async () => {
  const app = await makeApp();
  const bt = app.research.runBacktest(USER, { capital: 500_000, ...RANGE, rebalance: 'MONTHLY', numStocks: 5 });
  assert.equal(bt.status, 'DONE');
  assert.equal(bt.trades.length, bt.metrics.fills ?? bt.trades.length);
  assert.ok(bt.trades.length > 0);
  assert.equal(app.research.getBacktest(USER, bt.id).id, bt.id);
  assert.throws(() => app.research.runBacktest(USER, { capital: 5 }), /at least/);
  assert.throws(() => app.research.runBacktest(USER, { from: '2022-01-01', to: '2021-01-01' }), /before/);
  app.close();
});

test('optimizer: train < validation < OOS ordering, robust objective, finalists carry OOS', async () => {
  const app = await makeApp();
  const panel = app.marketData.loadPanel();
  const split = splitDates(panel, app.momentum.config(USER).params, '2019-06-03', '2023-12-29');
  assert.ok(split.train.from < split.train.to && split.train.to < split.validation.from);
  assert.ok(split.validation.to < split.oos.from, 'out-of-sample comes strictly after validation');
  const cfg = app.momentum.config(USER);
  const res = runOptimization({ panel, baseParams: cfg.params, from: '2019-06-03', to: '2023-12-29', capital: 1_000_000, costs: cfg.costs, slippageBps: cfg.slippageBps, candidates: 4, seed: 't' });
  assert.ok(res.ranked.length >= 3);
  assert.ok(res.verdict && typeof res.verdict === 'string');
  assert.ok(res.finalists.length > 0);
  for (const c of res.finalists) assert.ok(c.oos, 'finalists have an out-of-sample result');
  const finalistLabels = new Set(res.finalists.map((c) => c.label));
  for (const c of res.ranked.filter((x) => !finalistLabels.has(x.label))) assert.ok(!c.oos, 'non-finalists never touched OOS');
  for (const c of res.ranked) assert.equal(c.robustObjective, Math.min(c.trainObjective, c.validationObjective));
  app.close();
});

test('strategy lab run via the service completes and can be applied as a strategy', async () => {
  const app = await makeApp();
  const run0 = app.research.startRun(USER, 'OPTIMIZE', { from: '2019-06-03', to: '2023-12-29', candidates: 4 });
  const status = await app.research.waitForRun(run0.id);
  assert.equal(status, 'DONE');
  const done = app.store.getRun(USER, run0.id);
  assert.ok(done.result.ranked.length > 0);
  if (done.result.best) {
    const s = app.research.applyCandidate(USER, run0.id, 'Lab pick');
    assert.equal(s.name, 'Lab pick');
  }
  app.close();
});
