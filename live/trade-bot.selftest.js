'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseTradeBotWindow, istToday } = require('./trade-bot-dates');
const genie = require('./genie-desk');

const now = new Date('2026-09-11T10:00:00+05:30');
assert.strictEqual(istToday(now), '2026-09-11');

const todayWin = parseTradeBotWindow({ today: true }, now);
assert.deepStrictEqual(todayWin, {
  fromDate: '2026-09-11',
  toDate: '2026-09-11',
  today: true,
  liveMoney: false,
  realOrders: false,
});

const paper = parseTradeBotWindow({ fromDate: '2026-08-01', toDate: '2026-08-15' }, now);
assert.strictEqual(paper.liveMoney, false);
assert.strictEqual(paper.realOrders, false);
assert.strictEqual(paper.fromDate, '2026-08-01');

const live = parseTradeBotWindow(
  { fromDate: '2026-09-11', toDate: '2026-09-11', liveMoney: true },
  now,
);
assert.strictEqual(live.liveMoney, true);
assert.strictEqual(live.realOrders, true);

let threw = false;
try {
  parseTradeBotWindow({ fromDate: '2026-08-01', toDate: '2026-08-15', liveMoney: true }, now);
} catch (err) {
  threw = true;
  assert.strictEqual(err.status, 400);
}
assert.ok(threw, 'live money on a past window must 400');

threw = false;
try {
  parseTradeBotWindow({ fromDate: '2026-09-20', toDate: '2026-09-22' }, now);
} catch (err) {
  threw = err;
}
assert.strictEqual(threw, false);

threw = false;
try {
  parseTradeBotWindow({}, now);
} catch (err) {
  threw = true;
  assert.strictEqual(err.status, 400);
}
assert.ok(threw);

assert.strictEqual(typeof genie.makeGenieStrategy, 'function');
assert.strictEqual(genie.DESK_STRATEGY_ID, 'align-combo-genie');

const ctrl = fs.readFileSync(path.join(__dirname, 'live.controller.js'), 'utf8');
assert.match(ctrl, /parseTradeBotWindow/);
assert.match(ctrl, /findEntryExitWait/);
assert.match(ctrl, /runEeWaitPaper/);
assert.match(ctrl, /Kite session required for live price or ATM lookup/);
assert.match(ctrl, /liveMoney/);
assert.doesNotMatch(ctrl, /Auto Bot is removed/);

const store = fs.readFileSync(path.join(__dirname, 'live.store.js'), 'utf8');
assert.doesNotMatch(store, /Auto Bot retired/);

console.log('trade-bot.selftest: ok');
