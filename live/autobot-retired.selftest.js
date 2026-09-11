'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ctrl = fs.readFileSync(path.join(__dirname, 'live.controller.js'), 'utf8');
assert.match(ctrl, /Auto Bot is removed/, 'POST /live/start must refuse Auto Bot');
const store = fs.readFileSync(path.join(__dirname, 'live.store.js'), 'utf8');
assert.match(store, /Auto Bot retired/, 'hydrate must not resume Auto Bot ticks');
console.log('autobot-retired.selftest: ok');
