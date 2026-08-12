/**
 * Offline proof: 12 Aug-style giveback is killed by first-win green lock;
 * recovery gate allows one shot when desk is already red after a win.
 */
const assert = require('assert');
const { filterTradesLivePath } = require('../live/live-path');
const { summarizeIndexDay, indexEntryGate, bankEntryGate } = require('../live/desk-day-policy');
const { evaluateOptionPeakTrail } = require('../live/strategy-core.cjs');

function t(partial) {
  return {
    option: { instrumentToken: 1 },
    premiumEstimated: false,
    ...partial,
  };
}

const day = '2026-08-12';
const aug12 = [
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

const kept = filterTradesLivePath(aug12, {
  maxOpenLegs: 1,
  dayProfitLockRs: 2500,
  dayStopRs: 2950,
  rejectEstimatedPremium: true,
  bankOnlyAfterNifty: true,
  bankOnlyAfterNiftyGreen: true,
  indexFirstWinLock: true,
  deskGreenLockRs: 50,
  recoveryMaxExtra: 1,
});

const net = kept.reduce((s, x) => s + (x.netOptionPnlRs || 0), 0);
assert.strictEqual(kept.length, 1, 'first-win keeps only the green Nifty leg');
assert.strictEqual(net, 387, 'desk stays +387 instead of −582');

// Live mid-day: win already given back → one recovery shot allowed.
const summary = summarizeIndexDay(aug12, day);
assert.ok(summary.hadIndexWin);
assert.ok(summary.dayNet < 0);
const gate0 = indexEntryGate({ ...summary, recoveryShotsUsed: 0 }, {
  indexFirstWinLock: true,
  deskGreenLockRs: 50,
  recoveryMaxExtra: 1,
});
assert.strictEqual(gate0.allow, true);
assert.strictEqual(gate0.recovery, true);
assert.ok(String(gate0.reason).includes('recovery'));
const gate1 = indexEntryGate({ ...summary, recoveryShotsUsed: 1 }, {
  indexFirstWinLock: true,
  deskGreenLockRs: 50,
  recoveryMaxExtra: 1,
});
assert.strictEqual(gate1.allow, false);

const bankBlocked = bankEntryGate(
  { ...summary, niftyTaken: true, niftyNet: summary.niftyNet },
  { bankOnlyAfterNifty: true, bankOnlyAfterNiftyGreen: true },
);
assert.strictEqual(bankBlocked.allow, false, 'Bank blocked while Nifty day red');

// Smart trail: larger MFE shrinks giveback / holds higher floor.
const trail = evaluateOptionPeakTrail({
  entryPremium: 100,
  optionPeakMfeRs: 200,
  optionBarLow: 100,
  lotUnits: 65,
  armRs: 80,
  lockRs: 70,
  givebackRs: 30,
});
assert.ok(trail.armed);
assert.ok(trail.floorRs >= 70);

console.log('OK first-win green lock + recovery + smart trail');
console.log(
  JSON.stringify(
    {
      kept: kept.map((x) => ({ book: x.instrumentId, net: x.netOptionPnlRs })),
      net,
      recoveryAllow: gate0,
      bankOnRedNifty: bankBlocked,
      trailFloorRs: trail.floorRs,
    },
    null,
    2,
  ),
);
