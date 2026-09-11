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
    await getOptionOhlcAndPrice(
      {
        tradingSymbol: 'X',
        fromDate: '2026-09-11',
        toDate: '2026-09-11',
        historical: true,
        live: false,
      },
      { market },
    );
  } catch (err) {
    threw = err.status === 400 && /Unknown option/.test(err.message);
  }
  assert.ok(threw, 'unparseable option must 400');

  let nseCalls = 0;
  const expired = await getOptionOhlcAndPrice(
    {
      tradingSymbol: 'NIFTY21JUN15600CE',
      fromDate: '2021-06-01',
      toDate: '2021-06-24',
      historical: true,
      live: false,
      interval: '5minute',
    },
    {
      market,
      nseHistory: {
        async fetchExpiredOptionDayCandles(q) {
          nseCalls += 1;
          assert.strictEqual(q.tradingSymbol, 'NIFTY21JUN15600CE');
          return {
            source: 'nse',
            interval: 'day',
            note: 'NSE expired/listed option history is end-of-day OHLC (foCPV), not intraday.',
            parsed: {
              tradingSymbol: 'NIFTY21JUN15600CE',
              underlying: 'NIFTY',
              optionType: 'CE',
              strike: 15600,
              expiryIso: '2021-06-24',
              expiryNse: '24-JUN-2021',
            },
            historical: [
              {
                date: '2021-06-24T15:30:00+0530',
                open: 157.3,
                high: 200,
                low: 140,
                close: 188.45,
                volume: 100,
                oi: 50,
              },
            ],
          };
        },
      },
    },
  );
  assert.strictEqual(nseCalls, 1);
  assert.strictEqual(expired.contracts[0].dataSource, 'nse');
  assert.strictEqual(expired.contracts[0].intervalUsed, 'day');
  assert.strictEqual(expired.contracts[0].historical[0].close, 188.45);
  assert.match(expired.contracts[0].note || '', /end-of-day/);

  const listedKeepsKite = await getOptionOhlcAndPrice(
    {
      authorization: 'token x:y',
      tradingSymbol: 'RELIANCE259181400CE',
      fromDate: '2026-09-01',
      toDate: '2026-09-11',
      historical: true,
      live: false,
    },
    {
      market,
      nseHistory: {
        async fetchExpiredOptionDayCandles() {
          throw new Error('NSE must not run when Kite already has listed bars');
        },
      },
    },
  );
  assert.strictEqual(listedKeepsKite.contracts[0].dataSource, 'kite');
  assert.strictEqual(listedKeepsKite.contracts[0].historical.length, 2);

  console.log('option-ohlc.selftest: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
