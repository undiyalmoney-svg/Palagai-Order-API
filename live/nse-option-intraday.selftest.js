'use strict';
const assert = require('assert');
const {
  nseWeeklyOptionSymbol,
  nseMonthlyOptionSymbol,
  nseOptIdxId,
  optionRootForBook,
  mapChartBar,
  pickSearchHit,
  fetchOption5m,
} = require('./nse-option-intraday');
const { BOOKS } = require('./sr-desk');
const { pickBarFlex, ohlcOf } = require('./sr-option-pnl');

assert.strictEqual(optionRootForBook(BOOKS.banknifty), 'BANKNIFTY');
assert.strictEqual(optionRootForBook(BOOKS.nifty), 'NIFTY');
assert.strictEqual(nseWeeklyOptionSymbol('BANKNIFTY', '2026-09-15', 56100, 'PE'), 'BANKNIFTY2691556100PE');
assert.strictEqual(nseWeeklyOptionSymbol('NIFTY', '2026-09-15', 25000, 'CE'), 'NIFTY2691525000CE');
assert.strictEqual(nseMonthlyOptionSymbol('BANKNIFTY', '2026-09-30', 56100, 'PE'), 'BANKNIFTY26SEP56100PE');
assert.strictEqual(nseOptIdxId('BANKNIFTY', '2026-09-15', 56100, 'PE'), 'OPTIDXBANKNIFTY15-09-2026PE56100');

const fromMs = mapChartBar({
  time: Date.parse('2026-09-11T12:14:59Z'),
  open: 512.85,
  high: 531.80,
  low: 512.55,
  close: 524.00,
});
assert.strictEqual(fromMs.date.slice(0, 16), '2026-09-11T12:10');
assert.strictEqual(fromMs.close, 524);
assert.deepStrictEqual(ohlcOf(fromMs), { open: 512.85, high: 531.8, low: 512.55, close: 524 });
assert.strictEqual(pickBarFlex([fromMs], '12:05').close, 524);

const hit = pickSearchHit({
  data: [
    { symbol: 'BANKNIFTY2691556100PE', scripcode: '99', type: 'Options' },
  ],
}, 'BANKNIFTY2691556100PE');
assert.strictEqual(hit.scripcode, '99');

(async () => {
  const bars = await fetchOption5m(
    { tradingSymbol: 'BANKNIFTY2691556100PE', fromDate: '2026-09-11', toDate: '2026-09-11' },
    {
      warmCharting: async () => {},
      searchOptionSymbol: async (q) => {
        assert.strictEqual(q, 'BANKNIFTY2691556100PE');
        return { symbol: q, scripcode: '123', type: 'Options' };
      },
      chartGet: async (url) => {
        assert.ok(String(url).includes('symbolHistoricalData'));
        return {
          data: {
            data: [{
              time: Date.parse('2026-09-11T12:14:59Z'),
              open: 512.85,
              high: 531.80,
              low: 512.55,
              close: 524.00,
            }],
          },
        };
      },
      chartPost: async () => ({ data: { data: [] } }),
    },
  );
  assert.strictEqual(bars.length, 1);
  assert.strictEqual(bars[0].close, 524);
  assert.strictEqual(bars[0].open, 512.85);
  console.log('nse-option-intraday.selftest: ok', bars[0]);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
