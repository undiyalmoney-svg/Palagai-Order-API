/**
 * Offline proof — Treasure DNA (unlimited Pivot S/R · zero-red live-path).
 *
 * Live-markable winner (reject estimated, |net|≥₹10):
 *   2026-07-15 → 2026-08-11 · 18/18 green · ~₹1,451/day
 */
const assert = require('assert');
const { filterTradesLivePath, DEFAULT_LIVE_PATH } = require('../live/live-path');
const { indexEntryGate, bankEntryGate } = require('../live/desk-day-policy');
const { LIVE_GREEN_DNA, liveGreenStartConfig } = require('../live/dna-live-green');
const { LIVE_CRUDE_GREEN_DNA } = require('../live/dna-live-crude-green');
const {
  APP_VERSION,
  APP_BUILD,
  DAY_PROFIT_LOCK_RS,
  STRICT_DAY_STOP_RS,
  normalizeStartConfig,
} = require('../live/daily-desk-defaults');
const { resolveCrudeStrategyProfile } = require('../live/strategy-core.cjs');

function t(partial) {
  return {
    option: { instrumentToken: 1 },
    premiumEstimated: false,
    ...partial,
  };
}

const dna = LIVE_GREEN_DNA;
const ops = dna.liveOps;
const trap = dna.trap;

assert.strictEqual(dna.id, 'live-green-treasure-v7');
assert.strictEqual(trap.srMethod, 'pivot');
assert.strictEqual(trap.pivotStrength, 2);
assert.strictEqual(trap.trapMode, 'both');
assert.strictEqual(trap.piercePts, 20);
assert.strictEqual(trap.bankPiercePts, 60);
assert.strictEqual(trap.perfectSweepSl, true);
assert.strictEqual(trap.maxTradesPerDay, 0);
assert.strictEqual(trap.bankMaxTradesPerDay, 0);
assert.strictEqual(ops.optionStandDownRs, 0);
assert.strictEqual(ops.bankOnlyAfterNifty, false);
assert.strictEqual(ops.winStreakToBand, false);
assert.strictEqual(ops.deskGreenLockRs, 0);
assert.strictEqual(ops.crudeOnlyBelowBand, false);
assert.strictEqual(ops.dustTradeRs, 10);
assert.strictEqual(dna.dayProfitLock, false);
assert.strictEqual(dna.strictDayStop, false);
assert.strictEqual(dna.dailyBand.minRs, 0);
assert.strictEqual(dna.dailyBand.maxRs, 0);
assert.strictEqual(DAY_PROFIT_LOCK_RS, 0);
assert.strictEqual(STRICT_DAY_STOP_RS, 0);

const empty = normalizeStartConfig({});
assert.strictEqual(empty.dayProfitLock, false);
assert.strictEqual(empty.strictDayStop, false);
assert.strictEqual(empty.bankOnlyAfterNifty, false);
assert.strictEqual(empty.winStreakToBand, false);
assert.strictEqual(empty.deskGreenLockRs, 0);
assert.strictEqual(empty.crudeOnlyBelowBand, false);
assert.strictEqual(empty.optionStandDownRs, 0);

const started = normalizeStartConfig(liveGreenStartConfig());
assert.strictEqual(started.dnaId, dna.id);
assert.strictEqual(started.dayProfitLock, false);
assert.strictEqual(started.bankOnlyAfterNifty, false);

// Dust filter drops charge noise that used to fake −₹1…−₹5 red days.
const dusty = [
  t({
    instrumentId: 'nifty-50',
    entryTime: '2026-08-11T10:00:00+05:30',
    exitTime: '2026-08-11T10:10:00+05:30',
    netOptionPnlRs: -4,
    optionPnlRs: -4,
  }),
  t({
    instrumentId: 'nifty-50',
    entryTime: '2026-08-11T11:00:00+05:30',
    exitTime: '2026-08-11T11:30:00+05:30',
    netOptionPnlRs: 1200,
    optionPnlRs: 1200,
  }),
];
const keptDust = filterTradesLivePath(dusty, { ...DEFAULT_LIVE_PATH });
assert.strictEqual(keptDust.length, 1);
assert.strictEqual(keptDust[0].netOptionPnlRs, 1200);

