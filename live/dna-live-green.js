/**
 * LIVE_GREEN DNA — multi-strategy live desk (2026-08-11).
 *
 * Goal: Paper ≡ Live, diversify beyond single Trap session.
 *
 * Books:
 *   - Nifty Trap + Bank Trap (one-leg shared capital)
 *   - Crude LIVE_CRUDE_GREEN after NSE (second strategy session)
 *
 * Live ops that made paper greener than broker:
 *   rejectEstimatedPremium · maxOpenLegs 1 · option-₹ day lock · fill friction
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-multi-v1',
  label: 'Live Green · Trap + evening Crude · Paper≡Live',
  version: '2026.08.11',

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
  dayProfitLockRs: 3000,
  strictDayStop: true,
  strictDayStopRs: 2950,

  /** Trap signal DNA */
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

  liveOps: {
    maxOpenLegs: 1,
    optionStandDownRs: 350,
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
    /** Paper path fill friction (option premium ₹). */
    fillFrictionPremium: 0.5,
    /** Day lock/stop use option ₹ (not index points). */
    optionRsDayRisk: true,
  },

  research: {
    window: '2026-07-13 → 2026-08-11',
    paperVsLiveGap:
      'Paper booked estimated premiums + overlapping Nifty/Bank; live skipped those → paper green / live red',
    fix: 'Paper≡Live gates + option-₹ day lock + evening Crude second session',
    niftyOnlyLivePathGreenDays: '7/7 (100%)',
    niftyOnlyLivePathNetRs: 8136,
    crudeAfterNse: '13/14 green engine-validated (May–Aug)',
    note:
      'Multi-strategy: index Trap (one-leg) + Crude after 15:30. Not a guarantee of every calendar day green.',
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
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenStartConfig,
};
