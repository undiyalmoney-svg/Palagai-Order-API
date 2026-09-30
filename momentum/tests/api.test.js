'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { makeApp } = require('./helpers');
const { createMomentumRouter } = require('../api/routes');

async function serve({ modules = ['momentum'], userId = 'u1' } = {}) {
  const app = await makeApp();
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
