'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-live-'));
process.env.PDH_LIVE_STATE = path.join(dir, 'state.json');

const scan = require('./scan');
const orders = require('./orders');
const store = require('./store');
const { attachLiveMoneyRoutes } = require('./routes');
const { pdhFollowCandidate } = require('../orb-backtest/pdh-desk');

function sessionBars(day, overlays = {}) {
  const out = [];
  for (let m = 9 * 60 + 15; m <= 15 * 60 + 15; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const hit = overlays[t];
    out.push(
      hit
        ? { t, day, o: hit.o, h: hit.h, l: hit.l, c: hit.c, v: hit.v || 1000 }
        : { t, day, o: 100, h: 100.2, l: 99.8, c: 100.1, v: 1000 },
    );
  }
  return out;
}

function longCrowdDay(dayOverlays) {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const prevBars = sessionBars(prev, {
    '09:15': { o: 100, h: 101, l: 99.5, c: 100.8 },
    '15:15': { o: 101, h: 101.2, l: 100.8, c: 101 },
  });
  const first15 = {
    '09:15': { o: 101, h: 101.4, l: 100.8, c: 101.3 },
    '09:20': { o: 101.3, h: 101.5, l: 101.1, c: 101.4 },
    '09:25': { o: 101.4, h: 101.6, l: 101.2, c: 101.5 },
    '09:30': { o: 101.6, h: 102.4, l: 101.5, c: 102.3 },
    '09:35': { o: 102.3, h: 102.5, l: 102.2, c: 102.4 },
    '09:40': { o: 102.4, h: 102.6, l: 102.3, c: 102.5 },
  };
  return {
    prev,
    day,
    bars: sessionBars(day, { ...first15, ...dayOverlays }),
    prevBars,
  };
}

