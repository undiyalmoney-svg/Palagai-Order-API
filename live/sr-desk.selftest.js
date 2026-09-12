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
assert.strictEqual(mapped.selectedInstrument, 'Nifty 50 25000 CE');
assert.strictEqual(mapped.optionStrike, 25000);
assert.strictEqual(mapped.sideLabel, 'CE BUY');
assert.strictEqual(mapped.entryTime, '2026-09-11T10:15:00+0530');
assert.strictEqual(mapped.exitTime, '2026-09-11T10:45:00+0530');
assert.strictEqual(mapped.entryHm, '10:15:00');
assert.strictEqual(mapped.exitHm, '10:45:00');
assert.strictEqual(mapped.entryClock, '10:15:00 AM');
assert.strictEqual(mapped.exitClock, '10:45:00 AM');
assert.strictEqual(mapped.indexEntry, 25000);
assert.strictEqual(mapped.indexExit, 25020);
assert.ok(mapped.entryPrice > 20 && mapped.entryPrice < 800, `nifty premium ${mapped.entryPrice}`);
assert.ok(mapped.exitPrice > 20 && mapped.exitPrice < 900, `nifty exit prem ${mapped.exitPrice}`);
assert.notStrictEqual(mapped.entryPrice, 25000);
assert.strictEqual(mapped.premiumSource, 'bs_atm_weekly');

const withSeconds = mapTrade(
  {
    date: '2026-09-11',
    option: 'CE',
    entryTime: '10:15',
    exitTime: '10:45',
    entryAt: '2026-09-11T10:15:37+05:30',
    exitAt: '2026-09-11T10:45:08+05:30',
    exitReason: 'TARGET',
    entryPrice: 25000,
    exitPrice: 25020,
    points: 20,
  },
  BOOKS.nifty,
  1,
  65,
);
assert.strictEqual(withSeconds.entryHm, '10:15:37');
assert.strictEqual(withSeconds.exitHm, '10:45:08');
assert.strictEqual(withSeconds.entryClock, '10:15:37 AM');
assert.strictEqual(withSeconds.exitClock, '10:45:08 AM');
assert.strictEqual(withSeconds.entryTime, '2026-09-11T10:15:37+0530');
assert.strictEqual(withSeconds.exitTime, '2026-09-11T10:45:08+0530');
assert.strictEqual(mapped.optionPnlRs, 1300);
assert.strictEqual(mapped.netOptionPnlRs, 1280);
assert.ok(!/straddle/i.test(mapped.optionSymbol));
assert.deepStrictEqual(Object.keys(BOOKS).sort(), ['banknifty', 'nifty']);
assert.strictEqual(BOOKS.nifty.strikeStep, 50);
assert.strictEqual(BOOKS.banknifty.strikeStep, 100);

const nearAtm = mapTrade(
  {
    date: '2026-09-11',
    option: 'CE',
    entryTime: '10:15',
    exitTime: '10:45',
    exitReason: 'TARGET',
    entryPrice: 24024,
    exitPrice: 24044,
    points: 20,
  },
  BOOKS.nifty,
  1,
  65,
);
assert.strictEqual(nearAtm.optionStrike, 24000);
assert.strictEqual(nearAtm.selectedInstrument, 'Nifty 50 24000 CE');

const bankMapped = mapTrade(
  {
    date: '2026-09-11',
    option: 'PE',
    entryTime: '12:05',
    exitTime: '12:20',
    exitReason: 'TARGET',
    entryPrice: 51234.5,
    exitPrice: 51190,
    points: 20,
  },
  BOOKS.banknifty,
  1,
  30,
);
assert.strictEqual(bankMapped.optionStrike, 51200);
assert.strictEqual(bankMapped.selectedInstrument, 'Bank Nifty 51200 PE');
assert.strictEqual(bankMapped.sideLabel, 'PE BUY');
assert.strictEqual(bankMapped.entryClock, '12:05:00 PM');
assert.strictEqual(bankMapped.exitClock, '12:20:00 PM');
assert.strictEqual(bankMapped.entryHm, '12:05:00');
assert.strictEqual(bankMapped.exitHm, '12:20:00');
assert.ok(bankMapped.entryPrice < 5000, `bank premium must not be index, got ${bankMapped.entryPrice}`);
assert.strictEqual(bankMapped.indexEntry, 51234.5);

const bankHigh = mapTrade(
  {
    date: '2026-09-11',
    option: 'CE',
    entryTime: '12:05',
    exitTime: '12:20',
    exitReason: 'TARGET',
    entryPrice: 56142,
    exitPrice: 56180,
    points: 20,
  },
  BOOKS.banknifty,
  1,
  30,
);
assert.strictEqual(bankHigh.optionStrike, 56100);
assert.ok(bankHigh.entryPrice !== 56142);
assert.ok(bankHigh.entryPrice > 50 && bankHigh.entryPrice < 2500, `bank 56142 premium ${bankHigh.entryPrice}`);
assert.strictEqual(bankHigh.indexEntry, 56142);

const bankPe = mapTrade(
  {
    date: '2026-09-11',
    option: 'PE',
    entryTime: '12:05',
    exitTime: '12:20',
    exitReason: 'TARGET',
    entryPrice: 56142,
    exitPrice: 56100,
    points: 20,
  },
  BOOKS.banknifty,
  1,
  30,
);
assert.strictEqual(bankPe.optionStrike, 56100);
assert.ok(
  bankPe.entryPrice >= 450 && bankPe.entryPrice <= 550,
  `11 Sep 2026 Bank PE should be ~₹500, got ${bankPe.entryPrice}`,
);
assert.ok(bankPe.entryPrice !== 56142);

runSrDesk(
  { authorization: 'token x', fromDate: '2026-09-11', toDate: '2026-09-11', lots: 1, capitalRs: 40000 },
  { candlesByKey: { nifty: [], banknifty: [] } },
)
  .then((out) => {
    assert.strictEqual(out.engine, ENGINE);
    assert.strictEqual(out.strategy, STRATEGY_ID);
    assert.ok(/wall-break|S\/R/i.test(out.note));
    assert.ok(/only Nifty 50 and Bank Nifty/i.test(out.note));
    assert.ok(/option premium/i.test(out.note));
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
