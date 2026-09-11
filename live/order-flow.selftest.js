'use strict';
const assert = require('assert');
const {
  barDelta,
  volumeProfile,
  confluenceSignal,
  simulateOrderFlow,
  searchOrderFlow,
} = require('./order-flow-engine');
const { paperPnlWindow, parseTradeBotWindow } = require('./trade-bot-dates');
const { findEntryExitWait, runEeWaitPaper, setLastFoundForTests } = require('./ee-wait-research');

const bars = [];
let px = 100;
for (let i = 0; i < 80; i += 1) {
  const date = new Date(Date.UTC(2022, 0, 3 + i)).toISOString().slice(0, 10);
  const down = i % 7 === 5;
  const up = i % 7 === 6;
  const open = px;
  const close = down ? px - 0.8 : up ? px + 0.9 : px + 0.15;
  const low = Math.min(open, close) - 0.2;
  const high = Math.max(open, close) + 0.2;
  bars.push({
    date,
    open,
    high,
    low,
    close,
    volume: down || up ? 9000 : 2500,
  });
  px = close;
}

assert.ok(barDelta({ open: 1, close: 2, volume: 10 }) > 0);
assert.ok(barDelta({ open: 2, close: 1, volume: 10 }) < 0);
const vp = volumeProfile(bars.slice(0, 30), 0.2);
assert.ok(vp && vp.poc && vp.val <= vp.poc && vp.poc <= vp.vah);

const hit = confluenceSignal(bars, 40, { lookback: 20, levelPct: 2, wallMult: 1 });
assert.ok(hit === 0 || hit.dir === 1 || hit.dir === -1);

const run = simulateOrderFlow(bars, {
  lookback: 15,
  hold: 3,
  stopPct: 1.2,
  targetPct: 2,
  levelPct: 1.5,
  wallMult: 1,
  killFailures: true,
});
assert.ok(Array.isArray(run.trades));
assert.strictEqual(run.spec.engine, 'order-flow');

const found = searchOrderFlow(bars.concat(bars).concat(bars), { lots: 1, lotSize: 65, lite: true, folds: 2 });
assert.ok(found.engine === 'order-flow');

const now = new Date('2026-09-11T10:00:00+05:30');
const todayWin = parseTradeBotWindow({ today: true }, now);
const expanded = paperPnlWindow(todayWin, { fromDate: '2022-01-01', toDate: '2026-09-11' });
assert.strictEqual(expanded.fromDate, '2025-09-11');
assert.strictEqual(expanded.toDate, '2026-09-11');
assert.strictEqual(expanded.usedFindWindow, true);

(async () => {
  const longBars = [];
  let p = 18000;
  const start = Date.parse('2025-09-15T00:00:00Z');
  for (let i = 0; i < 250; i += 1) {
    p += i % 9 === 0 ? -40 : 18;
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const open = p - 8;
    const close = p;
    longBars.push({
      date,
      open,
      high: Math.max(open, close) + 12,
      low: Math.min(open, close) - 12,
      close,
      volume: 1e8 + (i % 5) * 2e7,
    });
  }
  setLastFoundForTests(null);
  const out = await findEntryExitWait(
    { fromDate: '2025-09-15', toDate: '2026-05-22', lots: 1 },
    { fetchIndexDaily: async () => ({ indexType: 'NIFTY 50', historical: longBars }) },
  );
  assert.ok(out.engines);
  assert.ok(out.engine === 'ee-wait' || out.engine === 'order-flow');
  assert.ok(out.best && out.best.spec, 'find must return a spec');

  setLastFoundForTests(null);
  const paper = await runEeWaitPaper(
    { fromDate: '2026-09-11', toDate: '2026-09-11', today: true, lots: 1 },
    { fetchIndexDaily: async () => ({ indexType: 'NIFTY 50', historical: longBars }) },
  );
  assert.ok(paper.usedFindWindow === true);
  assert.ok(paper.totals.trades >= 1, `today-only paper must expand and produce trades, got ${paper.totals.trades}`);
  assert.ok(typeof paper.totals.optionNetRs === 'number');
  console.log('order-flow.selftest: ok', out.engine, paper.totals);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
