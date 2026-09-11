'use strict';
const assert = require('assert');
const { simulate, searchSpecs, rawSignal, confirmedSignal, dailyBarsFromFiveMinute } = require('./ee-wait-engine');
const { findEntryExitWait, runEeWaitPaper, setLastFoundForTests } = require('./ee-wait-research');

function upTrend(n) {
  const bars = [];
  let px = 100;
  for (let i = 0; i < n; i += 1) {
    px += 1.2;
    const date = new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10);
    bars.push({ date, open: px - 0.4, high: px + 0.5, low: px - 0.6, close: px });
  }
  return bars;
}

const bars = upTrend(200);
assert.strictEqual(rawSignal('breakout', bars, 10, 3), 1);
assert.strictEqual(confirmedSignal('breakout', bars, 10, 3, 2), 1);

const run = simulate(bars, {
  entry: 'breakout',
  lookback: 3,
  wait: 1,
  hold: 2,
  stopPct: 2,
  targetPct: 0.5,
});
assert.ok(run.trades.length > 5);

const found = searchSpecs(bars, { lots: 1 });
assert.ok(found.best.spec.entry);
assert.ok(found.best.oos);
assert.ok(found.full.tradeCount >= 0);

const collapsed = dailyBarsFromFiveMinute([
  { date: '2021-06-01T09:15:00+0530', open: 1, high: 2, low: 0.5, close: 1.5 },
  { date: '2021-06-01T09:20:00+0530', open: 1.5, high: 3, low: 1.4, close: 2.8 },
]);
assert.strictEqual(collapsed.length, 1);
assert.strictEqual(collapsed[0].high, 3);
assert.strictEqual(collapsed[0].close, 2.8);

(async () => {
  const fakeBars = upTrend(250);
  const out = await findEntryExitWait(
    { fromDate: '2021-01-01', toDate: '2021-12-01', lots: 2 },
    {
      fetchIndexDaily: async () => ({
        indexType: 'NIFTY 50',
        historical: fakeBars,
      }),
    },
  );
  assert.strictEqual(out.engine, 'ee-wait');
  assert.ok(out.best.spec.lookback);
  assert.ok(out.best.spec.wait);
  assert.ok(out.best.spec.hold);

  const paper = await runEeWaitPaper(
    { fromDate: '2021-06-01', toDate: '2021-09-01', lots: 2 },
    {
      fetchIndexDaily: async () => ({
        indexType: 'NIFTY 50',
        historical: fakeBars,
      }),
    },
  );
  assert.strictEqual(paper.engine, 'ee-wait');
  assert.ok(paper.totals.trades >= 0);

  setLastFoundForTests(null);
  console.log('ee-wait.selftest: ok', out.best.spec);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
