'use strict';
const assert = require('assert');
const { runSrDesk, mapTrade, ENGINE, BOOKS } = require('./sr-desk');
const { STRATEGY_ID } = require('./sr-strategy-config');

assert.strictEqual(ENGINE, 'sr-desk');
assert.strictEqual(STRATEGY_ID, 'sr-breakout');
assert.ok(BOOKS.nifty.token);
assert.ok(BOOKS.banknifty.token);

const mapped = mapTrade(
  {
    date: '2026-09-11',
    side: 'BUY',
    option: 'CE',
    entryTime: '10:15',
    exitTime: '10:45',
    exitReason: 'TARGET',
    entryPrice: 25000,
    exitPrice: 25020,
    points: 20,
  },
  BOOKS.nifty,
  1,
  65,
);
assert.strictEqual(mapped.direction, 'CE');
assert.strictEqual(mapped.selectedInstrument, 'Nifty 50 ATM CE');
assert.strictEqual(mapped.entryTime, '2026-09-11T10:15:00+0530');
assert.strictEqual(mapped.exitTime, '2026-09-11T10:45:00+0530');
assert.strictEqual(mapped.entryPrice, 25000);
assert.strictEqual(mapped.exitPrice, 25020);
assert.strictEqual(mapped.indexEntry, 25000);
assert.strictEqual(mapped.indexExit, 25020);
assert.strictEqual(mapped.optionPnlRs, 1300);
assert.strictEqual(mapped.netOptionPnlRs, 1280);
assert.ok(!/straddle/i.test(mapped.optionSymbol));
assert.deepStrictEqual(Object.keys(BOOKS).sort(), ['banknifty', 'nifty']);

runSrDesk(
  { authorization: 'token x', fromDate: '2026-09-11', toDate: '2026-09-11', lots: 1, capitalRs: 40000 },
  { candlesByKey: { nifty: [], banknifty: [] } },
)
  .then((out) => {
    assert.strictEqual(out.engine, ENGINE);
    assert.strictEqual(out.strategy, STRATEGY_ID);
    assert.ok(/wall-break|S\/R/i.test(out.note));
    assert.ok(/only Nifty 50 and Bank Nifty/i.test(out.note));
    assert.ok(!/sell ATM/i.test(out.note));
    assert.ok(out.instruments.every((r) => r.id === 'nifty' || r.id === 'bank'));
    assert.ok(!out.instruments.some((r) => r.id === 'crude'));
    assert.strictEqual(out.totals.netRs, 0);
    assert.ok(out.coreBooks.length === 3);
    assert.ok(out.books.some((b) => b.id === 'nifty'));
    assert.ok(out.books.find((b) => b.id === 'crude').sitOut);
    console.log('sr-desk.selftest: ok', out.engine, out.strategyVersion || out.strategy);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
