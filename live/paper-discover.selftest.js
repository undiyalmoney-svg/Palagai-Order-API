'use strict';
const assert = require('assert');
const {
  specGrid,
  simulate,
  searchSpecs,
  runDiscover,
  ENGINE,
  STRATEGY_FAMILY,
} = require('./paper-discover');

assert.ok(specGrid().length > 8);
assert.strictEqual(ENGINE, 'vwap-impulse');
assert.ok(!/genie|trap|ee-wait|order-flow/i.test(ENGINE));
assert.ok(!/genie|trap/i.test(STRATEGY_FAMILY));

function bar(date, hm, o, h, l, c, volume = 1000) {
  const hh = String(Math.floor(hm / 100)).padStart(2, '0');
  const mm = String(hm % 100).padStart(2, '0');
  return { date: `${date}T${hh}:${mm}:00+0530`, open: o, high: h, low: l, close: c, volume };
}

function sessionDay(date, { drift, impulseAt }) {
  const out = [];
  let px = 25000;
  let minutes = 9 * 60 + 15;
  const end = 15 * 60 + 30;
  while (minutes <= end) {
    const hm = Math.floor(minutes / 60) * 100 + (minutes % 60);
    const open = px;
    let close = px + drift;
    let high = Math.max(open, close) + 2;
    let low = Math.min(open, close) - 2;
    if (hm === impulseAt) {
      close = open + 25;
      high = close + 1;
      low = open - 1;
    }
    out.push(bar(date, hm, open, high, low, close));
    px = close;
    minutes += 5;
  }
  return out;
}

const train = [];
for (let d = 1; d <= 10; d += 1) {
  const day = String(d).padStart(2, '0');
  train.push(...sessionDay(`2026-08-${day}`, { drift: 1, impulseAt: 1000 }));
}
const test = sessionDay('2026-09-11', { drift: 1, impulseAt: 1000 });
const candles = [...train, ...test];

const found = searchSpecs(candles, { trainFrom: '2026-08-01', trainTo: '2026-08-10', lots: 1 });
assert.ok(found && found.spec);
assert.ok(found.totals.trades >= 1, 'train window should find impulse trades');

const testTrades = simulate(candles, found.spec, { fromDate: '2026-09-11', toDate: '2026-09-11', lots: 1 });
assert.ok(testTrades.length >= 1, 'found spec must trade the selected day');
assert.ok(testTrades.every((t) => String(t.entryTime).startsWith('2026-09-11')));
assert.ok(testTrades[0].optionPnlRs != null);

runDiscover({
  authorization: 'token x',
  fromDate: '2026-09-11',
  toDate: '2026-09-11',
  lots: 1,
}, {
  candles,
}).then((out) => {
  assert.strictEqual(out.engine, ENGINE);
  assert.strictEqual(out.strategy, STRATEGY_FAMILY);
  assert.ok(out.totals.trades >= 1);
  assert.ok(out.spec);
  assert.match(out.note || '', /VWAP impulse/);
  console.log('paper-discover.selftest: ok', out.totals, out.specText);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
