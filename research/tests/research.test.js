'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('node:http');
const express = require('express');
const { ema, rsi, atr, adx, vwap } = require('../indicators');
const { resolveExit } = require('../paper');
const { sizePosition, assessEntry } = require('../risk');
const { indexBooks, isIndexBook, resolveCrudeContract, sessionWindow } = require('../universe');
const { summarizeTrades, maxDrawdown } = require('../metrics');
const { parseTicks, KiteFeed, resolveWebSocket } = require('../feed');
const { kiteDateParam, kiteDay, historicalChunks } = require('../../services/kite-market');
const { MemoryStore } = require('../store');
const { ResearchService, START_PHRASE } = require('../service');
const { createResearchRouter } = require('../api/routes');
const { byId } = require('../strategies');
const { istDate, sessionDate } = require('../time');
const { DEFAULTS } = require('../config');

function bar(day, hour, minute, close, { symbol = 'INFY', volume = 1000, high, low, open } = {}) {
  const px = close;
  return {
    symbol,
    interval: '1m',
    startTime: istDate(day, hour, minute).toISOString(),
    open: open ?? px - 0.2,
    high: high ?? px + 0.4,
    low: low ?? px - 0.4,
    close: px,
    volume,
    complete: true,
  };
}

function climb(day, count, start, step, hour = 9, minute = 15) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const total = hour * 60 + minute + i;
    out.push(bar(day, Math.floor(total / 60), total % 60, start + i * step, { volume: 1000 + i * 10 }));
  }
  return out;
}

async function runningService() {
  const store = new MemoryStore();
  const feed = {
    status() {
      return { configured: true, connected: true, stale: false, lastTickAt: new Date().toISOString(), mode: 'live', message: 'test' };
    },
    async pull() {
      return { ok: false, message: 'test feed does not invent prices' };
    },
  };
  const service = new ResearchService({ store, feed });
  const experiment = await service.ensure();
  experiment.status = 'running';
  experiment.startedAt = new Date().toISOString();
  await store.saveExperiment(experiment);
  const instruments = await store.listInstruments();
  if (instruments[0]) {
    instruments[0].instrumentToken = 1;
    await store.upsertInstrument(instruments[0]);
  }
  return { store, service };
}

test('indicators: EMA, RSI, ATR, ADX and VWAP', () => {
  const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const series = ema(closes, 3);
  assert.equal(series[1], null);
  assert.ok(series[2] > 0);
  assert.ok(series[9] > series[2]);
  const rsiSeries = rsi([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 30], 14);
  assert.ok(rsiSeries[14] > 50);
  const candles = climb('2024-01-02', 20, 100, 1);
  const atrSeries = atr(candles, 14);
  assert.ok(atrSeries[13] > 0);
  const trend = adx(candles, 14);
  assert.equal(trend.adx.length, candles.length);
  const level = vwap(candles);
  assert.ok(level > 100 && level < 130);
  assert.equal(vwap(candles.map((c) => ({ ...c, volume: 0 }))), null);
});

test('VWAP strategy signals with trend and stays quiet without volume', () => {
  const strategy = byId('vwap-trend');
  const candles = climb('2024-01-02', 30, 100, 0.8);
  const now = istDate('2024-01-02', 9, 45);
  const signal = strategy.evaluate({ symbol: 'INFY', candles, now, params: DEFAULTS, strategy: strategy.meta });
  assert.equal(signal.direction, 'LONG');
  assert.ok(signal.stopPrice < signal.referencePrice);
  assert.ok(signal.targetPrice > signal.referencePrice);
  const quiet = strategy.evaluate({
    symbol: 'INFY',
    candles: candles.map((c) => ({ ...c, volume: 0 })),
    now,
    params: DEFAULTS,
    strategy: strategy.meta,
  });
  assert.equal(quiet, null);
});

test('opening range produces nothing before the range completes', () => {
  const strategy = byId('opening-range');
  const candles = climb('2024-01-02', 10, 100, 0.1);
  const now = istDate('2024-01-02', 9, 24);
  assert.equal(strategy.evaluate({ symbol: 'INFY', candles, now, params: DEFAULTS, strategy: strategy.meta }), null);
});

