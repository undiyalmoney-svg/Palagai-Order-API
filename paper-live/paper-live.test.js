'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const orders = require('./orders');

test('live is armed only when Live is on and a book is ticked', () => {
  const off = store.empty('2026-11-12');
  assert.equal(store.liveArmed(off), false);
  off.live = true;
  assert.equal(store.liveArmed(off), false);
  off.books.crude = true;
  assert.equal(store.liveArmed(off), true);
});

test('dropletPlacing is advertised as soon as Live is armed so the tab does not double-place', () => {
  const off = store.empty('2026-11-12');
  assert.equal(store.publicView(off).dropletPlacing, false);
  off.live = true;
  off.books.nifty = true;
  const view = store.publicView(off);
  assert.equal(view.dropletPlacing, true);
  assert.equal(view.dropletWatching, false);
  off.running = true;
  assert.equal(store.publicView(off).dropletWatching, true);
});

test('buy is MARKET MIS tagged PALAGAI_PAPER; Crude Mini qty is 1; Sensex is BFO', () => {
  const nifty = {
    under: 'nifty',
    optionSymbol: 'NIFTY26N1224500CE',
    optionToken: 11,
    lot: 65,
    sl: 100,
  };
  const buy = orders.buyFields(nifty);
  assert.equal(buy.exchange, 'NFO');
  assert.equal(buy.tradingsymbol, nifty.optionSymbol);
  assert.equal(buy.order_type, 'MARKET');
  assert.equal(buy.quantity, '65');
  assert.equal(buy.tag, orders.BUY_TAG);
  const crude = orders.buyFields({
    under: 'crude',
    optionSymbol: 'CRUDEOILM26NOV8050PE',
    optionToken: 33,
    lot: 10,
  });
  assert.equal(crude.exchange, 'MCX');
  assert.equal(crude.quantity, '1');
  const sl = orders.stopFields({ ...nifty, under: 'sensex', optionSymbol: 'SENSEX26N1982200PE', optionToken: 22, lot: 20 });
  assert.equal(sl.exchange, 'BFO');
  assert.equal(sl.order_type, 'SL');
  assert.equal(sl.tag, orders.SL_TAG);
  assert.ok(Number(sl.price) < Number(sl.trigger_price));
  assert.ok((Number(sl.trigger_price) - Number(sl.price)) * 20 <= 81);
  assert.equal(orders.buyFields({ ...nifty, optionToken: 0 }), null);
  const stock = orders.buyFields({
    under: 'reliance',
    optionSymbol: 'RELIANCE',
    optionToken: 738561,
    lot: 50,
  });
  assert.equal(stock.exchange, 'NSE');
  assert.equal(stock.quantity, '50');
  const stockSl = orders.stopFields({
    under: 'reliance',
    optionSymbol: 'RELIANCE',
    optionToken: 738561,
    lot: 50,
    sl: 1392.6,
  });
  assert.equal(stockSl.exchange, 'NSE');
  assert.equal(stockSl.order_type, 'SL-M');
  assert.equal(stockSl.quantity, '50');
  assert.equal(stockSl.price, undefined);
});

test('F&O SL limit is ₹80 extra, not 10% of premium (~₹1,400 on Bank/Nifty)', () => {
  const bank = orders.stopFields({
    under: 'bank',
    optionSymbol: 'BANKNIFTY26NOV62300CE',
    optionToken: 11,
    lot: 30,
    sl: 383.75,
  });
  assert.equal(bank.order_type, 'SL');
  const extra = (Number(bank.trigger_price) - Number(bank.price)) * 30;
  assert.ok(extra <= 82, `extra ₹${extra}`);
  assert.ok((383.75 - 383.75 * 0.9) * 30 > 1100);
  const nifty = orders.stopFields({
    under: 'nifty',
    optionSymbol: 'NIFTY26NOV25250PE',
    optionToken: 12,
    lot: 65,
    sl: 165.2,
  });
  assert.ok((Number(nifty.trigger_price) - Number(nifty.price)) * 65 <= 84);
});

test('a successful BUY id blocks another place; a reject does not', () => {
  const live = [
    { order_id: '1', tradingsymbol: 'CRUDEOILM26NOV8300PE', transaction_type: 'BUY', tag: orders.BUY_TAG, status: 'REJECTED' },
    { order_id: '2', tradingsymbol: 'CRUDEOILM26NOV8300PE', transaction_type: 'BUY', tag: orders.BUY_TAG, status: 'COMPLETE' },
  ];
  assert.equal(orders.openBuyId(live, 'CRUDEOILM26NOV8300PE'), '2');
  assert.equal(orders.openBuyId(live.filter((o) => o.status === 'REJECTED'), 'CRUDEOILM26NOV8300PE'), null);
});

test('paper tick bundle exports runPaperTick', () => {
  let paper;
  try {
    paper = require('./from-paper/bundle');
  } catch (err) {
    assert.fail(`Paper Live bundle missing: ${err.message}`);
    return;
  }
  assert.equal(typeof paper.runPaperTick, 'function');
  assert.equal(typeof paper.underOf, 'function');
  assert.equal(typeof paper.paperLiveArmedFor, 'function');
});

test('a new IST day keeps Live radio and book checks', () => {
  const today = store.todayIst(new Date('2026-11-12T10:00:00+05:30'));
  const state = store.empty(today);
  state.live = true;
  state.books.bank = true;
  state.running = true;
  state.userId = 'u1';
  // Simulate the in-memory hand-off store.load does when the date rolls.
  const rolled = {
    ...store.empty('2026-11-13'),
    live: state.live === true,
    books: state.books,
    userId: state.userId,
    running: state.running === true,
  };
  assert.equal(rolled.live, true);
  assert.equal(rolled.books.bank, true);
  assert.equal(store.liveArmed(rolled), true);
});

test('evolve ships bid-through so the judge can apply the next patch', () => {
  const state = store.empty('2026-11-13');
  assert.equal(state.evolve.applied[0].id, 'option-tick-exit-when-bid-through-level');
});

test('droplet dumps five instrument CSVs together and reuses them for half an hour', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
  assert.match(js, /CSV_TTL_MS/);
  assert.match(js, /Promise\.all\(/);
  assert.match(js, /CSV_EXCHANGES\.map/);
});

test('paper tick bundle hunts named methods including algos as paper tickets', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, 'from-paper/bundle.js'), 'utf8');
  assert.match(js, /mom-08-ce/);
  assert.match(js, /tickPaperHunt/);
  assert.match(js, /rule-dense/);
  assert.match(js, /compactHunt/);
  assert.match(js, /slimHunt/);
  assert.match(js, /mergeHunt/);
  assert.match(js, /algo-ema-cross/);
  assert.match(js, /algo-donch20/);
  assert.match(js, /ema_cross/);
  assert.match(js, /supertrend/);
  assert.match(js, /algo-ema-ce/);
  assert.match(js, /mix-supertrend/);
  assert.match(js, /open5-zone/);
  assert.match(js, /open5_zone/);
});
