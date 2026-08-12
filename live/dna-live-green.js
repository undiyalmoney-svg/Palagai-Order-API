/**
 * LIVE_GREEN DNA — multi-strategy daily desk (2026-08-12).
 *
 * Research + live fix:
 *   Bank only AFTER Nifty has traded that day.
 *   Index first-win green lock — stop re-hunting after first green Nifty/Bank
 *   close (12 Aug failure mode: +₹387 then −₹673/−₹26/Bank −₹270).
 *   One recovery shot if desk is red after a prior green leg.
 *   Tighter option peak trail (smart exit) — arm sooner, less giveback.
 *   Crude LIVE_CRUDE_GREEN after NSE (second session).
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-all3-v3',
  label: 'Live Green · First-win lock · Smart exit · Paper≡Live',
  version: '2026.08.12-first-win',

  /** Books */
  enableNifty: true,
  enableBank: true,
  enableCrude: true,
  niftyLots: 1,
  bankLots: 1,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',

  /** Day risk (₹ band @ 1 lot) — measured on option ₹, not index pts */
  dayProfitLock: true,
  dayProfitLockRs: 2500,
  strictDayStop: true,
  strictDayStopRs: 2950,

  /** Trap signal DNA — tighter trail = smart exit on winners */
  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    /** Arm earlier, lock more, give back less — protect green legs */
    profitLockArmRs: 80,
    profitLockLockRs: 70,
    profitLockGivebackRs: 30,
    maxTradesPerDay: 3,
    bankMaxTradesPerDay: 2,
    targetRMultiple: 3.5,
    confirmNextBar: true,
    slConfirmCutoffEnabled: false,
    softRs: 0,
    entryTimeStart: '09:45',
    entryTimeEnd: '14:45',
    exitTime: '15:15',
  },

  liveOps: {
    maxOpenLegs: 1,
    optionStandDownRs: 350,
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
    fillFrictionPremium: 0.5,
    optionRsDayRisk: true,
    /** Zero-red all-three rule */
    bankOnlyAfterNifty: true,
    /** Do not add Bank risk onto a red Nifty day */
    bankOnlyAfterNiftyGreen: true,
    /** Stop index hunting after first green Nifty/Bank close */
    indexFirstWinLock: true,
    /** Treat dayNet ≥ ₹50 as green for lock / recovery target */
    deskGreenLockRs: 50,
    /** One extra index trade if desk is red after a prior green leg */
    recoveryMaxExtra: 1,
  },

  research: {
    window: '2026-07-13 → 2026-08-11',
    allThreeZeroRed: '9/9 green · net ≈ ₹13.0k · bankOnlyAfterNifty',
    liveFix12Aug:
      'indexFirstWinLock — would keep +₹387 and skip giveback legs (desk was −₹582)',
    unconstrainedBest:
      '20/22 green · 2 red · net ≈ ₹25.4k (Bank-alone reds 13 Jul / 24 Jul)',
    crudeAfterNse: 'LIVE_CRUDE_GREEN · hard gate 15:15 · entries 16:00–21:00',
    note:
      'First-win green lock + one recovery shot. Not a guarantee of every calendar day.',
  },
};

/** Extras merged into Trap initialize() for LIVE_GREEN. */
function liveGreenTrapExtras(overrides = {}) {
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
    ...overrides,
  };
}

/** Tighter trail used on the live recovery shot. */
function liveGreenRecoveryTrailExtras() {
  return liveGreenTrapExtras({
    profitLockArmRs: 60,
    profitLockLockRs: 80,
    profitLockGivebackRs: 25,
    optionStandDownRs: 300,
  });
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
    paperLivePath: true,
    fillFrictionPremium: LIVE_GREEN_DNA.liveOps.fillFrictionPremium,
    crudeAfterIndexClose: true,
    bankOnlyAfterNifty: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty,
    bankOnlyAfterNiftyGreen: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNiftyGreen,
    indexFirstWinLock: LIVE_GREEN_DNA.liveOps.indexFirstWinLock,
    deskGreenLockRs: LIVE_GREEN_DNA.liveOps.deskGreenLockRs,
    recoveryMaxExtra: LIVE_GREEN_DNA.liveOps.recoveryMaxExtra,
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenRecoveryTrailExtras,
  liveGreenStartConfig,
};
