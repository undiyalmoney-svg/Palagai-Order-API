'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { bucketForChange, classifyTrend, trendFromDailies, breadth } = require('./trend');
const { NIFTY_50, BANKNIFTY, SENSEX, listNifty50, listMembers, getIndex, listIndices } = require('./universe');
const { HeatmapService } = require('./service');
const { createHeatmapRouter } = require('./routes');
const { parseGrowwIndex, parseSparkResult, parseYahooChart, encodeQuery } = require('./public-feed');

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

test('universes: Nifty 50, Bank Nifty and Sensex', () => {
  assert.equal(listNifty50().length, 50);
  assert.equal(NIFTY_50.length, 50);
  assert.equal(BANKNIFTY.length, 12);
  assert.equal(SENSEX.length, 30);
  assert.equal(getIndex('NIFTY BANK').id, 'BANKNIFTY');
  assert.equal(getIndex('sensex').name, 'SENSEX');
  assert.equal(listIndices().length, 3);
  assert.ok(BANKNIFTY.some((u) => u.symbol === 'HDFCBANK'));
  assert.ok(BANKNIFTY.some((u) => u.symbol === 'BANKBARODA'));
  assert.ok(SENSEX.some((u) => u.symbol === 'RELIANCE'));
  assert.ok(listMembers('BANKNIFTY').every((u) => u.yahoo.endsWith('.NS')));
});

test('change buckets match the Groww chips', () => {
  assert.equal(bucketForChange(3.94), 'above-3');
  assert.equal(bucketForChange(1), '1-to--1');
  assert.equal(bucketForChange(-3.94), 'below--3');
});

test('strong up needs stacked EMAs plus ADX or a 52-week high', () => {
  assert.equal(classifyTrend({ close: 110, ema20: 105, ema50: 100, high52: 111, low52: 70, adx: 30 }).trend, 'strong-up');
  assert.equal(classifyTrend({ close: 70, ema20: 80, ema50: 90, high52: 120, low52: 68, adx: 28 }).trend, 'strong-down');
});

test('daily candles produce 52-week range and stacked EMAs', () => {
  const out = trendFromDailies(climb(80, 100, 1), 180);
  assert.equal(out.trend, 'strong-up');
  assert.ok(out.ema20 > out.ema50);
});

test('breadth counts advances and declines', () => {
  assert.deepEqual(
    breadth([{ changePct: 1.2 }, { changePct: -0.4 }, { changePct: 0 }, { changePct: null }]),
    { advances: 1, declines: 1, unchanged: 1 },
  );
});

test('Groww index OHLC and Yahoo spark parse to a quote', () => {
  const g = parseGrowwIndex({
    value: 22573.1,
    close: 22721.95,
    dayChange: -148.85,
    dayChangePerc: -0.655,
    yearHighPrice: 26373.2,
    yearLowPrice: 22179.9,
  });
  assert.equal(g.last_price, 22573.1);
  assert.ok(g.net_change < 0);
  assert.equal(g.high52, 26373.2);

  const spark = parseSparkResult({
    symbol: 'RELIANCE.NS',
    response: [
      {
        meta: {
          regularMarketPrice: 1178,
          regularMarketChangePercent: 0.89,
          fiftyTwoWeekHigh: 1600,
          fiftyTwoWeekLow: 900,
        },
        indicators: { quote: [{ close: [1160, 1178] }] },
      },
    ],
  });
  assert.equal(spark.symbol, 'RELIANCE.NS');
  assert.equal(spark.quote.last_price, 1178);
  assert.ok(spark.quote.net_change > 0);
});

test('Yahoo spark query encodes M&M so it is not a second param', () => {
  const q = encodeQuery({ symbols: 'RELIANCE.NS,M&M.NS,BAJAJ-AUTO.NS', range: '5d' });
  assert.equal(q.includes('M%26M.NS'), true);
  assert.equal(q.includes('M&M'), false);
});

test('Yahoo 1y chart becomes daily candles', () => {
  const ts = [1700000000, 1700086400, 1700172800];
  const parsed = parseYahooChart({
    chart: {
      result: [
        {
          meta: { regularMarketPrice: 120, regularMarketChangePercent: 1, fiftyTwoWeekHigh: 130, fiftyTwoWeekLow: 80 },
          timestamp: ts,
          indicators: {
            quote: [
              {
                open: [100, 110, 118],
                high: [105, 115, 121],
                low: [99, 108, 117],
                close: [104, 114, 120],
                volume: [1, 1, 1],
              },
            ],
          },
        },
      ],
    },
  });
  assert.equal(parsed.candles.length, 3);
  assert.equal(parsed.candles[2].close, 120);
  assert.equal(parsed.quote.high52, 130);
});

