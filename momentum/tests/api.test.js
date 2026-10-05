'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { makeApp } = require('./helpers');
const { createMomentumRouter } = require('../api/routes');
const { MockBroker } = require('../broker/mock-broker');

async function serve({ modules = ['momentum'], userId = 'u1', appOptions = {} } = {}) {
  const app = await makeApp(appOptions);
  const auth = {
    requireSiteUser: (req, res, next) => {
      if (req.headers['x-test-anon']) return res.status(401).json({ status: 'error', message: 'auth' });
      req.user = { id: userId, role: 'owner', modules };
      next();
    },
    requireModule: (mod) => (req, res, next) => (req.user.modules.includes(mod) ? next() : res.status(403).json({ status: 'error', message: 'forbidden' })),
  };
  const ex = express();
  ex.use(express.json());
  ex.use('/momentum', createMomentumRouter(app, { auth }));
  const server = http.createServer(ex);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/momentum`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { app, call, close: () => new Promise((r) => { server.close(() => { app.close(); r(); }); server.closeAllConnections(); }) };
}

test('requires authentication and the momentum module', async () => {
  const anon = await serve();
  assert.equal((await anon.call('GET', '/status', null, { 'x-test-anon': '1' })).status, 401);
  assert.equal((await anon.call('GET', '/health')).status, 200);
  await anon.close();
  const denied = await serve({ modules: ['other'] });
  assert.equal((await denied.call('GET', '/status')).status, 403);
  await denied.close();
});

test('status is honest about simulated data and hides live until a broker is connected', async () => {
  const s = await serve();
  const { status, body } = await s.call('GET', '/status');
  assert.equal(status, 200);
  assert.equal(body.provider.simulated, true);
  assert.ok(body.provider.simulatedNotice);
  assert.equal(body.broker.configured, false);
  assert.equal(body.broker.liveEnabled, false);
  await s.close();
});

test('"I have Rs 1,00,000, what should I buy today?" returns explained, executable-ready advice', async () => {
  const s = await serve();
  const { status, body } = await s.call('POST', '/advice', { capital: 100000 });
  assert.equal(status, 200);
  assert.ok(body.regime.regime);
  assert.ok(body.summary.answer);
  assert.ok(body.portfolioSize.explanation || body.portfolioSize.text || body.portfolioSize.n !== undefined);
  assert.ok(Array.isArray(body.decisions));
  const buys = body.decisions.filter((d) => d.action === 'BUY');
  for (const d of buys) {
    assert.ok(d.quantity > 0 && d.priceRef > 0 && d.reason && d.explanation);
  }
  const spend = buys.reduce((a, d) => a + d.quantity * d.priceRef, 0);
  assert.ok(spend <= 100000);
  await s.close();
});

test('paper portfolio flow: start, decide, execute, no duplicates, capital change, history', async () => {
  const s = await serve();
  assert.equal((await s.call('GET', '/portfolio')).status, 404);
  assert.equal((await s.call('POST', '/portfolio/paper', { capital: 5 })).status, 400);
  const created = await s.call('POST', '/portfolio/paper', { capital: 200000 });
  assert.equal(created.status, 200);
  assert.equal((await s.call('POST', '/portfolio/paper', { capital: 200000 })).status, 409);

  const run = await s.call('POST', '/decisions/run', { forceReview: true });
  assert.equal(run.status, 200);
  assert.ok(run.body.persisted);
  const again = await s.call('POST', '/decisions/run', { forceReview: true });
  assert.equal(again.status, 200);
  const sigs = (await s.call('GET', '/signals')).body.signals;
  const keys = sigs.map((x) => x.decisionKey);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate signals from repeated calls');

  const orders = (await s.call('GET', '/orders')).body.orders;
  const view = (await s.call('GET', '/portfolio')).body;
  assert.equal(view.positions.length <= orders.length + 0, true);
  assert.ok(view.valuation.equity > 0);

  const cap = await s.call('POST', '/portfolio/capital', { amount: 50000 });
  assert.equal(cap.status, 200);
  assert.equal(cap.body.kind, 'DEPOSIT');
  assert.equal(cap.body.amount, 50000);
  assert.ok(cap.body.run.capital, 'the engine explains how the extra capital is deployed');
  assert.ok(cap.body.before !== undefined);
  assert.equal((await s.call('POST', '/portfolio/capital', { amount: 'abc' })).status, 400);

  const hist = await s.call('GET', '/decisions/history');
  assert.ok(hist.body.runs.length >= 1);
  const detail = await s.call('GET', `/decisions/runs/${hist.body.runs[0].id}`);
  assert.equal(detail.status, 200);
  await s.close();
});

test('live mode requires explicit confirmation and a connected broker', async () => {
  const s = await serve();
  assert.equal((await s.call('POST', '/live/enable', { phrase: 'yes' })).status, 400);
  const noBroker = await s.call('POST', '/live/enable', { phrase: 'ENABLE LIVE TRADING' });
  assert.equal(noBroker.status, 400);
  assert.equal(noBroker.body.code, 'NO_BROKER');
  assert.equal((await s.call('GET', '/portfolio?mode=LIVE')).status, 404);
  await s.close();
});

test('enabling live trading imports broker holdings in the universe and sets cash from funds', async () => {
  const broker = new MockBroker({ live: true });
  broker.fundsData = { equityCash: 80000, equityNet: 180000, capitalRs: 80000 };
  broker.holdingsData = [
    { symbol: 'TCS', qty: 10, avgPrice: 3500, exchange: 'NSE' },
    { symbol: 'NOTAINDEX', qty: 40, avgPrice: 100, exchange: 'NSE' },
  ];
  const s = await serve({ appOptions: { brokerOverride: () => broker } });
  s.app.momentum.sessions.save('u1', 'kitekey', 'token');
  const en = await s.call('POST', '/live/enable', { phrase: 'ENABLE LIVE TRADING' });
  assert.equal(en.status, 200);
  assert.equal(en.body.enabled, true);
  assert.deepEqual(en.body.holdings.imported, ['TCS']);
  assert.equal(en.body.holdings.skipped.some((x) => x.symbol === 'NOTAINDEX'), true);
  const view = await s.call('GET', '/portfolio?mode=LIVE');
  assert.equal(view.status, 200);
  assert.equal(view.body.valuation.cash, 80000);
  assert.equal(view.body.positions.length, 1);
  assert.equal(view.body.positions[0].symbol, 'TCS');
  assert.equal(view.body.positions[0].qty, 10);
  await s.close();
});

test('backtest, what-if and validation endpoints', async () => {
  const s = await serve();
  const bt = await s.call('POST', '/backtests', { capital: 500000, from: '2021-01-04', to: '2022-06-30' });
  assert.equal(bt.status, 200);
  assert.equal(bt.body.backtest.status, 'DONE');
  assert.ok(bt.body.backtest.trades.length > 0);
  const fetched = await s.call('GET', `/backtests/${bt.body.backtest.id}`);
  assert.equal(fetched.body.backtest.id, bt.body.backtest.id);
  const w = await s.call('POST', '/whatif', { date: '2021-03-31', capital: 100000 });
  assert.equal(w.status, 200);
  assert.equal(w.body.verifiedNoLookahead, true);
  assert.equal((await s.call('POST', '/whatif', { capital: 100000 })).status, 400);
  assert.equal((await s.call('POST', '/backtests', { capital: 1 })).status, 400);
  await s.close();
});

test('desk paper replay and live scan return entries, exits and a scan clock', async () => {
  const s = await serve();
  const overview = await s.call('GET', '/desk');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.schedule.scanTime, '16:00 IST');
  assert.equal(overview.body.schedule.fillTime, '09:15 IST');
  assert.ok(overview.body.schedule.buy.when);
  assert.ok(overview.body.schedule.sell.instruction);

  const paper = await s.call('POST', '/desk/paper', { capital: 200000, from: '2021-01-04', to: '2022-06-30' });
  assert.equal(paper.status, 200);
  assert.ok(paper.body.closed.length > 0);
  const trip = paper.body.closed[0];
  assert.ok(trip.symbol && trip.entryDate && trip.exitDate);
  assert.equal(trip.entryTime, '09:15 IST');
  assert.equal(trip.exitTime, '09:15 IST');
  assert.ok(Number.isFinite(trip.holdingDays));
  assert.ok(Number.isFinite(paper.body.totalProfit));
  assert.ok(Number.isFinite(paper.body.startCapital));
  assert.ok(Number.isFinite(paper.body.endCapital));
  assert.equal(paper.body.period, 'custom');

  const scan = await s.call('POST', '/desk/scan', { capital: 150000, reset: true, mode: 'LIVE' });
  assert.equal(scan.status, 200);
  assert.equal(scan.body.usedPaperFallback, true);
  assert.ok(Array.isArray(scan.body.buy));
  assert.ok(Array.isArray(scan.body.hold));
  assert.ok(Array.isArray(scan.body.sell));
  assert.ok(scan.body.holdingsSync);
  assert.ok(Array.isArray(scan.body.alsoHeld));
  for (const row of scan.body.buy) {
    if (row.qty > 0 && row.priceRef) {
      assert.ok(row.suggestedLimit > 0);
      assert.match(row.fillHint || '', /LIMIT/);
    }
  }
  for (const row of [...scan.body.buy, ...scan.body.sell]) {
    if (row.canExecute) assert.ok(row.signalId > 0 && row.qty >= 0);
  }
  const after = await s.call('GET', '/desk');
  assert.ok(after.body.lastScan);
  assert.ok(Array.isArray(after.body.lastScan.buy));
  await s.close();
});

test('live scan and desk overview show CNC qty and sell price before live trading is enabled', async () => {
  const broker = new MockBroker({ live: true });
  broker.holdingsData = [
    { symbol: 'TCS', qty: 10, avgPrice: 3500, lastPrice: 3520, exchange: 'NSE' },
    { symbol: 'GOLDBEES', qty: 25, avgPrice: 70, lastPrice: 72, exchange: 'NSE' },
  ];
  const s = await serve({ appOptions: { brokerOverride: () => broker } });
  s.app.momentum.sessions.save('u1', 'kitekey', 'token');
  const scan = await s.call('POST', '/desk/scan', { capital: 150000, reset: true, mode: 'LIVE' });
  assert.equal(scan.status, 200);
  assert.equal(scan.body.usedPaperFallback, true);
  assert.equal(scan.body.holdingsSync.ok, true);
  assert.equal(scan.body.holdingsSync.preview, true);
  const tcs = scan.body.hold.find((r) => r.symbol === 'TCS');
  assert.ok(tcs);
  assert.equal(tcs.qty, 10);
  assert.ok(tcs.suggestedSell > 0);
  const gold = scan.body.hold.find((r) => r.symbol === 'GOLDBEES');
  assert.ok(gold);
  assert.equal(gold.qty, 25);
  const overview = await s.call('GET', '/desk');
  assert.equal(overview.status, 200);
  const held = overview.body.lastScan?.hold || [];
  assert.equal(held.find((r) => r.symbol === 'TCS')?.qty, 10);
  assert.ok(held.find((r) => r.symbol === 'TCS')?.suggestedSell > 0);
  await s.close();
});

test('live scan sizes buy qty from Kite equity cash, not the typed capital', async () => {
  const broker = new MockBroker({ live: true });
  broker.fundsData = { equityCash: 20000, equityNet: 20000, capitalRs: 20000 };
  const s = await serve({ appOptions: { brokerOverride: () => broker } });
  s.app.momentum.sessions.save('u1', 'kitekey', 'token');
  const small = await s.call('POST', '/desk/scan', { capital: 150000, reset: true, mode: 'LIVE' });
  assert.equal(small.status, 200);
  assert.equal(small.body.sizedFrom, 'kite-funds');
  assert.equal(small.body.capital, 20000);
  assert.equal(small.body.funds.equityCash, 20000);
  const smallSpend = (small.body.buy || []).reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.priceRef) || 0), 0);
  broker.fundsData = { equityCash: 80000, equityNet: 80000, capitalRs: 80000 };
  const large = await s.call('POST', '/desk/scan', { capital: 10000, reset: true, mode: 'LIVE' });
  assert.equal(large.body.capital, 80000);
  const largeSpend = (large.body.buy || []).reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.priceRef) || 0), 0);
  assert.ok(largeSpend > smallSpend, `80k funds should buy more than 20k (got ${largeSpend} vs ${smallSpend})`);
  await s.close();
});

test('AI narrator answers from stored decisions and cannot invent trades', async () => {
  const s = await serve();
  await s.call('POST', '/portfolio/paper', { capital: 300000 });
  await s.call('POST', '/decisions/run', { forceReview: true });
  const r = await s.call('POST', '/ai/ask', { question: 'What should I do now?' });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'deterministic-narrator');
  assert.ok(r.body.answer);
  await s.close();
});

test('desk overview is a Dual Momentum product: paper defaults, live guide, Get Token steps', async () => {
  const s = await serve();
  const r = await s.call('GET', '/desk');
  assert.equal(r.status, 200);
  assert.match(r.body.strategy.name, /Dual Momentum/i);
  assert.ok(r.body.paperDefaults.from);
  assert.ok(r.body.paperDefaults.to);
  assert.equal(r.body.paperDefaults.auto, true);
  assert.ok(r.body.paperDefaults.periods.last_week.from);
  assert.ok(r.body.paperDefaults.periods.last_year.from);
  assert.ok(r.body.paperDefaults.periods.last_12m.from);
  assert.ok(Array.isArray(r.body.guide));
  assert.equal(r.body.guide[0].href, '/dashboard/get-token');
  assert.equal(r.body.tokenReady, false);
  await s.close();
});

test('paper replay without dates uses ~12 months, this week picks, and is not an all-loss bull book', async () => {
  const s = await serve();
  const bull = await s.call('POST', '/desk/paper', { capital: 100000, from: '2020-08-03', to: '2021-03-31' });
  assert.equal(bull.status, 200);
  assert.ok(bull.body.summary?.headline);
  assert.ok(bull.body.thisWeek);
  const closed = bull.body.closed || [];
  const wins = closed.filter((t) => Number(t.pnl) > 0).length;
  const losses = closed.filter((t) => Number(t.pnl) <= 0).length;
  assert.ok(
    bull.body.totalProfit > 0 || wins >= losses,
    `Dual Momentum should not dump an all-loss paper book on a bull window (profit ${bull.body.totalProfit}, wins ${wins}, losses ${losses})`,
  );

  const auto = await s.call('POST', '/desk/paper', { capital: 10000 });
  assert.equal(auto.status, 200);
  assert.equal(auto.body.kind, 'PAPER');
  assert.ok(auto.body.autoRange);
  assert.ok(auto.body.thisWeek);
  assert.ok(auto.body.nextAction);
  assert.ok(auto.body.lastWeek);
  assert.equal(auto.body.period, 'last_12m');
  assert.equal(auto.body.startCapital, 10000);
  assert.ok(auto.body.endCapital != null);
  assert.equal(auto.body.priceSource, 'synthetic');
  assert.equal(auto.body.simulated, true);

  const week = await s.call('POST', '/desk/paper', { capital: 25000, period: 'last_week' });
  assert.equal(week.status, 200);
  assert.equal(week.body.period, 'last_week');
  assert.equal(week.body.startCapital, 25000);
  assert.ok(week.body.lookback);
  assert.equal(week.body.lookback.period, 'last_12m');
  assert.ok(Number.isFinite(week.body.lookback.totalProfit));
  const { daysBetween } = require('../utils/dates');
  assert.ok(daysBetween(week.body.from, week.body.to) <= 10, `last week window ${week.body.from} → ${week.body.to}`);
  assert.ok(week.body.lastWeek);
  await s.close();
});

test('paper scan this week returns Dual Momentum buy cards sized from virtual cash', async () => {
  const s = await serve();
  const r = await s.call('POST', '/desk/scan', { capital: 25000, reset: true, mode: 'PAPER' });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'PAPER');
  assert.equal(r.body.product.kind, 'PAPER');
  assert.ok(r.body.nextAction);
  const spend = (r.body.buy || []).reduce((a, row) => a + (Number(row.qty) || 0) * (Number(row.priceRef) || 0), 0);
  assert.ok(spend <= 25000 + 1);
  await s.close();
});
