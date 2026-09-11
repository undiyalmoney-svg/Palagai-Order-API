'use strict';
const assert = require('assert');
const { getOptionOhlcAndPrice, liveFromQuote, quoteKey } = require('./option-ohlc');

assert.strictEqual(quoteKey('NFO', 'NIFTY25SEP24500CE'), 'NFO:NIFTY25SEP24500CE');
assert.strictEqual(quoteKey('NFO', 'nfo:abc'), 'NFO:ABC');

const live = liveFromQuote({
  last_price: 122.4,
  ohlc: { open: 100, high: 130, low: 95, close: 121 },
  volume: 10,
  oi: 50,
  depth: { buy: [{ price: 122.2 }], sell: [{ price: 122.6 }] },
  timestamp: '2026-09-11 10:00:00',
});
assert.strictEqual(live.price, 122.4);
assert.strictEqual(live.ohlc.high, 130);
assert.strictEqual(live.bid, 122.2);
assert.strictEqual(live.ask, 122.6);

(async () => {
  const market = {
    async fetchInstruments() {
      return [
        {
          instrumentToken: 111,
          tradingSymbol: 'NIFTY25SEP24500CE',
          exchange: 'NFO',
          instrumentType: 'CE',
          strike: 24500,
          expiry: '2026-09-16',
          lotSize: 65,
          name: 'NIFTY',
        },
      ];
    },
    async fetchQuotes(_auth, keys) {
      assert.ok(keys.includes('NFO:NIFTY25SEP24500CE'));
      return {
        'NFO:NIFTY25SEP24500CE': {
          instrument_token: 111,
          last_price: 88.5,
          ohlc: { open: 80, high: 90, low: 79, close: 88 },
        },
      };
    },
    async fetchHistorical5m() {
      return [
        { date: '2026-09-11T09:15:00+0530', open: 80, high: 85, low: 79, close: 84, volume: 1, oi: 9 },
        { date: '2026-09-11T09:20:00+0530', open: 84, high: 90, low: 83, close: 88, volume: 2, oi: 10 },
      ];
    },
    async fetchHistoricalCandles() {
      return [];
    },
  };

  const out = await getOptionOhlcAndPrice(
    {
      authorization: 'token x:y',
      tradingSymbol: 'NIFTY25SEP24500CE',
      fromDate: '2026-09-11',
      toDate: '2026-09-11',
      historical: true,
      live: true,
    },
    { market },
  );
  assert.strictEqual(out.contracts.length, 1);
  const c = out.contracts[0];
  assert.strictEqual(c.live.price, 88.5);
  assert.strictEqual(c.historical.length, 2);
  assert.strictEqual(c.price, 88.5);
  assert.strictEqual(c.lastBar.close, 88);

  const histOnly = await getOptionOhlcAndPrice(
    {
      authorization: 'token x:y',
      instrumentToken: 111,
      tradingSymbol: 'NIFTY25SEP24500CE',
      fromDate: '2026-09-11',
      toDate: '2026-09-11',
      live: false,
    },
    { market },
  );
  assert.strictEqual(histOnly.contracts[0].live, null);
  assert.strictEqual(histOnly.contracts[0].price, 88);

  let threw = false;
  try {
    await getOptionOhlcAndPrice({ tradingSymbol: 'X', historical: true, live: false }, { market });
  } catch (err) {
    threw = err.status === 400;
  }
  assert.ok(threw, 'missing kite session');

  console.log('option-ohlc.selftest: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
