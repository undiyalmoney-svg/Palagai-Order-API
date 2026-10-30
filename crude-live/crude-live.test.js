'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crude-live-'));
process.env.CRUDE_LIVE_STATE = path.join(dir, 'state.json');

const { DNA, toMin, weekMonday, weekShouldStandDown } = require('./dna');
const { resolveNextCrudeMiniFut } = require('./contract');
const scan = require('./scan');
const orders = require('./orders');
const store = require('./store');
const { createCrudeLiveRouter } = require('./routes');

const CSV = [
  'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
  '111,0,CRUDEOILM26OCTFUT,CRUDEOILM,0,2026-10-16,0,1,1,FUT,MCX-FUT,MCX',
  '222,0,CRUDEOILM26NOVFUT,CRUDEOILM,0,2026-11-17,0,1,1,FUT,MCX-FUT,MCX',
].join('\n');

function istAt(day, hm) {
  const [h, m] = hm.split(':').map(Number);
  return new Date(Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:05+05:30`));
}

function bar(day, t, o, h, l, c) {
  return { t, day, o, h, l, c, v: 1 };
}

function session(day, overlays = {}) {
  const out = [];
  for (let m = 9 * 60; m <= 23 * 60 + 10; m += 5) {
    const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const hit = overlays[t];
    out.push(hit ? bar(day, t, hit.o, hit.h, hit.l, hit.c) : bar(day, t, 5150, 5152, 5148, 5151));
  }
  return out;
}

test('DNA is all-session with week lock 80 and 1 lot', () => {
  assert.equal(DNA.entryStart, '09:00');
  assert.equal(DNA.entryEnd, '23:00');
  assert.equal(DNA.flatten, '23:10');
  assert.equal(toMin(DNA.entryStart), 9 * 60);
  assert.equal(DNA.stopPts, 20);
  assert.equal(DNA.targetPts, 40);
  assert.equal(DNA.maxTrades, 2);
  assert.equal(DNA.confirm, true);
  assert.equal(DNA.weekLockPts, 80);
  assert.equal(DNA.qty, 1);
  assert.equal(weekMonday('2026-08-19'), '2026-08-17');
  assert.equal(weekShouldStandDown(79), false);
  assert.equal(weekShouldStandDown(80), true);
});

test('expiry day rolls to the next CRUDEOILM future and never keeps the dying month', () => {
  const before = resolveNextCrudeMiniFut(CSV, new Date('2026-10-15T18:00:00+05:30'));
  assert.equal(before.tradingSymbol, 'CRUDEOILM26OCTFUT');
  assert.equal(before.instrumentToken, 111);
  assert.equal(before.expiryDay, false);

  const expiry = resolveNextCrudeMiniFut(CSV, new Date('2026-10-16T09:05:00+05:30'));
  assert.equal(expiry.tradingSymbol, 'CRUDEOILM26NOVFUT');
  assert.equal(expiry.instrumentToken, 222);
  assert.equal(expiry.expiryDay, true);
  assert.equal(expiry.expiry, '2026-11-17');

  const after = resolveNextCrudeMiniFut(CSV, new Date('2026-10-17T00:10:00+05:30'));
  assert.equal(after.tradingSymbol, 'CRUDEOILM26NOVFUT');

  const onlyFront = [
    'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
    '111,0,CRUDEOILM26OCTFUT,CRUDEOILM,0,2026-10-16,0,1,1,FUT,MCX-FUT,MCX',
  ].join('\n');
  const none = resolveNextCrudeMiniFut(onlyFront, new Date('2026-10-16T12:00:00+05:30'));
  assert.equal(none, null);
});

test('a 09:00 prior-day close is eligible after next-bar confirm — not evening-only', () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const bars = [
    ...session(prev, {
      '09:00': { o: 5100, h: 5200, l: 5100, c: 5150 },
      '23:00': { o: 5190, h: 5200, l: 5100, c: 5180 },
    }),
    ...session(day, {
      '09:00': { o: 5198, h: 5210, l: 5196, c: 5208 },
      '09:05': { o: 5209, h: 5218, l: 5208, c: 5216 },
    }),
  ];

  const tooEarly = scan.nextAction({ bars, now: istAt(day, '08:50') });
  assert.equal(tooEarly.action === 'enter', false);

  const signal = scan.nextAction({ bars, now: istAt(day, '09:05') });
  assert.equal(signal.action, 'pending');
  assert.equal(signal.pending.signalT, '09:00');
  assert.equal(signal.pending.dir, 1);

  const forming = scan.nextAction({
    bars,
    now: istAt(day, '09:07'),
    pending: signal.pending,
  });
  assert.equal(forming.action, 'wait-confirm');

  const fill = scan.nextAction({
    bars,
    now: istAt(day, '09:10'),
    pending: signal.pending,
  });
  assert.equal(fill.action, 'enter');
  assert.equal(fill.side, 'L');
  assert.equal(fill.fillPx, 5209);
  assert.equal(fill.stopPx, 5189);
  assert.equal(fill.targetPx, 5249);
  assert.equal(fill.signalT, '09:00');
});

test('skips a wild prior day and banks the week at +80 pts', () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const wild = [
    ...session(prev, {
      '09:00': { o: 5000, h: 5450, l: 5000, c: 5200 },
      '23:00': { o: 5400, h: 5450, l: 5000, c: 5300 },
    }),
    ...session(day, {
      '09:00': { o: 5300, h: 5460, l: 5290, c: 5455 },
      '09:05': { o: 5456, h: 5470, l: 5455, c: 5468 },
    }),
  ];
  const skipped = scan.nextAction({ bars: wild, now: istAt(day, '09:10') });
  assert.equal(skipped.action, 'wild-prev');

  const locked = scan.nextAction({
    bars: session(day),
    now: istAt(day, '20:00'),
    weekNetPts: 80,
  });
  assert.equal(locked.action, 'week-lock');
});

test('confirm failure clears the pending signal', () => {
  const prev = '2026-10-15';
  const day = '2026-10-16';
  const bars = [
    ...session(prev, {
      '09:00': { o: 5100, h: 5200, l: 5100, c: 5150 },
      '23:00': { o: 5190, h: 5200, l: 5100, c: 5180 },
    }),
    ...session(day, {
      '09:00': { o: 5198, h: 5210, l: 5196, c: 5208 },
      '09:05': { o: 5209, h: 5210, l: 5190, c: 5192 },
    }),
  ];
  const pending = { dir: 1, sig: 5208, signalT: '09:00' };
  const rejected = scan.nextAction({ bars, now: istAt(day, '09:10'), pending });
  assert.equal(rejected.action, 'reject-confirm');
  assert.equal(rejected.pending, null);
});

test('flatten at 23:10 and MCX MIS entry is 1 lot', () => {
  const fill = { instrument: 'CRUDEOILM26NOVFUT', exchange: 'MCX', side: 'L', qty: 1, entry: 5200, stop: 5180, target: 5240 };
  const eod = scan.decideExit({ fill, lastPx: 5210, now: istAt('2026-10-16', '23:10') });
  assert.equal(eod.action, 'flatten');
  assert.equal(eod.reason, 'EOD');
  const tp = scan.decideExit({ fill, lastPx: 5240, now: istAt('2026-10-16', '20:00') });
  assert.equal(tp.action, 'flatten');
  assert.equal(tp.reason, 'TARGET');
  const fields = orders.entryFields(fill);
  assert.equal(fields.exchange, 'MCX');
  assert.equal(fields.product, 'MIS');
  assert.equal(fields.quantity, '1');
  assert.equal(fields.tradingsymbol, 'CRUDEOILM26NOVFUT');
  assert.equal(orders.confirmOk({ confirm: true }), true);
  assert.equal(orders.confirmOk({ confirm: false }), false);
});

test('store stays disarmed across a new IST day and keeps the week net', () => {
  fs.rmSync(process.env.CRUDE_LIVE_STATE, { force: true });
  const monday = istAt('2026-10-19', '10:00');
  let state = store.load(monday);
  assert.equal(state.enabled, false);
  state.enabled = true;
  state.weekNetPts = 40;
  state.dayNetPts = 40;
  store.save(state);
  const tuesday = istAt('2026-10-20', '09:00');
  const next = store.load(tuesday);
  assert.equal(next.enabled, true);
  assert.equal(next.weekNetPts, 40);
  assert.equal(next.dayNetPts, 0);
  assert.equal(next.weekMonday, '2026-10-19');
  assert.equal(store.publicView(next).liveOrders, true);
  assert.equal(store.publicView(next).guaranteed, false);
});

test('live money start needs the confirm checkbox and stop reports liveOrders false', async () => {
  fs.rmSync(process.env.CRUDE_LIVE_STATE, { force: true });
  const app = express();
  app.use(express.json());
  const router = createCrudeLiveRouter({
    auth: {
      requireSiteUser: (req, _res, next) => {
        req.user = { id: 'owner-1', username: 'Devil', role: 'owner', modules: ['crude'] };
        next();
      },
      requireModule: () => (_req, _res, next) => next(),
    },
  });
  app.use('/crude-live', router);
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/crude-live/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthBody.liveOrders, false);
    assert.equal(healthBody.dna.entryStart, '09:00');

    const status = await fetch(`${base}/crude-live/status`);
    const statusBody = await status.json();
    assert.equal(status.status, 200);
    assert.equal(statusBody.liveOrders, false);
    assert.equal(statusBody.money.enabled, false);

    const bad = await fetch(`${base}/crude-live/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    });
    assert.equal(bad.status, 400);

    const noKite = await fetch(`${base}/crude-live/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(noKite.status, 400);

    const start = await fetch(`${base}/crude-live/start`, {
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
    assert.match(startBody.money.lastMessage, /09:00–23:00|next contract/i);

    const stop = await fetch(`${base}/crude-live/stop`, { method: 'POST' });
    const stopBody = await stop.json();
    assert.equal(stop.status, 200);
    assert.equal(stopBody.liveOrders, false);
    assert.equal(stopBody.money.enabled, false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
