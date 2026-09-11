'use strict';
const assert = require('assert');
const { findInstrumentInCsv } = require('./kite-market');
const {
  getOptionOhlcAndPrice,
  liveFromQuote,
  quoteKey,
  collectSymbols,
  splitExchangeSymbol,
} = require('./option-ohlc');

assert.strictEqual(quoteKey('NFO', 'NIFTY25SEP24500CE'), 'NFO:NIFTY25SEP24500CE');
assert.deepStrictEqual(splitExchangeSymbol('MCX:CRUDEOIL25SEPFUT'), {
  exchange: 'MCX',
  tradingSymbol: 'CRUDEOIL25SEPFUT',
});
assert.strictEqual(collectSymbols({ tradingSymbol: 'BANKNIFTY2591655000CE, RELIANCE259181400CE' }).length, 2);

const csv = [
  'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
  '999,1,RELIANCE259181400CE,RELIANCE,0,2026-09-18,1400,0.05,250,CE,NFO-OPT,NFO',
].join('\n');
const row = findInstrumentInCsv(csv, { tradingSymbol: 'RELIANCE259181400CE' });
assert.strictEqual(row.instrumentToken, 999);
assert.strictEqual(row.instrumentType, 'CE');

const live = liveFromQuote({
  last_price: 122.4,
  ohlc: { open: 100, high: 130, low: 95, close: 121 },
  volume: 10,
  oi: 50,
  depth: { buy: [{ price: 122.2 }], sell: [{ price: 122.6 }] },
  timestamp: '2026-09-11 10:00:00',
});
assert.strictEqual(live.price, 122.4);

(async () => {
  const market = {
    async lookupInstrument(_auth, q) {
      if (String(q.tradingSymbol || '').includes('RELIANCE')) {
        return {
          instrumentToken: 999,
          tradingSymbol: 'RELIANCE259181400CE',
          exchange: 'NFO',
          instrumentType: 'CE',
          strike: 1400,
          expiry: '2026-09-18',
          lotSize: 250,
          name: 'RELIANCE',
        };
      }
      if (String(q.tradingSymbol || '').includes('NIFTY25SEP24500CE') || Number(q.instrumentToken) === 111) {
        return {
          instrumentToken: 111,
          tradingSymbol: 'NIFTY25SEP24500CE',
          exchange: 'NFO',
          instrumentType: 'CE',
          strike: 24500,
          expiry: '2026-09-16',
          lotSize: 65,
          name: 'NIFTY',
        };
      }
      return null;
    },
    async fetchQuotes(_auth, keys) {
      const out = {};
      for (const k of keys) {
        out[k] = {
          last_price: 12.5,
          ohlc: { open: 10, high: 14, low: 9, close: 12 },
        };
      }
      return out;
    },
    async fetchHistoricalInterval() {
      return [
        { date: '2026-09-11T09:15:00+0530', open: 80, high: 85, low: 79, close: 84, volume: 1, oi: 9 },
        { date: '2026-09-11T09:20:00+0530', open: 84, high: 90, low: 83, close: 88, volume: 2, oi: 10 },
      ];
    },
    async fetchHistorical5m() {
      return [
        { date: '2026-09-11T09:15:00+0530', open: 80, high: 85, low: 79, close: 84, volume: 1, oi: 9 },
      ];
    },
    async fetchHistoricalCandles() {
      return [];
    },
  };

  const stock = await getOptionOhlcAndPrice(
    {
      authorization: 'token x:y',
      tradingSymbol: 'RELIANCE259181400CE',
      fromDate: '2026-09-01',
      toDate: '2026-09-11',
      historical: true,
      live: false,
    },
    { market },
  );
  assert.strictEqual(stock.atm, false);
  assert.strictEqual(stock.contracts[0].tradingSymbol, 'RELIANCE259181400CE');
  assert.strictEqual(stock.contracts[0].instrumentToken, 999);
  assert.strictEqual(stock.contracts[0].historical.length, 2);

  const two = await getOptionOhlcAndPrice(
    {
      authorization: 'token x:y',
      tradingSymbol: 'NIFTY25SEP24500CE, RELIANCE259181400CE',
      fromDate: '2026-09-11',
      toDate: '2026-09-11',
      live: false,
    },
    { market },
  );
  assert.strictEqual(two.contracts.length, 2);

  let threw = false;
  try {
    await getOptionOhlcAndPrice(
      {
        authorization: 'token x:y',
        tradingSymbol: 'NOTANOPTION',
        fromDate: '2026-09-11',
        toDate: '2026-09-11',
        live: false,
      },
      { market },
    );
  } catch (err) {
    threw = err.status === 400 && /Unknown option/.test(err.message);
  }
  assert.ok(threw, 'unknown option must 400');

  threw = false;
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
