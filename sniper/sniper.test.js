'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');
const orders = require('./orders');

test('live is armed when Live is on — all four sniper books can place', () => {
  const off = store.empty('2026-11-19');
  assert.equal(store.liveArmed(off), false);
  off.live = true;
  assert.equal(store.liveArmed(off), true);
  assert.equal(store.publicView(off).dropletPlacing, true);
  off.running = true;
  assert.equal(store.publicView(off).dropletWatching, true);
});

test('buy is MARKET MIS tagged PALAGAI_SNIPER; Crude Mini uses book qty; Sensex is BFO', () => {
  const nifty = {
    id: 'nifty',
    optionSymbol: 'NIFTY26N1224500CE',
    optionToken: 11,
    qty: 65,
    sl: 90,
  };
  const buy = orders.buyFields(nifty);
  assert.equal(buy.exchange, 'NFO');
  assert.equal(buy.tradingsymbol, nifty.optionSymbol);
  assert.equal(buy.order_type, 'MARKET');
  assert.equal(buy.quantity, '65');
  assert.equal(buy.tag, orders.BUY_TAG);
  assert.equal(orders.BUY_TAG, 'PALAGAI_SNIPER');
  const crude = orders.buyFields({
    id: 'crude',
    optionSymbol: 'CRUDEOILM26NOV8050PE',
    optionToken: 33,
    qty: 10,
  });
  assert.equal(crude.exchange, 'MCX');
  assert.equal(crude.quantity, '10');
  const sl = orders.stopFields({ ...nifty, id: 'sensex', optionSymbol: 'SENSEX26N1982200PE', optionToken: 22, qty: 20 });
  assert.equal(sl.exchange, 'BFO');
  assert.equal(sl.order_type, 'SL');
  assert.equal(sl.tag, orders.SL_TAG);
  assert.ok(Number(sl.price) < Number(sl.trigger_price));
  assert.ok((Number(sl.trigger_price) - Number(sl.price)) * 20 <= 20.05);
  assert.equal(orders.buyFields({ ...nifty, optionToken: 0 }), null);
});

test('a successful BUY id blocks another place; a reject does not', () => {
  const live = [
    { order_id: '1', tradingsymbol: 'NIFTY26NOV25000CE', transaction_type: 'BUY', tag: orders.BUY_TAG, status: 'REJECTED' },
    { order_id: '2', tradingsymbol: 'NIFTY26NOV25000CE', transaction_type: 'BUY', tag: orders.BUY_TAG, status: 'COMPLETE' },
  ];
  assert.equal(orders.openBuyId(live, 'NIFTY26NOV25000CE'), '2');
  assert.equal(orders.openBuyId(live.filter((o) => o.status === 'REJECTED'), 'NIFTY26NOV25000CE'), null);
});

test('same-day restart keeps fills so a second ticket is not opened after pm2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-'));
  const file = path.join(dir, 'state.json');
  const orig = store.paths.FILE;
  store.paths.FILE = file;
  try {
    const today = store.todayIst(new Date('2026-11-19T12:00:00+05:30'));
    const state = store.empty(today);
    state.running = true;
    state.session = {
      day: today,
      running: true,
      books: [{ id: 'nifty', fills: [{ n: 1, netRs: -98.4, entryMin: 560 }], skips: [] }],
    };
    store.save(state);
    const again = store.load(new Date('2026-11-19T12:05:00+05:30'));
    assert.equal(again.running, true);
    assert.equal(again.session.books[0].fills.length, 1);
    assert.equal(again.session.books[0].fills[0].netRs, -98.4);
  } finally {
    store.paths.FILE = orig;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty tab PUT does not wipe a droplet session that already has skips or fills', () => {
  const at = new Date('2026-11-20T12:00:00+05:30');
  const live = {
    day: '2026-11-20',
    books: [{ id: 'nifty', side: 'flat', reason: 'missed 09:40 open', fills: [], skips: [{ min: 580, reason: 'missed' }] }],
  };
  const emptySess = {
    day: '2026-11-20',
    books: [{ id: 'nifty', side: 'flat', reason: '', fills: [], skips: [] }],
  };
  assert.equal(store.takeSession(live, emptySess, at), live);
  assert.equal(store.takeSession(emptySess, live, at), live);
  assert.equal(store.takeSession(null, emptySess, at), emptySess);
});

test('a Friday tab PUT does not land on Monday’s blotter', () => {
  const monday = new Date('2026-11-23T09:10:00+05:30');
  const friday = {
    day: '2026-11-20',
    books: [{ id: 'nifty', fills: [{ netRs: -98 }], skips: [] }],
  };
  assert.equal(store.takeSession(null, friday, monday), null);
});

test('a new IST day archives fills then keeps Start for a fresh blotter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniper-'));
  const file = path.join(dir, 'state.json');
  const days = path.join(dir, 'days');
  const origFile = store.paths.FILE;
  const origDays = store.paths.DAYS;
  store.paths.FILE = file;
  store.paths.DAYS = days;
  try {
    const friday = new Date('2026-11-20T16:00:00+05:30');
    const state = store.empty(store.todayIst(friday));
    state.running = true;
    state.live = false;
    state.userId = 'u1';
    state.session = {
      day: '2026-11-20',
      books: [{ id: 'nifty', fills: [{ netRs: -98.4, entryMin: 560 }], skips: [] }],
    };
    store.save(state);
    const monday = store.load(new Date('2026-11-23T09:10:00+05:30'));
    assert.equal(monday.running, true);
    assert.equal(monday.session, null);
    const archived = JSON.parse(fs.readFileSync(path.join(days, '2026-11-20.json'), 'utf8'));
    assert.equal(archived.session.books[0].fills[0].netRs, -98.4);
  } finally {
    store.paths.FILE = origFile;
    store.paths.DAYS = origDays;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a new IST day keeps Start/Live but wipes the session for a fresh blotter', () => {
  const today = store.todayIst(new Date('2026-11-19T10:00:00+05:30'));
  const state = store.empty(today);
  state.live = true;
  state.running = true;
  state.userId = 'u1';
  const rolled = {
    ...store.empty('2026-11-20'),
    live: state.live === true,
    userId: state.userId,
    running: state.running === true,
  };
  assert.equal(rolled.live, true);
  assert.equal(rolled.running, true);
  assert.equal(rolled.session, null);
  assert.equal(store.liveArmed(rolled), true);
});

test('sniper tick bundle exports runSniperTick and emptySniperSession', () => {
  let sniper;
  try {
    sniper = require('./from-sniper/bundle');
  } catch (err) {
    assert.fail(`Sniper bundle missing: ${err.message}`);
    return;
  }
  assert.equal(typeof sniper.runSniperTick, 'function');
  assert.equal(typeof sniper.emptySniperSession, 'function');
  assert.equal(typeof sniper.sniperIstDay, 'function');
  const session = sniper.emptySniperSession('2026-11-19');
  assert.equal(session.books.length, 4);
  assert.equal(session.mode, 'paper');
  assert.equal(session.liveArmed, false);
});

test('droplet dumps five instrument CSVs together and reuses them for half an hour', () => {
  const js = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
  assert.match(js, /CSV_TTL_MS/);
  assert.match(js, /Promise\.all\(/);
  assert.match(js, /CSV_EXCHANGES\.map/);
  assert.match(js, /runSniperTick/);
  assert.match(js, /Kite token expired/);
  assert.doesNotMatch(js, /runPaperTick/);
});
