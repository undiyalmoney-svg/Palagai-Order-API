'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, NOW, OPEN } = require('./helpers');
const { MockBroker } = require('../broker/mock-broker');

const USER = 'u1';
const SYMBOL = 'TCS';

async function setup({ clock = NOW, live = false, mock = null, capital = 1_000_000 } = {}) {
  const state = { now: clock };
  const broker = mock || (live ? new MockBroker({ live: true }) : null);
  const app = await makeApp({ clock: () => state.now, brokerOverride: broker ? () => broker : null });
  const m = app.momentum;
  const p = m.initPaper(USER, capital);
  return { app, m, p, broker, state, store: app.store };
}

function addSignal(ctx, { action = 'BUY', qty = 10, asOf = '2026-09-30', key = null, priceRef = null, symbol = SYMBOL } = {}) {
  const px = ctx.app.marketData.priceFor(symbol).price;
  const decision = {
    asOf, symbol, action, timing: 'NOW', quantity: qty, priceRef: priceRef ?? px, allocationValue: qty * px,
    reason: `test ${action}`, trigger: 'TEST', strategy: 'test', score: 70, confidence: 0.7,
    decisionKey: key || `${symbol}:${action}:${asOf}:${qty}`,
    risk: { stopPrice: px * 0.9, riskPerShare: px * 0.1 },
  };
  return ctx.store.insertSignalIfNew({ userId: USER, portfolioId: ctx.p.id, runId: null, decision }).id;
}

const exec = (ctx, signalId) => ctx.m.orders.executeSignal({ signalId, userId: USER });
const pos = (ctx, symbol = SYMBOL) => ctx.store.getPosition(ctx.p.id, symbol);

test('paper BUY fills once; repeating the API call never submits a second order', async () => {
  const ctx = await setup();
  const sid = addSignal(ctx);
  const first = await exec(ctx, sid);
  assert.equal(first.order.status, 'FILLED');
  assert.equal(pos(ctx).qty, 10);
  const cashAfter = ctx.store.getPortfolioById(ctx.p.id).cash;
  const second = await exec(ctx, sid);
  assert.equal(second.duplicate, true);
  assert.equal(second.order.id, first.order.id);
  assert.equal(pos(ctx).qty, 10);
  assert.equal(ctx.store.getPortfolioById(ctx.p.id).cash, cashAfter);
  const parallel = await Promise.all([exec(ctx, sid), exec(ctx, sid)]);
  assert.ok(parallel.every((r) => r.duplicate));
  assert.equal(ctx.store.listOrders({ userId: USER }).length, 1);
  ctx.app.close();
});

test('market closed with fillWhenClosed=false: order is QUEUED, then fills on reconcile once the market opens', async () => {
  const ctx = await setup();
  ctx.store.saveSettings(USER, { ...ctx.m.config(USER).settings, paper: { ...ctx.m.config(USER).settings.paper, fillWhenClosed: false } });
  const res = await exec(ctx, addSignal(ctx));
  assert.equal(res.queued, true);
  assert.equal(res.order.status, 'QUEUED');
  assert.equal(pos(ctx), null);
  await ctx.m.orders.processOpenOrders();
  assert.equal(ctx.store.getOrder(res.order.id).status, 'QUEUED', 'still closed - stays queued');
  ctx.state.now = OPEN;
  await ctx.m.orders.processOpenOrders();
  assert.equal(ctx.store.getOrder(res.order.id).status, 'FILLED');
  assert.equal(pos(ctx).qty, 10);
  ctx.app.close();
});

test('live order is rejected until the user has explicitly enabled live trading', async () => {
  const ctx = await setup({ live: true });
  const res = await exec(ctx, addSignal(ctx));
  assert.equal(res.rejected, true);
  assert.equal(res.order.status, 'REJECTED');
  assert.match(res.message, /not enabled/i);
  assert.equal(ctx.broker.placed.length, 0, 'nothing reached the broker');
  ctx.app.close();
});

function enableLive(ctx) {
  const s = ctx.m.config(USER).settings;
  ctx.store.saveSettings(USER, { ...s, live: { ...s.live, enabled: true } });
}

