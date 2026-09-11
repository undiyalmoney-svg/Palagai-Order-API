'use strict';
/**
 * One-shot NSE Nifty 50 walk-forward: ee-wait vs order-flow confluence.
 * Usage: node live/order-flow.backtest.js
 */
const { fetchIndexDaily } = require('./nse-index-history');
const { searchSpecs, simulate, summarizeTrades, NIFTY_LOT_SIZE } = require('./ee-wait-engine');
const { searchOrderFlow, simulateOrderFlow } = require('./order-flow-engine');

(async () => {
  const toDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const fromDate = '2023-01-02';
  console.log('fetch', fromDate, toDate);
  const series = await fetchIndexDaily({ indexType: 'NIFTY 50', fromDate, toDate });
  const bars = series.historical || [];
  const withVol = bars.filter((b) => b.volume > 0).length;
  console.log(JSON.stringify({ bars: bars.length, withVol, first: bars[0], last: bars[bars.length - 1] }));
  if (bars.length < 80) {
    console.error('not enough bars');
    process.exit(2);
  }
  const ee = searchSpecs(bars, { lots: 1, lotSize: NIFTY_LOT_SIZE, folds: 3 });
  const oflow = searchOrderFlow(bars, { lots: 1, lotSize: NIFTY_LOT_SIZE, folds: 3 });
  const eeFull = ee.best ? summarizeTrades(simulate(bars, ee.best.spec).trades, 1, NIFTY_LOT_SIZE) : null;
  const ofFull = oflow.best
    ? summarizeTrades(simulateOrderFlow(bars, oflow.best.spec).trades, 1, NIFTY_LOT_SIZE)
    : null;
  const report = {
    fromDate,
    toDate,
    bars: bars.length,
    withVol,
    eeWait: { oos: ee.best?.oos || null, spec: ee.best?.spec || null, full: eeFull },
    orderFlow: { oos: oflow.best?.oos || null, spec: oflow.best?.spec || null, full: ofFull },
    winner:
      (oflow.best?.oos?.rupees || -1e18) > (ee.best?.oos?.rupees || -1e18) ? 'order-flow' : 'ee-wait',
  };
  console.log(JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
