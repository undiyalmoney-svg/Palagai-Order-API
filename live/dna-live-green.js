/**
 * LIVE_GREEN DNA — research 2026-08-10 (pro-trader pass).
 *
 * Goal: all-day green live ≈ paper.
 *
 * Finding: current Trap signal DNA is already 15/15 green (21 Jul–10 Aug)
 * even under hard fill friction. Today's live loss was execution
 * (SL/EXIT margin lock, estimated paper premiums, overlapping legs),
 * not a bad signal DNA.
 *
 * So LIVE_GREEN = keep proven signals + live ops that make fills survive.
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-v1',
  label: 'Live Green · Trap desk + one-leg ops',
  version: '2026.08.10',

  /** Books */
  enableNifty: true,
  enableBank: true,
  enableCrude: false,
  niftyLots: 1,
  bankLots: 1,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',

  /** Day risk (₹ band @ 1 lot) */
  dayProfitLock: true,
  dayProfitLockRs: 3000,
  strictDayStop: true,
  strictDayStopRs: 2950,

  /** Trap signal DNA (do not loosen — research winner) */
  trap: {
    piercePts: 20,
    bankPiercePts: 40,
    profitLockArmRs: 100,
    profitLockLockRs: 50,
    profitLockGivebackRs: 50,
    maxTradesPerDay: 3,
    targetRMultiple: 3.5,
    confirmNextBar: true,
    slConfirmCutoffEnabled: false,
    softRs: 0,
    entryTimeStart: '09:45',
    entryTimeEnd: '14:45',
    exitTime: '15:15',
  },

  /**
   * Live ops — what actually separates green paper from red live.
   * - oneLeg: never hold Nifty+Bank together (today's margin death)
   * - optionStandDownRs: hard cut when option ₹ MAE hits this
   * - rejectEstimatedPremium: no live entry on synthetic/estimated marks
   */
  liveOps: {
    maxOpenLegs: 1,
    optionStandDownRs: 350,
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
  },

  research: {
    window: '2026-07-21 → 2026-08-10',
    paperGreenDays: '15/15',
    paperNetRs: 27594,
    paperTodayRs: 1954,
    frictionHardGreenDays: '15/15',
    frictionHardNetRs: 18220,
    liveTodayActualGrossRs: -1297,
    note:
      'Altering pierce/peak/max2 hurt friction green%. Keep signals; enforce one-leg + stand-down + fill ledger.',
  },
};

/** Extras merged into Trap initialize() for LIVE_GREEN. */
function liveGreenTrapExtras() {
  const t = LIVE_GREEN_DNA.trap;
  return {
    piercePts: t.piercePts,
    bankPiercePts: t.bankPiercePts,
    profitLockArmRs: t.profitLockArmRs,
    profitLockLockRs: t.profitLockLockRs,
    profitLockGivebackRs: t.profitLockGivebackRs,
    slConfirmCutoffEnabled: t.slConfirmCutoffEnabled,
    slConfirmSoftRs: t.softRs,
    trapMode: 'both',
    bounceOrPierceMult: 0,
    bounceOrPierceCap: 0,
    optionStandDownRs: LIVE_GREEN_DNA.liveOps.optionStandDownRs,
  };
}

function liveGreenStartConfig() {
  return {
    enableNifty: LIVE_GREEN_DNA.enableNifty,
    enableBank: LIVE_GREEN_DNA.enableBank,
    enableCrude: LIVE_GREEN_DNA.enableCrude,
    niftyLots: LIVE_GREEN_DNA.niftyLots,
    bankLots: LIVE_GREEN_DNA.bankLots,
    niftyStrategy: LIVE_GREEN_DNA.niftyStrategy,
    bankStrategy: LIVE_GREEN_DNA.bankStrategy,
    dayProfitLock: LIVE_GREEN_DNA.dayProfitLock,
    strictDayStop: LIVE_GREEN_DNA.strictDayStop,
    enableKutty: false,
    kuttyAlone: false,
    realOrders: true,
    dnaId: LIVE_GREEN_DNA.id,
    maxOpenLegs: LIVE_GREEN_DNA.liveOps.maxOpenLegs,
    optionStandDownRs: LIVE_GREEN_DNA.liveOps.optionStandDownRs,
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenStartConfig,
};