test('a SUBMITTED / OPEN order never creates a position until the broker reports a fill', async () => {
  const ctx = await setup({ live: true, clock: OPEN });
  enableLive(ctx);
  ctx.broker.enqueue({ status: 'OPEN', filledQty: 0, later: { status: 'FILLED', filledQty: 10 } });
  const res = await exec(ctx, addSignal(ctx));
  assert.equal(res.order.status, 'OPEN');
  assert.equal(pos(ctx), null);
  assert.equal(ctx.store.getPortfolioById(ctx.p.id).cash, 1_000_000);
  await ctx.m.orders.processOpenOrders();
  assert.equal(ctx.store.getOrder(res.order.id).status, 'FILLED');
  assert.equal(pos(ctx).qty, 10);
  const cash = ctx.store.getPortfolioById(ctx.p.id).cash;
  await ctx.m.orders.processOpenOrders();
  await ctx.m.orders.processOpenOrders();
  assert.equal(pos(ctx).qty, 10, 'reconciling again must not double count');
  assert.equal(ctx.store.getPortfolioById(ctx.p.id).cash, cash);
  ctx.app.close();
});

test('partial fill books only the filled quantity, completion books the rest exactly once', async () => {
  const ctx = await setup({ live: true, clock: OPEN });
  enableLive(ctx);
  ctx.broker.enqueue({ status: 'PARTIALLY_FILLED', filledQty: 4, later: { status: 'FILLED', filledQty: 10 } });
  const res = await exec(ctx, addSignal(ctx));
  assert.equal(res.order.status, 'PARTIALLY_FILLED');
  assert.equal(pos(ctx).qty, 4);
  await ctx.m.orders.processOpenOrders();
  await ctx.m.orders.processOpenOrders();
  assert.equal(ctx.store.getOrder(res.order.id).status, 'FILLED');
  assert.equal(pos(ctx).qty, 10);
  const fills = ctx.store.listTrades(ctx.p.id).filter((t) => t.orderId === res.order.id);
  assert.equal(fills.length, 2);
  assert.equal(fills.reduce((a, t) => a + t.qty, 0), 10);
  ctx.app.close();
});

test('broker rejection leaves the portfolio untouched', async () => {
  const ctx = await setup({ live: true, clock: OPEN });
  enableLive(ctx);
  ctx.broker.enqueue({ status: 'REJECTED', message: 'RMS: margin exceeded' });
  const res = await exec(ctx, addSignal(ctx));
  assert.equal(res.order.status, 'REJECTED');
  assert.match(res.order.error, /margin/);
  assert.equal(pos(ctx), null);
  assert.equal(ctx.store.getPortfolioById(ctx.p.id).cash, 1_000_000);
  ctx.app.close();
});

test('a lost response is recovered by tag lookup, never by placing a second order', async () => {
  const ctx = await setup({ live: true, clock: OPEN });
  enableLive(ctx);
  ctx.broker.enqueue({ status: 'UNKNOWN', lost: true, remoteStatus: 'FILLED', message: 'network timeout' });
  const res = await exec(ctx, addSignal(ctx));
  assert.equal(res.order.status, 'UNKNOWN');
  assert.equal(pos(ctx), null, 'unconfirmed order must not move the portfolio');
  const dup = await exec(ctx, addSignal(ctx));
  assert.equal(dup.duplicate, true);
  ctx.broker.remote.forEach((r) => {
    r.status = 'FILLED';
    r.filledQty = 10;
  });
  await ctx.m.orders.processOpenOrders();
  assert.equal(ctx.broker.placed.length, 1);
  assert.equal(ctx.store.getOrder(res.order.id).status, 'FILLED');
  assert.equal(pos(ctx).qty, 10);
  ctx.app.close();
});