function istAt(day, hm) {
  const [h, m] = hm.split(':').map(Number);
  return new Date(Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:05+05:30`));
}

test('closedBars drops the forming 5-minute candle', () => {
  const day = '2026-10-16';
  const bars = sessionBars(day);
  const closed = scan.closedBars(bars, istAt(day, '11:22'));
  assert.equal(closed[closed.length - 1].t, '11:15');
  assert.equal(
    closed.some((b) => b.t === '11:20'),
    false,
  );
});

test('a 11:20 prior-day close is eligible; 09:50 is not the only scan time', () => {
  const late = longCrowdDay({
    '11:20': { o: 102.6, h: 103.8, l: 102.5, c: 103.5 },
  });
  const symbolBars = { AAA: { [late.prev]: late.prevBars, [late.day]: late.bars } };

  const tooEarly = scan.eligibleFromBars(symbolBars, {
    day: late.day,
    now: istAt(late.day, '09:55'),
    capital: 20000,
  });
  assert.equal(tooEarly.picked, null);

  const forming = scan.eligibleFromBars(symbolBars, {
    day: late.day,
    now: istAt(late.day, '11:22'),
    capital: 20000,
  });
  assert.equal(forming.picked, null);

  const later = scan.eligibleFromBars(symbolBars, {
    day: late.day,
    now: istAt(late.day, '11:25'),
    capital: 20000,
  });
  assert.ok(later.picked);
  assert.equal(later.picked.symbol, 'AAA');
  assert.equal(later.picked.side, 'L');
  assert.equal(later.picked.signalT, '11:20');
  assert.equal(later.crowd, 'L');
});

test('scans all names and keeps the widest stop among still-open breaks', () => {
  const hold = {};
  for (let m = 9 * 60 + 55; m <= 15 * 60 + 15; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    hold[t] = { o: 103.1, h: 103.3, l: 102.8, c: 103.0 };
  }
  const a = longCrowdDay({
    '09:50': { o: 102.6, h: 103.2, l: 102.5, c: 103.1 },
    ...hold,
  });
  const b = longCrowdDay({
    '11:20': { o: 102.6, h: 106.4, l: 102.5, c: 105.8 },
  });
  const symbolBars = {
    NARROW: { [a.prev]: a.prevBars, [a.day]: a.bars },
    WIDE: { [b.prev]: b.prevBars, [b.day]: b.bars },
  };
  const found = scan.eligibleFromBars(symbolBars, {
    day: a.day,
    now: istAt(a.day, '11:25'),
    capital: 20000,
  });
  assert.equal(found.signals.length, 2);
  assert.equal(found.picked.symbol, 'WIDE');
  assert.equal(found.picked.qty >= 1, true);
});

test('does not re-enter a name that already hit stop or 1R on later bars', () => {
  const stopped = longCrowdDay({
    '09:50': { o: 102.6, h: 103.4, l: 102.5, c: 103.3 },
    '09:55': { o: 103.3, h: 103.5, l: 100.9, c: 101.0 },
  });
  const symbolBars = { AAA: { [stopped.prev]: stopped.prevBars, [stopped.day]: stopped.bars } };
  const found = scan.eligibleFromBars(symbolBars, {
    day: stopped.day,
    now: istAt(stopped.day, '10:05'),
    capital: 20000,
  });
  assert.equal(found.picked, null);
  assert.equal(found.skipped[0].resolved, 'SL');
});

test('entry is NSE MIS MARKET; stop is SL-M; flatten is the other side after cancelling SL', () => {
  const long = { instrument: 'RELIANCE', exchange: 'NSE', side: 'L', qty: 2 };
  const short = { instrument: 'TCS', exchange: 'NSE', side: 'S', qty: 1 };
  assert.equal(orders.entryFields(long).order_type, 'MARKET');
  assert.equal(orders.entryFields(long).product, 'MIS');
  assert.equal(orders.entryFields(long).transaction_type, 'BUY');
  assert.equal(orders.entryFields(long).tag, 'PALAGAI_PDH');
  assert.equal(orders.entryFields(short).transaction_type, 'SELL');

  const slLong = orders.slFields(long, 101.05);
  assert.equal(slLong.order_type, 'SL-M');
  assert.equal(slLong.transaction_type, 'SELL');
  assert.equal(slLong.trigger_price, '101.05');
  assert.equal(slLong.tag, 'PALAGAI_PDH_SL');
  assert.equal(orders.slFields(short, 102.1).transaction_type, 'BUY');

  const exitLong = orders.exitFields(long, 2);
  assert.equal(exitLong.order_type, 'MARKET');
  assert.equal(exitLong.transaction_type, 'SELL');
  assert.equal(exitLong.tag, 'PALAGAI_PDH_EXIT');
  assert.equal(orders.exitFields(short, 1).transaction_type, 'BUY');

  const resting = orders.restingProtectIds(
    [
      { order_id: '1', tradingsymbol: 'RELIANCE', status: 'TRIGGER PENDING', product: 'MIS', order_type: 'SL-M' },
      { order_id: '2', tradingsymbol: 'RELIANCE', status: 'COMPLETE', product: 'MIS', order_type: 'SL-M' },
    ],
    'RELIANCE',
  );
  assert.deepEqual(resting, ['1']);
});

test('1R and 15:15 flatten; SL grace does not fire the exit', () => {
  const fill = { instrument: 'AAA', side: 'L', entry: 103, stop: 101, target: 105 };
  const map = new Map([['AAA', 1_000]]);
  assert.equal(orders.decideFillAction(fill, 105, 1_000 + orders.SL_GRACE_MS - 1, map).action, 'wait');
  assert.equal(orders.decideFillAction(fill, 105, 1_000 + orders.SL_GRACE_MS + 1, map).action, 'flatten');
  assert.equal(orders.decideFillAction(fill, 105, 1_000 + orders.SL_GRACE_MS + 1, map).reason, 'TARGET');
  assert.equal(orders.decideFillAction(fill, 101, Date.now() + 60_000).reason, 'SL');
  const eod = Date.parse('2026-10-16T15:16:00+05:30');
  assert.equal(orders.decideFillAction(fill, 104, eod).reason, 'EOD');
});

test('store stays disarmed until Start live money', () => {
  const empty = store.empty('2026-10-16');
  assert.equal(empty.enabled, false);
  assert.equal(store.publicView(empty).liveOrders, false);
  const next = store.upsertFill(empty, {
    instrument: 'RELIANCE',
    side: 'L',
    qty: 1,
    entry: 100,
    stop: 99,
    target: 101,
  });
  assert.equal(next.fills[0].instrument, 'RELIANCE');
  assert.equal(store.dropFill(next, 'RELIANCE').fills.length, 0);
});

test('live money start needs the confirm checkbox and stop reports liveOrders false', async () => {
  fs.rmSync(process.env.PDH_LIVE_STATE, { force: true });
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const guard = [
    (req, _res, next) => {
      req.user = { id: 'owner-1', username: 'Devil', role: 'owner' };
      next();
    },
  ];
  attachLiveMoneyRoutes(router, guard);
  app.use('/orb-backtest', router);
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const status = await fetch(`${base}/orb-backtest/live-today/status`);
    const statusBody = await status.json();
    assert.equal(status.status, 200);
    assert.equal(statusBody.liveOrders, false);

    const bad = await fetch(`${base}/orb-backtest/live-today/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    });
    assert.equal(bad.status, 400);

    const noKite = await fetch(`${base}/orb-backtest/live-today/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(noKite.status, 400);

    const start = await fetch(`${base}/orb-backtest/live-today/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kite-authorization': 'token key:secret',
      },
      body: JSON.stringify({ confirm: true }),
    });
    const startBody = await start.json();
    assert.equal(start.status, 200);
    assert.equal(startBody.liveOrders, true);
    assert.match(startBody.money.lastMessage, /14:30/);

    const stop = await fetch(`${base}/orb-backtest/live-today/stop`, { method: 'POST' });
    const stopBody = await stop.json();
    assert.equal(stop.status, 200);
    assert.equal(stopBody.liveOrders, false);
    assert.equal(stopBody.money.enabled, false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('pdh live candidate is still 1 name and 1R', () => {
  const c = pdhFollowCandidate(670, { liveLock: true });
  assert.equal(c.maxStocksPerDay, 1);
  assert.equal(c.targetR, 1);
  assert.equal(c.entryEnd, '14:30');
});
