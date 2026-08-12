/**
 * Offline proof of the Daily Band Loop (₹750–₹2000).
 *
 * Research (when loop followed @ 1 lot):
 *   Jul 2026 ≈ 23/23 · avg ~₹1,496
 *   21 Jul–10 Aug paper 15/15 · ~₹1.8k/day
 *   Aug MTD All3 days mostly ₹1.2k–₹2.8k
 *
 * When broken → red (12 Aug re-hunt after +₹387 → −₹582).
 */
const assert = require('assert');
const { filterTradesLivePath } = require('../live/live-path');
const { summarizeIndexDay, indexEntryGate, bankEntryGate } = require('../live/desk-day-policy');
const { LIVE_GREEN_DNA } = require('../live/dna-live-green');
const { APP_VERSION, APP_BUILD, DAY_PROFIT_LOCK_RS } = require('../live/daily-desk-defaults');

function t(partial) {
  return {
    option: { instrumentToken: 1 },
    premiumEstimated: false,
    ...partial,
  };
}

const day = '2026-08-12';
const aug12Giveback = [
  t({
    instrumentId: 'nifty-50',
    entryTime: `${day}T10:20:00+05:30`,
    exitTime: `${day}T10:35:00+05:30`,
    netOptionPnlRs: 387,
    optionPnlRs: 387,
  }),
  t({
    instrumentId: 'nifty-50',
    entryTime: `${day}T11:00:00+05:30`,
    exitTime: `${day}T11:20:00+05:30`,
    netOptionPnlRs: -673,
    optionPnlRs: -673,
  }),
  t({
    instrumentId: 'nifty-50',
    entryTime: `${day}T11:45:00+05:30`,
    exitTime: `${day}T12:00:00+05:30`,
    netOptionPnlRs: -26,
    optionPnlRs: -26,
  }),
  t({
    instrumentId: 'bank-nifty',
    entryTime: `${day}T12:15:00+05:30`,
    exitTime: `${day}T12:40:00+05:30`,
    netOptionPnlRs: -270,
    optionPnlRs: -270,
  }),
];

const bandOpts = {
  maxOpenLegs: 1,
  dayProfitLockRs: 2000,
  dayStopRs: 2950,
  rejectEstimatedPremium: true,
  bankOnlyAfterNifty: true,
  bankOnlyAfterNiftyGreen: true,
  winStreakToBand: true,
  indexFirstWinLock: false,
  deskGreenLockRs: 750,
};

const kept12 = filterTradesLivePath(aug12Giveback, bandOpts);
const net12 = kept12.reduce((s, x) => s + x.netOptionPnlRs, 0);
// +387 then −673 (loss after green) → stop; no further dig / Bank.
assert.strictEqual(kept12.length, 2, 'no dig keeps win+first loss only');
assert.strictEqual(net12, 387 - 673, 'stops the giveback spiral');

// Win streak into band then lock.
const bandDay = [
  t({
    instrumentId: 'nifty-50',
    entryTime: '2026-08-11T10:00:00+05:30',
    exitTime: '2026-08-11T10:20:00+05:30',
    netOptionPnlRs: 400,
    optionPnlRs: 400,
  }),
  t({
    instrumentId: 'nifty-50',
    entryTime: '2026-08-11T11:00:00+05:30',
    exitTime: '2026-08-11T11:20:00+05:30',
    netOptionPnlRs: 420,
    optionPnlRs: 420,
  }),
  t({
    instrumentId: 'bank-nifty',
    entryTime: '2026-08-11T12:00:00+05:30',
    exitTime: '2026-08-11T12:30:00+05:30',
    netOptionPnlRs: 391,
    optionPnlRs: 391,
  }),
  t({
    instrumentId: 'crude-oil-mini',
    entryTime: '2026-08-11T16:30:00+05:30',
    exitTime: '2026-08-11T17:00:00+05:30',
    netOptionPnlRs: 200,
    optionPnlRs: 200,
  }),
];
const keptBand = filterTradesLivePath(bandDay, bandOpts);
const netBand = keptBand.reduce((s, x) => s + x.netOptionPnlRs, 0);
assert.ok(netBand >= 750 && netBand <= 2000, `in band: ${netBand}`);
assert.ok(
  !keptBand.some((x) => x.instrumentId === 'crude-oil-mini'),
  'Crude skipped once index already in band',
);
assert.ok(
  !keptBand.some((x) => x.instrumentId === 'bank-nifty') || netBand >= 750,
  'Bank only contributes before band lock',
);
// 400+420=820 → band lock; Bank+Crude dropped.
assert.deepStrictEqual(
  keptBand.map((x) => x.netOptionPnlRs),
  [400, 420],
);

const sum = summarizeIndexDay(aug12Giveback, day);
assert.strictEqual(sum.lostAfterGreen, true);
const gate = indexEntryGate(sum, {
  winStreakToBand: true,
  deskGreenLockRs: 750,
  indexFirstWinLock: false,
});
assert.strictEqual(gate.allow, false);
assert.ok(String(gate.reason).includes('no dig'));

const bankGate = bankEntryGate(
  { niftyTaken: true, niftyNet: -312 },
  { bankOnlyAfterNifty: true, bankOnlyAfterNiftyGreen: true },
);
assert.strictEqual(bankGate.allow, false);

assert.strictEqual(LIVE_GREEN_DNA.dailyBand.minRs, 750);
assert.strictEqual(LIVE_GREEN_DNA.dailyBand.maxRs, 2000);
assert.strictEqual(DAY_PROFIT_LOCK_RS, 2000);

console.log('OK daily band loop');
console.log(
  JSON.stringify(
    {
      version: APP_VERSION,
      build: APP_BUILD,
      dna: LIVE_GREEN_DNA.id,
      aug12NoDig: { kept: kept12.length, net: net12 },
      winStreakBand: { kept: keptBand.map((x) => x.netOptionPnlRs), net: netBand },
      loop: LIVE_GREEN_DNA.research.loop,
    },
    null,
    2,
  ),
);
