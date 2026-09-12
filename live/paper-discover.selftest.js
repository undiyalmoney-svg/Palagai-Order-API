'use strict';
const assert = require('assert');
const {
  specGrid,
  simulate,
  searchSpecs,
  runDiscover,
  simulateInsideDay,
  searchInsideDay,
  ENGINE,
  STRATEGY_FAMILY,
  RETIRED_FAMILIES,
  BOOKS,
} = require('./paper-discover');

assert.ok(specGrid().length > 8);
assert.strictEqual(ENGINE, 'paper-desk');
assert.ok(RETIRED_FAMILIES.includes('vwap-impulse'));
assert.ok(BOOKS.bank.token);
assert.strictEqual(BOOKS.crude.lotSize, 10);
assert.ok(!/genie|trap|ee-wait|order-flow|vwap-impulse/i.test(ENGINE));

function bar(date, hm, o, h, l, c, volume = 1000) {
  const hh = String(Math.floor(hm / 100)).padStart(2, '0');
  const mm = String(hm % 100).padStart(2, '0');
  return { date: `${date}T${hh}:${mm}:00+0530`, open: o, high: h, low: l, close: c, volume };
}

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
for (let d = 1; d <= 31; d += 1) {
  train.push(...failHighDay(`2026-08-${String(d).padStart(2, '0')}`));
}
for (let d = 1; d <= 10; d += 1) {
  train.push(...failHighDay(`2026-09-${String(d).padStart(2, '0')}`));
}
const test = failHighDay('2026-09-11');
const candles = [...train, ...test];

const found = searchSpecs(candles, { trainFrom: '2026-08-01', trainTo: '2026-08-10', lots: 1 });
assert.ok(found && found.spec && !found.sitOut);
assert.ok(found.totals.trades >= 5);
assert.ok(found.totals.profitFactor >= 1.2);

const testTrades = simulate(candles, found.spec, { fromDate: '2026-09-11', toDate: '2026-09-11', lots: 1 });
assert.ok(testTrades.length >= 1);
assert.ok(testTrades.length <= 1);
assert.strictEqual(testTrades[0].direction, 'PE');

const daily = [];
let px = 100;
for (let d = 1; d <= 40; d += 1) {
  const date = `2026-07-${String(((d - 1) % 28) + 1).padStart(2, '0')}`;
  const month = d <= 28 ? '07' : '08';
  const day = d <= 28 ? d : d - 28;
  const iso = `2026-${month}-${String(day).padStart(2, '0')}`;
  if (d % 3 === 1) {
    daily.push({ date: iso, open: px, high: px + 10, low: px - 10, close: px + 4, volume: 1e6 });
    px += 4;
  } else if (d % 3 === 2) {
    daily.push({ date: iso, open: px, high: px + 3, low: px - 3, close: px + 1, volume: 1e6 });
    px += 1;
  } else {
    daily.push({ date: iso, open: px, high: px + 12, low: px - 1, close: px + 10, volume: 1e6 });
    px += 10;
  }
}
daily.push({ date: '2026-09-09', open: px, high: px + 10, low: px - 10, close: px + 2, volume: 1e6 });
daily.push({ date: '2026-09-10', open: px + 2, high: px + 5, low: px - 5, close: px + 3, volume: 1e6 });
daily.push({ date: '2026-09-11', open: px + 4, high: px + 16, low: px + 3, close: px + 14, volume: 1e6 });
const stockFound = searchInsideDay(daily, {
  trainFrom: '2026-07-01',
  trainTo: '2026-09-10',
  lots: 1,
  symbol: 'RELIANCE',
});
assert.ok(stockFound.spec);
const stockDay = simulateInsideDay(daily, stockFound.spec, {
  fromDate: '2026-09-11',
  toDate: '2026-09-11',
  lots: 1,
  symbol: 'RELIANCE',
});
assert.ok(stockDay.length >= 1);

runDiscover(
  {
    authorization: 'token x',
    fromDate: '2026-09-11',
    toDate: '2026-09-11',
    lots: 1,
  },
  {
    candlesByBook: { nifty: candles, bank: [], crude: [] },
    stockSeries: [{ symbol: 'RELIANCE', historical: daily }],
  },
)
  .then((out) => {
    assert.strictEqual(out.engine, ENGINE);
    assert.strictEqual(out.strategy, STRATEGY_FAMILY);
    assert.ok(out.books.some((b) => b.id === 'nifty' && b.totals.trades >= 1));
    assert.ok(out.books.some((b) => b.id === 'bank'));
    assert.ok(out.books.some((b) => b.id === 'crude'));
    assert.ok(out.books.some((b) => b.id === 'stocks'));
    assert.ok(out.stocks && Array.isArray(out.stocks.rows));
    assert.ok(out.stocks.scanned >= 1);
    assert.ok(out.totals.trades >= 1);
    console.log(
      'paper-discover.selftest: ok',
      out.totals,
      out.books.map((b) => `${b.id}:${b.sitOut ? 'sit' : b.totals.trades}`).join(','),
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
