'use strict';
const assert = require('assert');
const {
  specGrid,
  simulate,
  searchSpecs,
  runDiscover,
  ENGINE,
  STRATEGY_FAMILY,
  RETIRED_FAMILIES,
} = require('./paper-discover');

assert.ok(specGrid().length > 8);
assert.strictEqual(ENGINE, 'or-failure');
assert.strictEqual(STRATEGY_FAMILY, 'opening-range-failure');
assert.ok(RETIRED_FAMILIES.includes('vwap-impulse'));
assert.ok(!/genie|trap|ee-wait|order-flow|vwap-impulse/i.test(ENGINE));

function bar(date, hm, o, h, l, c, volume = 1000) {
  const hh = String(Math.floor(hm / 100)).padStart(2, '0');
  const mm = String(hm % 100).padStart(2, '0');
  return { date: `${date}T${hh}:${mm}:00+0530`, open: o, high: h, low: l, close: c, volume };
}

/** Tight 15m OR, break above, fail back inside, then drift down (PE wins). */
function failHighDay(date) {
  const out = [];
  let minutes = 9 * 60 + 15;
  const end = 15 * 60 + 30;
  let px = 25000;
  while (minutes <= end) {
    const hm = Math.floor(minutes / 60) * 100 + (minutes % 60);
    let open = px;
    let close = px;
    let high = px + 6;
    let low = px - 6;
    if (hm < 930) {
      close = 25005;
      high = 25012;
      low = 24988;
      open = 25000;
    } else if (hm === 935) {
      open = 25010;
      close = 25040;
      high = 25042;
      low = 25008;
    } else if (hm === 940) {
      open = 25038;
      close = 25008;
      high = 25040;
      low = 25005;
    } else {
      close = px - 8;
      open = px;
      high = px + 2;
      low = close - 2;
    }
    out.push(bar(date, hm, open, high, low, close));
    px = close;
    minutes += 5;
  }
  return out;
}

const train = [];
for (let d = 1; d <= 10; d += 1) {
  train.push(...failHighDay(`2026-08-${String(d).padStart(2, '0')}`));
}
const test = failHighDay('2026-09-11');
const candles = [...train, ...test];

const found = searchSpecs(candles, { trainFrom: '2026-08-01', trainTo: '2026-08-10', lots: 1 });
assert.ok(found && found.spec);
assert.strictEqual(found.spec.family, STRATEGY_FAMILY);
assert.ok(found.totals.trades >= 1, 'train window should find OR-failure trades');

const testTrades = simulate(candles, found.spec, { fromDate: '2026-09-11', toDate: '2026-09-11', lots: 1 });
assert.ok(testTrades.length >= 1, 'found spec must trade the selected day');
assert.ok(testTrades.length <= 1, 'OR-failure is one trade per session');
assert.ok(testTrades.every((t) => String(t.entryTime).startsWith('2026-09-11')));
assert.strictEqual(testTrades[0].direction, 'PE');

runDiscover(
  {
    authorization: 'token x',
    fromDate: '2026-09-11',
    toDate: '2026-09-11',
    lots: 1,
  },
  { candles },
)
  .then((out) => {
    assert.strictEqual(out.engine, ENGINE);
    assert.strictEqual(out.strategy, STRATEGY_FAMILY);
    assert.ok(out.skipped.includes('vwap-impulse'));
    assert.ok(out.totals.trades >= 1);
    assert.match(out.note || '', /OR failure|opening-range failure/i);
    assert.doesNotMatch(out.specText || '', /VWAP impulse after/);
    console.log('paper-discover.selftest: ok', out.totals, out.specText);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