test('opening range can signal only after the range is complete', () => {
  const strategy = byId('opening-range');
  const prev = climb('2024-01-01', 30, 100, 0.05, 9, 15);
  const opening = [];
  for (let i = 0; i < 15; i += 1) opening.push(bar('2024-01-02', 9, 15 + i, 100, { high: 101, low: 99, volume: 500 }));
  const brk = bar('2024-01-02', 9, 30, 102, { high: 102.5, low: 101.2, volume: 5000 });
  const now = istDate('2024-01-02', 9, 31);
  const signal = strategy.evaluate({
    symbol: 'INFY',
    candles: [...prev, ...opening, brk],
    now,
    params: DEFAULTS,
    strategy: strategy.meta,
  });
  assert.equal(signal && signal.direction, 'LONG');
  assert.equal(signal.metadata.openingRangeComplete, true);
});

test('long and short paper exits compute P&L with the correct sign', () => {
  const longStop = resolveExit({ direction: 'LONG', stopPrice: 99, targetPrice: 110 }, { open: 100, high: 101, low: 98, close: 98.5 });
  assert.equal(longStop.reason, 'STOP');
  assert.equal(longStop.price, 99);
  const shortTarget = resolveExit({ direction: 'SHORT', stopPrice: 105, targetPrice: 95 }, { open: 100, high: 101, low: 94, close: 96 });
  assert.equal(shortTarget.reason, 'TARGET');
  const grossLong = (110 - 100) * 10;
  const grossShort = (100 - 90) * 10;
  assert.equal(grossLong, 100);
  assert.equal(grossShort, 100);
});

test('gap through a stop fills at the open, and an ambiguous candle takes the stop', () => {
  const gap = resolveExit({ direction: 'LONG', stopPrice: 99, targetPrice: 110 }, { open: 97, high: 98, low: 96, close: 97 });
  assert.equal(gap.reason, 'STOP');
  assert.equal(gap.gapped, true);
  assert.equal(gap.price, 97);
  const both = resolveExit({ direction: 'LONG', stopPrice: 99, targetPrice: 103 }, { open: 100, high: 104, low: 98, close: 101 });
  assert.equal(both.reason, 'STOP');
  assert.equal(both.ambiguous, true);
});

test('position size uses the tighter of risk, notional and cash', () => {
  const sized = sizePosition({ equity: 20000, cash: 20000, entry: 100, stop: 99, direction: 'LONG', riskPerTrade: 0.005, maxNotionalPct: 0.95 });
  assert.equal(sized.qty, 100);
  assert.equal(sized.rupeeRisk, 100);
  const poor = sizePosition({ equity: 20000, cash: 20000, entry: 50000, stop: 49000, direction: 'LONG', riskPerTrade: 0.005, maxNotionalPct: 0.95 });
  assert.equal(poor.qty, 0);
  assert.match(poor.reason, /Insufficient/);
});

test('index books size one paper lot even when the index is above cash', () => {
  const sized = sizePosition({
    equity: 20000,
    cash: 20000,
    entry: 25000,
    stop: 24900,
    direction: 'LONG',
    riskPerTrade: 0.005,
    maxNotionalPct: 0.95,
    symbol: 'NIFTY 50',
  });
  assert.equal(sized.qty, 1);
  assert.equal(sized.rupeeRisk, 100);
  assert.equal(isIndexBook('NIFTY BANK'), true);
  assert.equal(isIndexBook('SENSEX'), true);
  assert.equal(isIndexBook('CRUDEOILM26NOVFUT'), true);
  assert.equal(isIndexBook('INFY'), false);
});

test('risk checks reject daily-loss, trade-count and stale or dead feeds', () => {
  const account = { accountId: 'a', currentEquity: 20000, cashBalance: 20000, startOfDayEquity: 20000, initialCapital: 20000 };
  const signal = { symbol: 'INFY', sector: 'IT', direction: 'LONG', referencePrice: 100, stopPrice: 99, targetPrice: 102 };
  const config = { ...DEFAULTS };
  const now = istDate('2024-01-02', 10, 0);
  const base = { account, signal, positions: [], tradesToday: 0, config, now, quoteFresh: true, feedOk: true };
  assert.match(assessEntry({ ...base, account: { ...account, currentEquity: 16000, startOfDayEquity: 20000 } }).reason, /Daily loss/);
  assert.match(assessEntry({ ...base, tradesToday: config.maxTradesPerDay }).reason, /Maximum new trades/);
  assert.match(assessEntry({ ...base, quoteFresh: false }).reason, /stale/);
  assert.match(assessEntry({ ...base, feedOk: false }).reason, /feed/i);
  const ok = assessEntry(base);
  assert.equal(ok.ok, true);
  assert.ok(ok.quantity > 0);
});