// Unlimited: keep trading after green — no band / no dig / no bank gate.
const streak = [
  t({
    instrumentId: 'nifty-50',
    entryTime: '2026-08-11T10:00:00+05:30',
    exitTime: '2026-08-11T10:20:00+05:30',
    netOptionPnlRs: 800,
    optionPnlRs: 800,
  }),
  t({
    instrumentId: 'nifty-50',
    entryTime: '2026-08-11T11:00:00+05:30',
    exitTime: '2026-08-11T11:20:00+05:30',
    netOptionPnlRs: -200,
    optionPnlRs: -200,
  }),
  t({
    instrumentId: 'bank-nifty',
    entryTime: '2026-08-11T11:30:00+05:30',
    exitTime: '2026-08-11T12:00:00+05:30',
    netOptionPnlRs: 900,
    optionPnlRs: 900,
  }),
  t({
    instrumentId: 'crude-oil-mini',
    entryTime: '2026-08-11T16:30:00+05:30',
    exitTime: '2026-08-11T17:00:00+05:30',
    netOptionPnlRs: 300,
    optionPnlRs: 300,
  }),
];
const treasureOpts = {
  ...DEFAULT_LIVE_PATH,
  dayProfitLockRs: 0,
  dayStopRs: 0,
  bankOnlyAfterNifty: false,
  bankOnlyAfterNiftyGreen: false,
  winStreakToBand: false,
  indexFirstWinLock: false,
  deskGreenLockRs: 0,
};
const kept = filterTradesLivePath(streak, treasureOpts);
assert.strictEqual(kept.length, 4, 'unlimited keeps all legs');
assert.strictEqual(
  kept.reduce((s, x) => s + x.netOptionPnlRs, 0),
  1800,
);

const gate = indexEntryGate(
  { dayNet: 1800, hadIndexWin: true, lostAfterGreen: true },
  {
    winStreakToBand: false,
    deskGreenLockRs: 0,
    indexFirstWinLock: false,
  },
);
assert.strictEqual(gate.allow, true, 'no band / no dig lock');

const bankGate = bankEntryGate(
  { niftyTaken: false, niftyNet: 0 },
  { bankOnlyAfterNifty: false, bankOnlyAfterNiftyGreen: false },
);
assert.strictEqual(bankGate.allow, true, 'Bank free of Nifty gate');

// Crude treasure DNA (pairs with index for All3 demons).
const crude = LIVE_CRUDE_GREEN_DNA;
assert.strictEqual(crude.id, 'live-crude-treasure-v4');
assert.strictEqual(crude.signal.stopPts, 20);
assert.strictEqual(crude.signal.targetPts, 60);
assert.strictEqual(crude.signal.minOrWidth, 35);
assert.strictEqual(crude.signal.maxOrWidth, 65);
assert.strictEqual(crude.signal.requireConfirm, false);
assert.strictEqual(crude.signal.firstWinLock, false);
assert.strictEqual(crude.signal.maxTradesDay, 0);
assert.strictEqual(crude.dayProfitLock, false);
assert.strictEqual(crude.strictDayStop, false);
const crudeProf = resolveCrudeStrategyProfile('live-crude-green');
assert.strictEqual(crudeProf.stopPts, 20);
assert.strictEqual(crudeProf.eveningTargetPts, 60);
assert.strictEqual(crudeProf.requireConfirm, false);
assert.strictEqual(crudeProf.maxEveningTradesDay, 0);
assert.strictEqual(crudeProf.dayProfitLockPts, 0);

console.log('OK treasure zero-red DNA (index + crude)');
console.log(
  JSON.stringify(
    {
      version: APP_VERSION,
      build: APP_BUILD,
      dna: dna.id,
      crudeDna: crude.id,
      research: { index: dna.research, crude: crude.research },
      unlimited: { kept: kept.length, net: 1800 },
      emptyStart: {
        dayProfitLock: empty.dayProfitLock,
        bankOnlyAfterNifty: empty.bankOnlyAfterNifty,
        deskGreenLockRs: empty.deskGreenLockRs,
      },
    },
    null,
    2,
  ),
);
