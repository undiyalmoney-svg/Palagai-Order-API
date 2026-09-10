'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeGenieStrategy, DESK_STRATEGY_ID } = require('./genie-desk');

const s = makeGenieStrategy({ enableNifty: true, niftyMaxTradesDay: 3 }, 'nifty-50');
assert.strictEqual(s.id, DESK_STRATEGY_ID);
assert.strictEqual(s.id, 'align-combo-genie');

const worker = fs.readFileSync(path.join(__dirname, 'live.worker.js'), 'utf8');
assert.match(worker, /makeGenieStrategy/, 'Live worker must run Genie');
assert.doesNotMatch(worker, /createTrapStrategyV2\(\)/, 'Trap V2 must not be the live desk');

const ctrl = fs.readFileSync(path.join(__dirname, 'sr-breakout.controller.js'), 'utf8');
assert.match(ctrl, /S\/R Breakout Live is retired/, 'S/R Live start must be retired');

console.log('genie-desk.selftest: ok', s.id, s.name);
