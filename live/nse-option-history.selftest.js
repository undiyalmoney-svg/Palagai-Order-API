'use strict';
const assert = require('assert');
const {
  parseOptionContract,
  parseNseOrIsoDate,
  mapFoCpvRow,
  monthlyExpiryCandidates,
  isExpiredIso,
  fetchExpiredOptionDayCandles,
} = require('./nse-option-history');

const weekly = parseOptionContract('NIFTY2691523350CE');
assert.strictEqual(weekly.underlying, 'NIFTY');
assert.strictEqual(weekly.instrumentType, 'OPTIDX');
assert.strictEqual(weekly.optionType, 'CE');
assert.strictEqual(weekly.strike, 23350);
assert.strictEqual(weekly.expiryStyle, 'weekly');
assert.strictEqual(weekly.expiryIso, '2026-09-15');
assert.strictEqual(weekly.expiryNse, '15-SEP-2026');

const monthly = parseOptionContract('NIFTY21JUN15600CE');
assert.strictEqual(monthly.underlying, 'NIFTY');
assert.strictEqual(monthly.year, 2021);
assert.strictEqual(monthly.strike, 15600);
assert.strictEqual(monthly.expiryStyle, 'monthly');
assert.strictEqual(monthly.expiryNse, '24-JUN-2021');
assert.strictEqual(monthly.expiryIso, '2021-06-24');

const stock = parseOptionContract('RELIANCE26SEP1400CE');
assert.strictEqual(stock.instrumentType, 'OPTSTK');
assert.strictEqual(stock.underlying, 'RELIANCE');
assert.strictEqual(stock.strike, 1400);

const bank = parseOptionContract('BANKNIFTY26SEP51000CE');
assert.strictEqual(bank.underlying, 'BANKNIFTY');
assert.strictEqual(bank.instrumentType, 'OPTIDX');

assert.strictEqual(parseOptionContract('NOTANOPTION'), null);

const jun = monthlyExpiryCandidates(2021, 5, 'NIFTY');
assert.strictEqual(jun[0].nse, '24-JUN-2021');

assert.deepStrictEqual(parseNseOrIsoDate('24-Jun-2021'), {
  iso: '2021-06-24',
  nse: '24-JUN-2021',
  year: 2021,
});

const bar = mapFoCpvRow({
  FH_TIMESTAMP: '24-Jun-2021',
  FH_OPENING_PRICE: 157.3,
  FH_TRADE_HIGH_PRICE: 200.1,
  FH_TRADE_LOW_PRICE: 140,
  FH_CLOSING_PRICE: 188.45,
  FH_TOT_TRADED_QTY: 12345,
  FH_OPEN_INT: 999,
});
assert.strictEqual(bar.date, '2021-06-24T15:30:00+0530');
assert.strictEqual(bar.close, 188.45);
assert.strictEqual(bar.oi, 999);

assert.strictEqual(isExpiredIso('2021-06-24', new Date('2026-09-11T10:00:00+05:30')), true);
assert.strictEqual(isExpiredIso('2026-09-15', new Date('2026-09-11T10:00:00+05:30')), false);

(async () => {
  let calls = 0;
  const out = await fetchExpiredOptionDayCandles(
    {
      tradingSymbol: 'NIFTY21JUN15600CE',
      fromDate: '2021-06-01',
      toDate: '2021-06-24',
    },
    {
      fetchFoCpvRange: async (params) => {
        calls += 1;
        assert.strictEqual(params.symbol, 'NIFTY');
        assert.strictEqual(params.instrumentType, 'OPTIDX');
        assert.strictEqual(params.optionType, 'CE');
        assert.strictEqual(params.strikePrice, 15600);
        assert.strictEqual(params.expiryDate, '24-JUN-2021');
        return [
          {
            date: '2021-06-24T15:30:00+0530',
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 10,
            oi: 20,
          },
        ];
      },
    },
  );
  assert.strictEqual(out.source, 'nse');
  assert.strictEqual(out.interval, 'day');
  assert.strictEqual(out.historical.length, 1);
  assert.strictEqual(calls, 1);
  console.log('nse-option-history.selftest: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
