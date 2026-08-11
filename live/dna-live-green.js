/**
 * LIVE_GREEN DNA — multi-strategy daily desk (2026-08-11).
 *
 * Research winner for Nifty+Bank+Crude under Paper≡Live:
 *   Bank only AFTER Nifty has traded that day → 0 red / 9 green (~₹13k)
 *   on 13 Jul–11 Aug (kills Bank-alone morning reds).
 *   Crude LIVE_CRUDE_GREEN after NSE (second session).
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-all3-v2',
  label: 'Live Green · Nifty→Bank→Crude · Paper≡Live',
  version: '2026.08.11-all3',

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

  /** Trap signal DNA — Bank pierce raised (research: B60) */
  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    profitLockArmRs: 100,
    profitLockLockRs: 50,
    profitLockGivebackRs: 50,
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
  },

  research: {
    window: '2026-07-13 → 2026-08-11',
    allThreeZeroRed: '9/9 green · net ≈ ₹13.0k · bankOnlyAfterNifty',
    unconstrainedBest:
      '20/22 green · 2 red · net ≈ ₹25.4k (Bank-alone reds 13 Jul / 24 Jul)',
    crudeAfterNse: 'LIVE_CRUDE_GREEN · after 15:30',
    note:
      'Bank gated until Nifty trades that day. Crude evening still runs. Not a guarantee of every calendar day.',
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
    paperLivePath: true,
    fillFrictionPremium: LIVE_GREEN_DNA.liveOps.fillFrictionPremium,
    crudeAfterIndexClose: true,
    bankOnlyAfterNifty: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty,
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenStartConfig,
};