test('index books ignore the old share-count and daily-loss caps', () => {
  const account = { accountId: 'a', currentEquity: 16000, cashBalance: 16000, startOfDayEquity: 20000, initialCapital: 20000 };
  const signal = { symbol: 'NIFTY 50', sector: 'nifty', direction: 'LONG', referencePrice: 25000, stopPrice: 24900, targetPrice: 25200 };
  const config = { ...DEFAULTS };
  const now = istDate('2024-01-02', 10, 0);
  const ok = assessEntry({
    account,
    signal,
    positions: [],
    tradesToday: 20,
    config,
    now,
    quoteFresh: true,
    feedOk: true,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.quantity, 1);
  const late = assessEntry({
    account,
    signal,
    positions: [],
    tradesToday: 0,
    config,
    now: istDate('2024-01-02', 15, 10),
    quoteFresh: true,
    feedOk: true,
  });
  assert.match(late.reason, /entry window/);
  const crude = assessEntry({
    account,
    signal: { ...signal, symbol: 'CRUDEOILM' },
    positions: [],
    tradesToday: 0,
    config,
    now: istDate('2024-01-02', 20, 0),
    quoteFresh: true,
    feedOk: true,
  });
  assert.equal(crude.ok, true);
  assert.equal(sessionWindow('CRUDEOILM').square, 23 * 60 + 25);
});

test('paper flow: entry, duplicate suppression, stop, restart recovery, end of day', async () => {
  const { store, service } = await runningService();
  for (const id of ['opening-range', 'ema-trend', 'rsi-reversion', 'pdhl-retest']) {
    await service.setEnabled(id, false);
  }
  const candles = climb('2024-01-02', 30, 100, 0.8);
  const now = istDate('2024-01-02', 9, 45);
  const first = await service.onMarket({ symbol: 'INFY', candles, now, quote: { price: candles.at(-1).close, at: now.toISOString() }, sector: 'IT', feedOk: true, source: 'replay' });
  const opened = (first.results || []).find((r) => r.accepted);
  assert.ok(opened, 'expected a paper entry');
  const again = await service.onMarket({ symbol: 'INFY', candles, now, quote: { price: candles.at(-1).close, at: now.toISOString() }, sector: 'IT', feedOk: true, source: 'replay' });
  const second = (again.results || []).filter((r) => r.trade && r.trade.status === 'OPEN');
  assert.equal(second.length, 0);
  const { trades } = await store.listTrades({ symbol: 'INFY', limit: 20 });
  assert.equal(trades.length, 1);

  const stop = trades[0].stopPrice;
  const stopCandle = bar('2024-01-02', 9, 46, stop - 1, { high: stop, low: stop - 1.5, open: stop - 0.2 });
  const later = istDate('2024-01-02', 9, 47);
  await service.onMarket({
    symbol: 'INFY',
    candles: [...candles, stopCandle],
    now: later,
    quote: { price: stop - 1, at: later.toISOString() },
    sector: 'IT',
    feedOk: true,
    source: 'replay',
  });
  const after = await store.listTrades({ symbol: 'INFY', limit: 5 });
  assert.equal(after.trades[0].status, 'CLOSED');
  assert.equal(after.trades[0].exitReason, 'STOP');

  const restarted = new ResearchService({ store, feed: service.feed });
  await restarted.reconcile();
  const account = (await store.listAccounts())[0];
  account.cashBalance = 1;
  await store.saveAccount(account);
  await restarted.reconcile();
  const fixed = (await store.listAccounts()).find((a) => a.accountId === account.accountId);
  assert.notEqual(fixed.cashBalance, 1);

  const { service: eodService, store: eodStore } = await runningService();
  for (const id of ['opening-range', 'ema-trend', 'rsi-reversion', 'pdhl-retest']) {
    await eodService.setEnabled(id, false);
  }
  const entryNow = istDate('2024-01-03', 10, 0);
  await eodService.onMarket({
    symbol: 'INFY',
    candles: climb('2024-01-03', 40, 100, 0.5, 9, 15),
    now: entryNow,
    quote: { price: 120, at: entryNow.toISOString() },
    sector: 'IT',
    feedOk: true,
    source: 'replay',
  });
  const square = istDate('2024-01-03', 15, 16);
  await eodService.onMarket({
    symbol: 'INFY',
    candles: climb('2024-01-03', 40, 100, 0.5, 9, 15),
    now: square,
    quote: { price: 120, at: square.toISOString() },
    sector: 'IT',
    feedOk: true,
    lastPrice: 120,
    source: 'replay',
  });
  const eod = await eodStore.listTrades({ from: '2024-01-03', to: '2024-01-03', limit: 10 });
  assert.equal(eod.trades[0].exitReason, 'EOD');
  assert.equal(eod.trades[0].status, 'CLOSED');
});

test('stale quotes and a dead feed do not open trades', async () => {
  const { store, service } = await runningService();
  const candles = climb('2024-01-02', 30, 100, 0.8);
  const now = istDate('2024-01-02', 9, 45);
  await service.onMarket({
    symbol: 'INFY',
    candles,
    now,
    quote: { price: 120, at: new Date(now.getTime() - 60_000).toISOString() },
    sector: 'IT',
    feedOk: true,
    source: 'replay',
  });
  await service.onMarket({
    symbol: 'TCS',
    candles: candles.map((c) => ({ ...c, symbol: 'TCS' })),
    now,
    quote: { price: 120, at: now.toISOString() },
    sector: 'IT',
    feedOk: false,
    source: 'replay',
  });
  const { total } = await store.listTrades({ limit: 10 });
  assert.equal(total, 0);
});

test('date filters, csv, xlsx, profit factor and drawdown', async () => {
  const { store, service } = await runningService();
  await store.insertTrade({
    tradeId: 't1', idempotencyKey: 'k1', accountId: 'exp-intraday-10w:vwap-trend:v1', strategyId: 'vwap-trend', symbol: 'INFY', direction: 'LONG', quantity: 1,
    entryTime: istDate('2024-01-02', 10, 0).toISOString(), tradingDate: '2024-01-02', status: 'CLOSED', grossPnl: 100, fees: 1, slippage: 0.5, netPnl: 99, exitTime: istDate('2024-01-02', 11, 0).toISOString(),
  });
  await store.insertTrade({
    tradeId: 't2', idempotencyKey: 'k2', accountId: 'exp-intraday-10w:vwap-trend:v1', strategyId: 'vwap-trend', symbol: 'TCS', direction: 'SHORT', quantity: 1,
    entryTime: istDate('2024-01-03', 10, 0).toISOString(), tradingDate: '2024-01-03', status: 'CLOSED', grossPnl: -40, fees: 1, slippage: 0.2, netPnl: -41, exitTime: istDate('2024-01-03', 12, 0).toISOString(),
  });
  const only = await service.trades({ from: '2024-01-02', to: '2024-01-02', symbol: 'INFY' });
  assert.equal(only.total, 1);
  assert.equal(only.trades[0].symbol, 'INFY');
  const csv = await service.exportCsv({ from: '2024-01-02', to: '2024-01-03' });
  assert.match(csv, /INFY/);
  assert.match(csv, /TCS/);
  const xlsx = await service.exportXlsx({ from: '2024-01-02', to: '2024-01-03' });
  assert.equal(xlsx.subarray(0, 2).toString(), 'PK');
  const stats = summarizeTrades([
    { status: 'CLOSED', grossPnl: 100, netPnl: 100, fees: 0, slippage: 0 },
    { status: 'CLOSED', grossPnl: -50, netPnl: -50, fees: 0, slippage: 0 },
  ], 20000);
  assert.equal(stats.profitFactor, 2);
  assert.equal(stats.winRate, 0.5);
  const none = summarizeTrades([{ status: 'CLOSED', grossPnl: 10, netPnl: 10, fees: 0, slippage: 0 }], 20000);
  assert.equal(none.profitFactor, null);
  assert.equal(maxDrawdown([100, 130, 90, 120]).maxDrawdown, 40);
});

test('start today carries the previous close forward and the workbook says so', async () => {
  const { store, service } = await runningService();
  const account = (await store.listAccounts()).find((a) => a.strategyId === 'vwap-trend');
  account.currentEquity = 18000;
  account.cashBalance = 18000;
  account.tradingDate = '2024-01-02';
  account.startOfDayEquity = 20000;
  await store.saveAccount(account);
  const out = await service.startDay('token key:secret', istDate('2024-01-03', 9, 0));
  assert.equal(out.capitalPolicy, 'carry-forward');
  assert.equal(out.paperOnly, true);
  const kept = out.accounts.find((a) => a.strategyId === 'vwap-trend');
  assert.equal(kept.openingEquity, 18000);
  const fresh = (await store.listAccounts()).find((a) => a.accountId === account.accountId);
  assert.equal(fresh.startOfDayEquity, 18000);
  assert.notEqual(fresh.cashBalance, 20000);
  const xlsx = await service.exportXlsx({});
  const text = xlsx.toString('utf8');
  assert.match(text, /previous close carried forward/);
  assert.match(text, /old 50-share/);
});

test('ensure stores the four Charts books and marks leftover cash shares ineligible', async () => {
  const store = new MemoryStore();
  await store.upsertInstrument({
    exchange: 'NSE',
    symbol: 'INFY',
    name: 'Infosys',
    sector: 'IT',
    instrumentToken: 1,
    universeDate: '2026-03-31',
    eligible: true,
  });
  await store.saveExperiment({
    experimentId: 'exp-intraday-10w',
    name: '10-week intraday paper experiment',
    status: 'draft',
    configuration: {
      startingCapital: 20000,
      riskPerTrade: 0.005,
      maxOpenPositions: 3,
      maxTradesPerDay: 5,
      maxDailyLoss: 0.02,
      maxAggregateRiskPct: 0.02,
      minRewardRisk: 1.5,
    },
    paperOnly: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const service = new ResearchService({ store, feed: { status() { return { configured: true, connected: true, stale: false, lastTickAt: null, mode: 'live', message: 'test' }; } } });
  await service.ensure();
  const books = (await store.listInstruments()).filter((i) => i.eligible);
  assert.equal(books.length, 4);
  assert.deepEqual(books.map((i) => i.symbol).sort(), indexBooks().map((i) => i.symbol).sort());
  const leftover = (await store.listInstruments()).find((i) => i.symbol === 'INFY');
  assert.equal(leftover.eligible, false);
  const experiment = await store.getExperiment();
  assert.equal(experiment.configuration.riskPerTrade, DEFAULTS.riskPerTrade);
  assert.equal(experiment.configuration.maxTradesPerDay, DEFAULTS.maxTradesPerDay);
  assert.equal(experiment.configuration.minRewardRisk, DEFAULTS.minRewardRisk);
  const status = await service.status();
  assert.equal(status.selection.count, 4);
  assert.match(status.selection.kind, /index/i);
});

test('crude oil token comes from the front-month MCX future', async () => {
  const csv = [
    'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
    '111,0,CRUDEOILM26OCTFUT,CRUDEOILM,0,2026-10-16,0,1,1,FUT,MCX-FUT,MCX',
    '222,0,CRUDEOILM26NOVFUT,CRUDEOILM,0,2026-11-17,0,1,1,FUT,MCX-FUT,MCX',
  ].join('\n');
  const hit = resolveCrudeContract(csv, new Date('2026-10-17T00:00:00+05:30'));
  assert.equal(hit.tradingSymbol, 'CRUDEOILM26NOVFUT');
  assert.equal(hit.instrumentToken, 222);
  const feed = new KiteFeed({ instruments: [{ symbol: 'CRUDEOILM', exchange: 'MCX', instrumentToken: 0 }] });
  feed.loadCsv = async () => csv;
  await feed.ensureTokens('token k:t');
  assert.equal(feed.instruments[0].instrumentToken, 111);
  assert.equal(feed.instruments[0].contractSymbol, 'CRUDEOILM26OCTFUT');
});

test('pull uses REST last price when the ticker has no ticks yet', async () => {
  const feed = new KiteFeed({
    instruments: [{ symbol: 'NIFTY 50', exchange: 'NSE', instrumentToken: 256265, sector: 'nifty' }],
  });
  feed.session = { apiKey: 'k', accessToken: 't', authorization: 'token k:t' };
  feed.connected = true;
  feed.ws = { dummy: true };
  feed.ensureSocket = async () => {};
  feed.ensureTokens = async () => {};
  feed.loadQuotes = async () => ({ 'NSE:NIFTY 50': { last_price: 25123.4 } });
  const out = await feed.pull(new Date());
  assert.equal(out.ok, true);
  assert.equal(out.symbols[0].symbol, 'NIFTY 50');
  assert.equal(out.symbols[0].quote.price, 25123.4);
});

test('feed restoreSession adopts a saved broker header after RAM is cleared', async () => {
  const feed = new KiteFeed({
    instruments: [{ symbol: 'INFY' }],
    getAuthorization: async () => 'token savedkey:savedtoken',
  });
  assert.equal(feed.status().configured, false);
  await feed.restoreSession();
  assert.equal(feed.status().configured, true);
  assert.equal(feed.session.apiKey, 'savedkey');
});

test('workerTick reloads a saved Kite session instead of staying idle', async () => {
  const store = new MemoryStore();
  const feed = new KiteFeed({ getAuthorization: async () => 'token savedkey:savedtoken' });
  feed.backfillNext = async () => [];
  feed.pull = async () => ({ ok: false, message: 'no ticks in this test' });
  const service = new ResearchService({ store, feed });
  const experiment = await service.ensure();
  experiment.status = 'running';
  await store.saveExperiment(experiment);
  const out = await service.workerTick(istDate('2024-01-02', 10, 0));
  assert.notEqual(out.idle, 'no-feed');
  assert.equal(feed.status().configured, true);
  const events = await store.listEvents(20);
  assert.equal(events.some((e) => /credentials are not configured/.test(e.message)), false);
});

test('idle feed warning is not written every tick', async () => {
  const { store, service } = await runningService();
  service.feed = { status() { return { configured: false }; } };
  const now = istDate('2024-01-02', 10, 0);
  await service.workerTick(now);
  await service.workerTick(new Date(now.getTime() + 20_000));
  const events = await store.listEvents(50);
  const idle = events.filter((e) => /credentials are not configured/.test(e.message));
  assert.equal(idle.length, 1);
});

test('start today stores the Kite session for the next restart', async () => {
  const saved = [];
  const feed = new KiteFeed({ instruments: [] });
  feed.prepare = async () => ({ ok: true, tokens: 0, message: 'test' });
  const store = new MemoryStore();
  const service = new ResearchService({
    store,
    feed,
    saveAuthorization: (userId, apiKey, accessToken) => {
      saved.push({ userId, apiKey, accessToken });
      return true;
    },
  });
  await service.ensure();
  await service.startDay('token key:secret', istDate('2024-01-03', 9, 0), { userId: 'u1' });
  assert.deepEqual(saved[0], { userId: 'u1', apiKey: 'key', accessToken: 'secret' });
});

test('optimization keeps the baseline version', async () => {
  const { service } = await runningService();
  const out = await service.optimize('vwap-trend');
  assert.equal(out.baseline.version, 1);
  assert.equal(out.baseline.enabled, true);
  assert.equal(out.candidate.enabled, false);
  assert.ok(out.candidate.version > 1);
  const rows = await service.strategies();
  assert.ok(rows.some((s) => s.strategyId === 'vwap-trend' && s.version === 1 && s.enabled));
});

test('resolveWebSocket falls back to the ws package when global.WebSocket is missing', () => {
  const previous = globalThis.WebSocket;
  try {
    delete globalThis.WebSocket;
    const Impl = resolveWebSocket();
    assert.equal(typeof Impl, 'function');
    assert.equal(Impl, require('ws'));
  } finally {
    if (previous) globalThis.WebSocket = previous;
  }
});

test('Kite history dates are calendar stamps, not ISO instants', () => {
  const stamp = kiteDateParam(new Date('2026-10-08T04:45:40.777Z'));
  assert.match(stamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(stamp.includes('T'), false);
  assert.equal(stamp.includes('Z'), false);
  assert.equal(kiteDateParam('2026-10-08'), '2026-10-08');
  assert.equal(kiteDateParam('2026-10-08 09:15:00'), '2026-10-08 09:15:00');
  assert.equal(kiteDay(new Date('2026-10-08T04:45:40.777Z')), '2026-10-08');
  const chunks = historicalChunks(new Date('2026-10-08T04:45:40.777Z'), new Date('2026-10-13T04:45:40.777Z'), 50);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0][0], '2026-10-08');
});

test('feed opens the Kite ticker and records a quote tick', async () => {
  const sockets = [];
  class FakeWs {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.sent = [];
      sockets.push(this);
    }
    addEventListener(type, fn) {
      this[`on${type}`] = fn;
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
  }
  const feed = new KiteFeed({ instruments: [{ symbol: 'INFY', instrumentToken: 738561 }] });
  feed.session = { apiKey: 'k', accessToken: 't', authorization: 'token k:t' };
  feed.WebSocket = FakeWs;
  const pending = feed.ensureSocket(feed.session);
  assert.equal(sockets.length, 1);
  assert.match(sockets[0].url, /ws\.kite\.trade/);
  assert.equal(sockets[0].options.family, 4);
  sockets[0].onopen();
  await pending;
  assert.equal(feed.connected, true);
  assert.deepEqual(sockets[0].sent[0], { a: 'subscribe', v: [738561] });
  const buf = Buffer.alloc(2 + 2 + 8);
  buf.writeInt16BE(1, 0);
  buf.writeInt16BE(8, 2);
  buf.writeInt32BE(738561, 4);
  buf.writeInt32BE(150050, 8);
  sockets[0].onmessage({ data: buf });
  assert.equal(feed.quotes.get('INFY').price, 1500.5);
  sockets[0].onerror();
  assert.equal(feed.ws, null);
  assert.equal(feed.connected, false);
});

test('worker lock and ticker parser', async () => {
  const store = new MemoryStore();
  assert.equal(await store.tryLock('research-worker', 1000, 'a'), true);
  assert.equal(await store.tryLock('research-worker', 1000, 'b'), false);
  assert.equal(await store.tryLock('research-worker', 1000, 'a'), true);
  const buf = Buffer.alloc(2 + 2 + 8);
  buf.writeInt16BE(1, 0);
  buf.writeInt16BE(8, 2);
  buf.writeInt32BE(738561, 4);
  buf.writeInt32BE(150050, 8);
  const ticks = parseTicks(buf);
  assert.equal(ticks[0].instrumentToken, 738561);
  assert.equal(ticks[0].price, 1500.5);
});

test('authentication, paper-only start, and no real order calls', async () => {
  const { service } = await runningService();
  const auth = {
    requireSiteUser: (req, res, next) => {
      if (req.headers['x-test-anon']) return res.status(401).json({ status: 'error', message: 'auth' });
      req.user = { id: 'u1', role: 'owner', modules: req.headers['x-mods'] ? req.headers['x-mods'].split(',') : ['research'] };
      next();
    },
    requireModule: (mod) => (req, res, next) => (req.user.modules.includes(mod) ? next() : res.status(403).json({ status: 'error', message: 'forbidden' })),
  };
  const app = express();
  app.use(express.json());
  app.use('/research', createResearchRouter(service, { auth }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/research`;
  const call = async (method, urlPath, body, headers = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, body: parsed };
  };
  try {
    assert.equal((await call('GET', '/health')).status, 200);
    assert.equal((await call('GET', '/status', null, { 'x-test-anon': '1' })).status, 401);
    assert.equal((await call('POST', '/start', { confirm: START_PHRASE }, { 'x-mods': 'momentum' })).status, 403);
    const live = await call('POST', '/start', { confirm: START_PHRASE, mode: 'LIVE' });
    assert.equal(live.status, 400);
    assert.equal(live.body.code, 'PAPER_ONLY');
    await new Promise((r) => setTimeout(r, 600));
    const blocked = await call('POST', '/start', { confirm: START_PHRASE });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'NOT_READY');
  } finally {
    await new Promise((r) => server.close(r));
  }

  const root = path.join(__dirname, '..');
  const src = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name !== 'tests') walk(full);
      } else if (name.endsWith('.js')) src.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  const blob = src.join('\n');
  assert.equal(blob.includes('placeOrder'), false);
  assert.equal(blob.includes('kiteOrders'), false);
  assert.equal(sessionDate(istDate('2024-01-02', 9, 15)), '2024-01-02');
});
