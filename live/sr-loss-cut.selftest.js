'use strict';
/**
 * Shared paper/live loss cuts live in sr-strategy-config + Crude DNA.
 * failStop behaviour itself is covered by sr-bank-failstop.selftest.js
 * (must not be enabled on Bank).
 */
const assert = require('assert');
const { EXIT_RULES, exitOptsFor } = require('./sr-strategy-config');
const { PLAYBOOK } = require('./crude-bot-desk');

assert.strictEqual(EXIT_RULES.nifty.failStop, true);
assert.ok(!EXIT_RULES.banknifty.failStop, 'Bank must not get failStop');
assert.strictEqual(EXIT_RULES.banknifty.timeStopBars, 4);
assert.strictEqual(exitOptsFor('nifty', 1).failStop, true);
assert.strictEqual(exitOptsFor('banknifty', 1).timeStopBars, 4);
assert.strictEqual(exitOptsFor('banknifty', 1).failStop, undefined);
assert.strictEqual(PLAYBOOK.maxTradesPerDay, 1);
assert.strictEqual(PLAYBOOK.entryEndHm, '19:00');
assert.strictEqual(PLAYBOOK.skipFadePriorDay, true);
assert.strictEqual(PLAYBOOK.fadeBufferPts, 10);
assert.strictEqual(PLAYBOOK.allowBuy, false);

console.log('sr-loss-cut.selftest: ok', {
  niftyFailStop: EXIT_RULES.nifty.failStop,
  bankTimeStop: EXIT_RULES.banknifty.timeStopBars,
  crudeMaxDay: PLAYBOOK.maxTradesPerDay,
  crudeEntryEnd: PLAYBOOK.entryEndHm,
  crudeSkipFade: PLAYBOOK.skipFadePriorDay,
});
