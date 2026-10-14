'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { MarketDeskService } = require('./service');
const { createMarketDeskRouter } = require('./routes');
const { DeskTicker, parseTicks } = require('./ticker');
const { listNifty50, INDICES } = require('../heatmap/universe');

function bar(date, close, extra = {}) {
  return {
    date,
    open: extra.open ?? close - 0.5,
    high: extra.high ?? close + 1,
    low: extra.low ?? close - 1,
    close,
    volume: extra.volume ?? 1_000,
  };
}

function series(n, startPx, step, t0) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(bar(new Date(t0 + i * 15 * 60_000).toISOString(), startPx + i * step));
  return out;
}

function quotesMap() {
  const quotes = {
    'NSE:NIFTY 50': { last_price: 22640, net_change: -90, ohlc: { close: 22730 }, instrument_token: 256265 },
    'NSE:NIFTY BANK': { last_price: 55100, net_change: 120, ohlc: { close: 54980 }, instrument_token: 260105 },
    'BSE:SENSEX': { last_price: 74200, net_change: -80, ohlc: { close: 74280 }, instrument_token: 265 },
  };
  for (const u of listNifty50()) {
    quotes[u.kiteKey] = {
      last_price: 500 + u.mcapRank,
      net_change: u.mcapRank % 2 ? 4 : -3,
      ohlc: { close: 500 },
      instrument_token: 10_000 + u.mcapRank,
    };
  }
  return quotes;
}

test('demo snapshot is labelled when Kite is missing', async () => {
  const service = new MarketDeskService({
    getSessionAuthorization: async () => null,
    now: () => Date.parse('2026-10-14T05:00:00Z'),
  });
  const snap = await service.snapshot({ userId: 'owner-1' });
  assert.equal(snap.demo, true);
  assert.match(snap.warning, /DEMO/);
  assert.equal(snap.indices.length, 4);
  assert.equal(snap.indices.some((i) => i.id === 'CRUDEOILM'), true);
  assert.equal(snap.stocks.length, 50);
  assert.equal(snap.private, true);
});

test('snapshot uses only this user\'s authorization, never a shared desk token', async () => {
  const seen = [];
  const quotes = quotesMap();
  const service = new MarketDeskService({
    getSessionAuthorization: async (userId) => {
      seen.push(userId);
      return userId === 'owner-1' ? 'token key:secret' : null;
    },
    fetchQuotes: async (authorization, keys) => {
      assert.equal(authorization, 'token key:secret');
      assert.ok(keys.includes('NSE:NIFTY 50'));
      assert.ok(keys.length >= 50);
      return quotes;
    },
    fetchHistoricalCandles: async () => [],
    now: () => Date.parse('2026-10-14T05:00:00Z'),
    quoteTtlMs: 60_000,
    histGapMs: 0,
  });
  const other = await service.snapshot({ userId: 'visitor' });
  assert.equal(other.demo, true);
  const snap = await service.snapshot({ userId: 'owner-1', authorization: 'token key:secret' });
  assert.equal(snap.demo, false);
  assert.equal(snap.indices[0].ltp, 22640);
  assert.equal(snap.stocks.length, 50);
  assert.equal(typeof snap.session.istNow, 'string');
  assert.match(snap.session.istNow, /IST/);
  assert.ok(!JSON.stringify(snap).includes('secret'));
  assert.ok(!JSON.stringify(snap).includes('token key'));
});

test('Kite 401 becomes a reauth message, not invented prices', async () => {
  const service = new MarketDeskService({
    getSessionAuthorization: async () => 'token key:old',
    fetchQuotes: async () => {
      throw new Error('quote HTTP 401');
    },
    now: () => Date.parse('2026-10-14T05:00:00Z'),
  });
  const snap = await service.snapshot({ userId: 'owner-1', authorization: 'token key:old' });
  assert.equal(snap.needsReauth, true);
  assert.match(snap.session.message, /Get Token/);
});

test('unfinished candles stay potential after hist is loaded', async () => {
  const t0 = Date.parse('2026-10-13T03:45:00Z');
  const candles = series(80, 100, 0.2, t0);
  candles[candles.length - 1].close = 200;
  candles[candles.length - 1].high = 201;
  const lastStart = Date.parse(candles[candles.length - 1].date);
  const formingNow = lastStart + 60_000;
  const quotes = quotesMap();
  const service = new MarketDeskService({
    getSessionAuthorization: async () => 'token key:secret',
    fetchQuotes: async () => quotes,
    fetchHistoricalCandles: async (_a, token, _f, _t, interval) => {
      if (interval === '15minute') return candles;
      if (interval === '60minute') return series(80, 100, 0.2, t0);
      return series(80, 100, 0.2, t0);
    },
    now: () => formingNow,
    quoteTtlMs: 60_000,
    histGapMs: 0,
  });
  const snap = await service.snapshot({ userId: 'owner-1', authorization: 'token key:secret' });
  await service.warming.get('owner-1');
  const again = await service.snapshot({ userId: 'owner-1', authorization: 'token key:secret' });
  const nifty = again.indices.find((i) => i.id === 'NIFTY50');
  assert.ok(nifty);
  assert.notEqual(nifty.breakout15.status, 'confirmed');
});

test('GET /market-desk is not public', async () => {
  const service = new MarketDeskService({
    getSessionAuthorization: async () => null,
    now: () => Date.parse('2026-10-14T05:00:00Z'),
  });
  const app = express();
  app.use('/market-desk', createMarketDeskRouter(service));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/market-desk`);
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.status, 'error');
  assert.ok(!body.stocks);
  assert.ok(!body.indices);
  const health = await fetch(`http://127.0.0.1:${port}/market-desk/health`);
  const h = await health.json();
  assert.equal(h.public, false);
  server.close();
});

