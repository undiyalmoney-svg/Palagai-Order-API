'use strict';
const assert = require('assert');
const { decideLiveAction, signalId, hmToMin, SPEC } = require('./sr-live');

const trade = {
  date: '2026-09-05', side: 'BUY', option: 'CE',
  entryTime: '10:15', exitTime: '11:00', exitReason: 'CLOSE', target: 20, entryPrice: 25000,
};

assert.strictEqual(signalId('nifty', trade), 'nifty|2026-09-05|10:15');
assert.strictEqual(hmToMin('10:15'), 615);

assert.strictEqual(decideLiveAction({
  trade, nowHm: '10:20', alreadyOpen: false, squareOffHm: '15:15',
}), 'enter', 'fresh signal within 20 min must enter');

assert.strictEqual(decideLiveAction({
  trade, nowHm: '11:00', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'stale signal must not enter');

assert.strictEqual(decideLiveAction({
  trade, nowHm: '10:10', alreadyOpen: false, squareOffHm: '15:15',
}), 'wait');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'TARGET', exitTime: '10:18' },
  nowHm: '10:20', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip', 'already completed in engine — too late');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'TARGET', exitTime: '10:40' },
  nowHm: '10:20', alreadyOpen: true, squareOffHm: '15:15',
}), 'hold', 'target not yet reached');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'TARGET', exitTime: '10:40' },
  nowHm: '10:45', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit');

assert.strictEqual(decideLiveAction({
  trade: { ...trade, exitReason: 'STOP', exitTime: '10:25' },
  nowHm: '10:26', alreadyOpen: true, squareOffHm: '15:15',
}), 'exit', 'index loss cap must flatten');

assert.strictEqual(decideLiveAction({
  trade, nowHm: '15:16', alreadyOpen: false, squareOffHm: '15:15',
}), 'skip');

assert.ok(SPEC.crude, 'crude book registered');
assert.strictEqual(SPEC.crude.exchange, 'MCX');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '19:50', exitTime: '20:30', exitReason: 'CLOSE' },
  nowHm: '19:55', alreadyOpen: false, squareOffHm: SPEC.crude.session.squareOffHm,
}), 'enter', 'crude evening window still live');
assert.strictEqual(decideLiveAction({
  trade: { ...trade, entryTime: '19:50', exitTime: '20:30', exitReason: 'CLOSE' },
  nowHm: '23:20', alreadyOpen: true, squareOffHm: SPEC.crude.session.squareOffHm,
}), 'exit', 'crude square-off');

console.log('sr-live.selftest: ok');
