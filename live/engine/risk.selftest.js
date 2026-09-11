'use strict';
const assert = require('assert');
const { approveLiveStart, approveLiveEntry } = require('./risk');

assert.strictEqual(approveLiveStart({ autoBotRunning: true }).ok, false);
assert.strictEqual(approveLiveStart({ autoBotRunning: false }).ok, true);
assert.strictEqual(approveLiveEntry({
  sessionRunning: true, autoBotRunning: false, enteredCount: 3, maxTradesPerDay: 3,
}).ok, false);
assert.strictEqual(approveLiveEntry({
  sessionRunning: true, autoBotRunning: false, enteredCount: 0, maxTradesPerDay: 3,
}).ok, true);
console.log('engine/risk.selftest: ok');
