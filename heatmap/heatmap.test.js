'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { bucketForChange, classifyTrend, trendFromDailies, breadth } = require('./trend');
const { NIFTY_50, INDEX, listNifty50 } = require('./universe');
const { HeatmapService } = require('./service');
const { createHeatmapRouter } = require('./routes');

function climb(n, start, step) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const close = start + i * step;
    out.push({
      date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1000,
    });
  }
  return out;
}

test('Nifty 50 heatmap universe has 50 cash names and the index key', () => {
  assert.equal(listNifty50().length, 50);
  assert.equal(NIFTY_50.length, 50);
  assert.equal(INDEX.kiteKey, 'NSE:NIFTY 50');
  assert.ok(NIFTY_50.some((u) => u.symbol === 'RELIANCE'));
  assert.ok(NIFTY_50.some((u) => u.symbol === 'HEROMOTOCO'));
  assert.ok(NIFTY_50.some((u) => u.symbol === 'ADANIENT'));
  assert.ok(NIFTY_50.some((u) => u.symbol === 'BEL'));
  assert.ok(!NIFTY_50.some((u) => u.symbol === 'LTIM'));
});

test('change buckets match the Groww chips', () => {
  assert.equal(bucketForChange(3.94), 'above-3');
  assert.equal(bucketForChange(3), '3-to-1');
  assert.equal(bucketForChange(1.01), '3-to-1');
  assert.equal(bucketForChange(1), '1-to--1');
  assert.equal(bucketForChange(0), '1-to--1');
  assert.equal(bucketForChange(-0.38), '1-to--1');
  assert.equal(bucketForChange(-1), '1-to--1');
  assert.equal(bucketForChange(-1.09), '-1-to--3');
  assert.equal(bucketForChange(-3), '-1-to--3');
  assert.equal(bucketForChange(-3.94), 'below--3');
  assert.equal(bucketForChange(null), '1-to--1');
});

test('strong up needs stacked EMAs plus ADX or a 52-week high', () => {
  const strong = classifyTrend({ close: 110, ema20: 105, ema50: 100, high52: 111, low52: 70, adx: 30 });
  assert.equal(strong.trend, 'strong-up');
  const upOnly = classifyTrend({ close: 110, ema20: 105, ema50: 100, high52: 200, low52: 70, adx: 10 });
  assert.equal(upOnly.trend, 'up');
  const strongDown = classifyTrend({ close: 70, ema20: 80, ema50: 90, high52: 120, low52: 68, adx: 28 });
  assert.equal(strongDown.trend, 'strong-down');
  const side = classifyTrend({ close: 100, ema20: 99, ema50: 101, high52: 120, low52: 80, adx: 12 });
  assert.equal(side.trend, 'sideways');
  const reading = classifyTrend({ close: 100 });
  assert.equal(reading.trend, 'reading');
});

test('daily candles produce 52-week range and stacked EMAs', () => {
  const candles = climb(80, 100, 1);
  const out = trendFromDailies(candles, 180);
  assert.equal(out.trend, 'strong-up');
  assert.ok(out.ema20 > out.ema50);
  assert.ok(out.high52 >= 100);
  assert.ok(out.low52 <= 100);
});

test('breadth counts advances and declines', () => {
  const b = breadth([
    { changePct: 1.2 },
    { changePct: -0.4 },
    { changePct: 0 },
    { changePct: null },
  ]);
  assert.deepEqual(b, { advances: 1, declines: 1, unchanged: 1 });
});

test('snapshot paints quotes immediately and trends after dailies', async () => {
  const quotes = {
    'NSE:NIFTY 50': { last_price: 22634.5, net_change: -87.45, ohlc: { close: 22721.95 }, instrument_token: 256265 },
  };
  for (const u of listNifty50()) {
    quotes[u.kiteKey] = {
      last_price: 180,
      net_change: u.mcapRank % 2 === 0 ? 2.2 : -1.5,
      ohlc: { close: u.mcapRank % 2 === 0 ? 177.8 : 181.5 },
      instrument_token: 1000 + u.mcapRank,
    };
  }
  const service = new HeatmapService({
    getAuthorization: async () => 'token test:key',
    fetchQuotes: async () => quotes,
    fetchHistoricalCandles: async () => climb(80, 90, 0.4),
    now: () => Date.parse('2026-10-14T07:32:00Z'),
    warmGapMs: 0,
  });
  const first = await service.snapshot();
  assert.equal(first.public, true);
  assert.equal(first.index.name, 'NIFTY 50');
  assert.equal(first.index.ltp, 22634.5);
  assert.equal(first.companies.length, 50);
  assert.equal(first.companies[0].trend, 'reading');
  assert.ok(first.advances + first.declines > 0);
  assert.ok(String(first.warning || '').includes('warm'));

  await service.warming;
  const second = await service.snapshot();
  assert.equal(second.session.dailiesReady, true);
  assert.ok(second.companies.every((c) => c.trend === 'strong-up' || c.trend === 'up'));
  assert.ok(second.companies[0].high52 > 0);
  const shriram = second.companies.find((c) => c.symbol === 'SHRIRAMFIN');
  assert.ok(shriram);
  assert.equal(typeof shriram.bucket, 'string');
});

test('GET /heatmap is public and does not require a site token', async () => {
  const quotes = {
    'NSE:NIFTY 50': { last_price: 22634.5, net_change: -87.45, ohlc: { close: 22721.95 }, instrument_token: 256265 },
  };
  for (const u of listNifty50()) {
    quotes[u.kiteKey] = {
      last_price: 500,
      net_change: 1,
      ohlc: { close: 499 },
      instrument_token: 1,
    };
  }
  const service = new HeatmapService({
    getAuthorization: async () => 'token test:key',
    fetchQuotes: async () => quotes,
    fetchHistoricalCandles: async () => [],
    now: () => Date.parse('2026-10-14T07:32:00Z'),
    warmGapMs: 0,
  });
  const app = express();
  app.use('/heatmap', createHeatmapRouter(service));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/heatmap/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.public, true);
  const res = await fetch(`http://127.0.0.1:${port}/heatmap`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.public, true);
  assert.equal(body.companies.length, 50);
  server.close();
});

test('missing desk session still returns an empty public board', async () => {
  const service = new HeatmapService({
    getAuthorization: async () => null,
    fetchQuotes: async () => {
      throw new Error('should not call kite');
    },
    now: () => Date.parse('2026-10-14T07:32:00Z'),
  });
  const snap = await service.snapshot();
  assert.equal(snap.session.ok, false);
  assert.equal(snap.companies.length, 50);
  assert.ok(snap.warning);
});
