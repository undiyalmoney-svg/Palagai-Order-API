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
{
  const hit = approveLiveEntry({
    sessionRunning: true, autoBotRunning: false, enteredCount: 2, maxTradesPerDay: 2,
    bookName: 'Nifty 50',
  });
  assert.strictEqual(hit.ok, false);
  assert.match(hit.reason, /max 2 Nifty 50 live entries today/);
  const open = approveLiveEntry({
    sessionRunning: true, autoBotRunning: false, enteredCount: 1, maxTradesPerDay: 2,
    bookName: 'Nifty 50',
  });
  assert.strictEqual(open.ok, true, 'one Nifty fill must not block the second Paper OPEN');
}
console.log('engine/risk.selftest: ok');
