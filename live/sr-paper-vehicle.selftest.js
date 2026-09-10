'use strict';
const assert = require('assert');
const { paperVehicleFor } = require('./sr-strategy-config');
const { SPEC } = require('./sr-live');

assert.strictEqual(SPEC.nifty.vehicle, 'option', 'Live Nifty buys CE/PE');
assert.strictEqual(paperVehicleFor('nifty', SPEC.nifty.vehicle), 'option');
assert.strictEqual(paperVehicleFor('nifty', SPEC.nifty.vehicle, 'fut'), 'fut');
assert.strictEqual(paperVehicleFor('nifty', SPEC.nifty.vehicle, 'option'), 'option');
assert.strictEqual(paperVehicleFor('nifty', SPEC.nifty.vehicle, 'CE/PE'), 'option');
assert.strictEqual(paperVehicleFor('banknifty', SPEC.banknifty.vehicle, 'fut'), 'option');
assert.strictEqual(paperVehicleFor('crude', SPEC.crude.vehicle, 'option'), 'option');
assert.strictEqual(SPEC.nifty.vehicle, 'option', 'Paper toggle must not mutate Live SPEC');
console.log('sr-paper-vehicle.selftest ok');
