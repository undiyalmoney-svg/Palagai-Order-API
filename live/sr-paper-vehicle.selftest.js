'use strict';
const assert = require('assert');
const { paperVehicleFor } = require('./sr-strategy-config');
const { SPEC } = require('./sr-live');

assert.strictEqual(SPEC.nifty.vehicle, 'fut', 'Live Nifty stays futures');
assert.strictEqual(paperVehicleFor('nifty', SPEC.nifty.vehicle), 'fut');
assert.strictEqual(paperVehicleFor('nifty', SPEC.nifty.vehicle, 'fut'), 'fut');
assert.strictEqual(paperVehicleFor('nifty', SPEC.nifty.vehicle, 'option'), 'option');
assert.strictEqual(paperVehicleFor('nifty', SPEC.nifty.vehicle, 'CE/PE'), 'option');
assert.strictEqual(paperVehicleFor('banknifty', SPEC.banknifty.vehicle, 'fut'), 'option');
assert.strictEqual(paperVehicleFor('crude', SPEC.crude.vehicle, 'option'), 'option');
assert.strictEqual(SPEC.nifty.vehicle, 'fut', 'Paper toggle must not mutate Live SPEC');
console.log('sr-paper-vehicle.selftest ok');