test('authed snapshot does not leak another user\'s quotes', async () => {
  const service = new MarketDeskService({
    getSessionAuthorization: async (id) => (id === 'owner-1' ? 'token key:secret' : null),
    fetchQuotes: async () => quotesMap(),
    fetchHistoricalCandles: async () => [],
    now: () => Date.parse('2026-10-14T05:00:00Z'),
    quoteTtlMs: 60_000,
    histGapMs: 0,
  });
  const app = express();
  app.use(
    '/market-desk',
    createMarketDeskRouter(service, {
      auth: {
        requireSiteUser: (req, res, next) => {
          req.user = { id: req.headers['x-user'], modules: ['auto'], role: 'owner' };
          next();
        },
        requireModule: () => (_req, _res, next) => next(),
      },
    }),
  );
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const mine = await fetch(`http://127.0.0.1:${port}/market-desk`, {
    headers: { 'x-user': 'owner-1', 'X-Kite-Authorization': 'token key:secret' },
  });
  const body = await mine.json();
  assert.equal(mine.status, 200);
  assert.equal(body.demo, false);
  const other = await fetch(`http://127.0.0.1:${port}/market-desk`, { headers: { 'x-user': 'friend-2' } });
  const otherBody = await other.json();
  assert.equal(otherBody.demo, true);
  server.close();
});

test('duplicate alerts respect cooldown', async () => {
  const t0 = Date.parse('2026-10-13T03:45:00Z');
  const now = t0 + 90 * 15 * 60_000;
  const candles = series(90, 100, 0.4, t0);
  candles[candles.length - 1].close = 180;
  candles[candles.length - 1].high = 181;
  const service = new MarketDeskService({
    getSessionAuthorization: async () => 'token key:secret',
    fetchQuotes: async () => quotesMap(),
    fetchHistoricalCandles: async (_a, _t, _f, _to, interval) => (interval === '15minute' ? candles : series(90, 100, 0.2, t0)),
    now: () => now,
    quoteTtlMs: 60_000,
    histGapMs: 0,
  });
  await service.snapshot({ userId: 'owner-1', authorization: 'token key:secret' });
  await service.warming.get('owner-1');
  const a = await service.snapshot({ userId: 'owner-1', authorization: 'token key:secret' });
  const b = await service.snapshot({ userId: 'owner-1', authorization: 'token key:secret' });
  const typesA = a.alerts.map((x) => `${x.symbol}:${x.type}`);
  const typesB = b.alerts.map((x) => `${x.symbol}:${x.type}`);
  for (const key of typesA) {
    assert.equal(typesB.includes(key), false, `cooldown should drop ${key}`);
  }
});

test('ticker restores subscribe after a disconnect', async () => {
  const sockets = [];
  class FakeWs {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.handlers = {};
      sockets.push(this);
      setTimeout(() => this.handlers.open && this.handlers.open(), 0);
    }
    on(type, fn) {
      this.handlers[type] = fn;
    }
    send(msg) {
      this.sent.push(msg);
    }
    close() {
      this.handlers.close && this.handlers.close();
    }
    terminate() {
      this.close();
    }
  }
  const ticker = new DeskTicker({ WebSocketImpl: FakeWs });
  ticker.reconnectMs = 20;
  ticker.adopt('token key:secret');
  ticker.setInstruments([{ symbol: 'NIFTY50', kiteKey: 'NSE:NIFTY 50', instrumentToken: 256265 }]);
  await ticker.ensure();
  assert.equal(ticker.connected, true);
  assert.ok(sockets[0].sent.some((s) => s.includes('subscribe')));
  sockets[0].close();
  assert.equal(ticker.connected, false);
  await new Promise((r) => setTimeout(r, 40));
  await ticker.opening;
  assert.ok(sockets.length >= 2);
  assert.ok(sockets[1].sent.some((s) => s.includes('subscribe')));
  ticker.stop();
});

test('parseTicks reads quote-mode packets', () => {
  const buf = Buffer.alloc(2 + 2 + 8);
  buf.writeInt16BE(1, 0);
  buf.writeInt16BE(8, 2);
  buf.writeInt32BE(256265, 4);
  buf.writeInt32BE(2264000, 8);
  const ticks = parseTicks(buf);
  assert.equal(ticks[0].instrumentToken, 256265);
  assert.equal(ticks[0].price, 22640);
});

test('desk snapshot includes Crude Oil Mini from the MCX front-month future', async () => {
  const quotes = quotesMap();
  quotes['MCX:CRUDEOILM26NOVFUT'] = {
    last_price: 5452,
    net_change: 30,
    ohlc: { close: 5422 },
    instrument_token: 111,
  };
  const service = new MarketDeskService({
    getSessionAuthorization: async () => 'token key:secret',
    fetchQuotes: async (_auth, keys) => {
      assert.ok(keys.some((k) => String(k).startsWith('MCX:')));
      return quotes;
    },
    fetchHistoricalCandles: async () => [],
    fetchInstrumentsCsv: async () =>
      [
        'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
        '111,0,CRUDEOILM26NOVFUT,CRUDEOILM,0,2026-11-17,0,1,1,FUT,MCX-FUT,MCX',
      ].join('\n'),
    now: () => Date.parse('2026-10-14T05:00:00Z'),
    quoteTtlMs: 60_000,
    histGapMs: 0,
  });
  const snap = await service.snapshot({ userId: 'owner-1', authorization: 'token key:secret' });
  const crude = snap.indices.find((i) => i.id === 'CRUDEOILM');
  assert.ok(crude);
  assert.equal(crude.name, 'Crude Oil Mini');
  assert.equal(crude.ltp, 5452);
});

test('index universes stay separate', () => {
  assert.equal(INDICES.length, 3);
  assert.equal(listNifty50().length, 50);
});