test('an order the broker never shows is eventually FAILED, not assumed filled', async () => {
  const ctx = await setup({ live: true, clock: OPEN });
  enableLive(ctx);
  ctx.broker.enqueue({ status: 'UNKNOWN', throw: 'ECONNRESET' });
  const res = await exec(ctx, addSignal(ctx));
  assert.equal(res.order.status, 'UNKNOWN');
  for (let i = 0; i < 6; i += 1) await ctx.m.orders.processOpenOrders();
  assert.equal(ctx.store.getOrder(res.order.id).status, 'FAILED');
  assert.equal(pos(ctx), null);
  ctx.app.close();
});

test('risk limits clip an oversized BUY to what the portfolio can afford', async () => {
  const ctx = await setup({ live: true, clock: OPEN, capital: 200_000 });
  enableLive(ctx);
  const res = await exec(ctx, addSignal(ctx, { qty: 500 }));
  assert.ok(res.order.qty >= 1 && res.order.qty < 500, `clipped from 500 to ${res.order.qty}`);
  assert.ok(res.order.qty * res.order.limitPrice <= 200_000 * 0.36 + res.order.limitPrice);
  assert.ok(res.validation.find((s) => s.id === 'risk_limits').detail.includes('Clipped'));
  ctx.app.close();
});

test('insufficient funds and oversized price moves are rejected before reaching the broker', async () => {
  const ctx = await setup({ live: true, clock: OPEN, capital: 10_000 });
  enableLive(ctx);
  const big = await exec(ctx, addSignal(ctx, { qty: 500, key: 'big' }));
  assert.equal(big.rejected, true);
  assert.ok(big.validation.some((s) => !s.pass));
  const px = ctx.app.marketData.priceFor(SYMBOL).price;
  const moved = await exec(ctx, addSignal(ctx, { qty: 1, key: 'moved', priceRef: px * 0.8 }));
  assert.equal(moved.rejected, true);
  assert.match(moved.message, /moved/i);
  assert.equal(ctx.broker.placed.length, 0);
  ctx.app.close();
});

test('a stale signal expires instead of executing', async () => {
  const ctx = await setup();
  const res = await exec(ctx, addSignal(ctx, { asOf: '2026-09-01', key: 'old' }));
  assert.equal(res.rejected, true);
  assert.equal(ctx.store.getSignal(res.order.signalId).status, 'EXPIRED');
  ctx.app.close();
});

test('SELL is rejected with no position and clipped to the held quantity otherwise', async () => {
  const ctx = await setup();
  const none = await exec(ctx, addSignal(ctx, { action: 'EXIT', qty: 5, key: 'e0' }));
  assert.equal(none.rejected, true);
  await exec(ctx, addSignal(ctx, { qty: 10 }));
  const sold = await exec(ctx, addSignal(ctx, { action: 'EXIT', qty: 50, key: 'e1' }));
  assert.equal(sold.order.status, 'FILLED');
  assert.equal(sold.order.qty, 10);
  assert.equal(pos(ctx), null);
  ctx.app.close();
});

test('a queued order can be cancelled and never fills', async () => {
  const ctx = await setup();
  const s = ctx.m.config(USER).settings;
  ctx.store.saveSettings(USER, { ...s, paper: { ...s.paper, fillWhenClosed: false } });
  const res = await exec(ctx, addSignal(ctx));
  await ctx.m.orders.cancel({ orderId: res.order.id, userId: USER });
  assert.equal(ctx.store.getOrder(res.order.id).status, 'CANCELLED');
  ctx.state.now = OPEN;
  await ctx.m.orders.processOpenOrders();
  assert.equal(pos(ctx), null);
  ctx.app.close();
});

test('paper partial fills complete on reconcile without double counting', async () => {
  const ctx = await setup();
  const s = ctx.m.config(USER).settings;
  ctx.store.saveSettings(USER, { ...s, paper: { ...s.paper, partialFillPct: 0.4 } });
  const res = await exec(ctx, addSignal(ctx, { qty: 20 }));
  assert.equal(res.order.status, 'PARTIALLY_FILLED');
  assert.ok(pos(ctx).qty < 20);
  await ctx.m.orders.processOpenOrders();
  await ctx.m.orders.processOpenOrders();
  assert.equal(pos(ctx).qty, 20);
  ctx.app.close();
});