test('public Yahoo/Groww quotes work with no Kite session', async () => {
  const index = getIndex('NIFTY50');
  const members = listMembers('NIFTY50');
  const quotes = { [index.kiteKey]: { last_price: 22573.1, net_change: -148.85, ohlc: { close: 22721.95 } } };
  for (const u of members) {
    quotes[u.kiteKey] = {
      last_price: 180,
      net_change: 2,
      ohlc: { close: 178 },
      high52: 200,
      low52: 100,
    };
  }
  let kiteCalls = 0;
  const service = new HeatmapService({
    getAuthorization: async () => null,
    fetchPublicQuotes: async () => ({ quotes, source: 'yahoo' }),
    fetchPublicDailies: async () => ({ candles: climb(80, 90, 0.4), quote: { high52: 200, low52: 80 } }),
    fetchQuotes: async () => {
      kiteCalls += 1;
      throw new Error('kite should not run');
    },
    now: () => Date.parse('2026-10-14T07:32:00Z'),
    warmGapMs: 0,
  });
  const first = await service.snapshot('NIFTY50');
  assert.equal(first.session.source, 'yahoo');
  assert.equal(first.session.ok, true);
  assert.equal(first.companies.length, 50);
  assert.equal(first.indices.length, 3);
  assert.equal(kiteCalls, 0);
  assert.equal(first.companies[0].high52, 200);

  await service.warming.get('NIFTY50');
  const second = await service.snapshot('NIFTY50');
  assert.equal(second.session.dailiesReady, true);
  assert.ok(second.companies.every((c) => c.trend === 'strong-up' || c.trend === 'up'));
});

test('public heatmap never calls Kite when the public feed fails', async () => {
  let kiteCalls = 0;
  const service = new HeatmapService({
    getAuthorization: async () => 'token test:key',
    fetchPublicQuotes: async () => {
      throw new Error('yahoo down');
    },
    fetchQuotes: async () => {
      kiteCalls += 1;
      return {};
    },
    now: () => Date.parse('2026-10-14T07:32:00Z'),
    warmGapMs: 0,
  });
  const snap = await service.snapshot();
  assert.notEqual(snap.session.source, 'kite');
  assert.equal(kiteCalls, 0);
  assert.equal(snap.companies.length, 50);
  assert.equal(snap.session.ok, false);
});

test('GET /heatmap?index=BANKNIFTY is public', async () => {
  const index = getIndex('BANKNIFTY');
  const members = listMembers('BANKNIFTY');
  const quotes = { [index.kiteKey]: { last_price: 55204, net_change: -284, ohlc: { close: 55488 } } };
  for (const u of members) {
    quotes[u.kiteKey] = { last_price: 500, net_change: 1, ohlc: { close: 499 } };
  }
  const service = new HeatmapService({
    getAuthorization: async () => null,
    fetchPublicQuotes: async (idx) => {
      assert.equal(idx.id, 'BANKNIFTY');
      return { quotes, source: 'groww+yahoo' };
    },
    fetchPublicDailies: async () => ({ candles: [] }),
    now: () => Date.parse('2026-10-14T07:32:00Z'),
    warmGapMs: 0,
  });
  const app = express();
  app.use('/heatmap', createHeatmapRouter(service));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/heatmap?index=BANKNIFTY`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.public, true);
  assert.equal(body.index.name, 'NIFTY BANK');
  assert.equal(body.companies.length, 12);
  server.close();
});

test('empty board when the public feed is down', async () => {
  const service = new HeatmapService({
    getAuthorization: async () => null,
    fetchPublicQuotes: async () => {
      throw new Error('yahoo down');
    },
    now: () => Date.parse('2026-10-14T07:32:00Z'),
  });
  const snap = await service.snapshot('SENSEX');
  assert.equal(snap.index.name, 'SENSEX');
  assert.equal(snap.companies.length, 30);
  assert.equal(snap.session.ok, false);
  assert.ok(snap.warning);
});
