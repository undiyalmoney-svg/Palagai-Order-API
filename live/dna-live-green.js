/**
 * LIVE_GREEN DNA — Pivot S/R + perfect sweep SL · Daily Band ₹750–₹2000.
 *
 * ENTRY (paper≡live):
 *   Confirmed pivot S/R (fractal) → pierce beyond level → reclaim → confirm
 *   Perfect SL = 1pt beyond liquidity-sweep extreme (same index stop live uses
 *   for protective option SL) → paper marks match broker risk.
 *   mode BOTH · pierce20/B60 · OR confluence OFF
 *
 * DESK LOOP:
 *   Nifty → Bank after Nifty green → band lock ₹750 / hard ₹2000 → no dig
 *   → Crude after 15:15 only if still < ₹750 · one-leg · stand-down ₹350
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-sr-perfect-v6',
  label: 'Pivot S/R · Perfect SL · Band ₹750–2000',
  version: '2026.08.12-sr-perfect-sl',

  /** Target band @ 1 lot (scale with deskLots in worker risk). */
  dailyBand: {
    minRs: 750,
    maxRs: 2000,
  },

  /** Books */
  enableNifty: true,
  enableBank: true,
  enableCrude: true,
  niftyLots: 1,
  bankLots: 1,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',

  /** Day risk — upper band = profit lock */
  dayProfitLock: true,
  dayProfitLockRs: 2000,
  strictDayStop: true,
  strictDayStopRs: 2950,

  /**
   * Trap = Pivot S/R + perfect sweep SL:
   *   pivot strength 2 (confirmed fractal) · SL at sweep extreme ±1pt
   *   mode BOTH · pierce20/B60 · OR confluence OFF
   */
  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    swingLb: 5,
    srMethod: 'pivot',
    pivotStrength: 2,
    perfectSweepSl: true,
    slPadPts: 1,
    trapMode: 'both',
    /** Hunt: OR confluence reduced Aug 10/11 out of ₹750–2000 band — keep 0 */
    orConfluencePts: 0,
    pdhlConfluencePts: 0,
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
    bankOnlyAfterNifty: true,
    bankOnlyAfterNiftyGreen: true,
    /**
     * Win-streak → band:
     *  - LOCK when dayNet ≥ bandMin (₹750)
     *  - LOCK index after a loss that followed a green dayNet (no dig)
     *  - Crude still allowed after NSE while dayNet < bandMin
     */
    winStreakToBand: true,
    deskGreenLockRs: 750,
    /** Off — band loop replaces first-win + recovery patch */
    indexFirstWinLock: false,
    recoveryMaxExtra: 0,
    crudeOnlyBelowBand: true,
  },

  research: {
    window: '2026-07-13 → 2026-08-11',
    srHunt:
      'BOTH pierce20/B60 · live-path 10–11 Aug +₹1251/+₹1149 in band. Pivot S/R + perfect sweep SL = same index stop paper & live.',
    dailyBand: '₹750–₹2000 @ 1 lot when S/R loop followed',
    paperLiveMatch:
      'reject estimated · one-leg · fill ledger · trail SL · cancel SL before EXIT · SL at sweep extreme',
    breakExamples:
      'Missed S/R/SL ops → paper≠live (10 Aug −₹1,297 · 12 Aug re-hunt)',
    loop:
      'Pivot S/R → pierce/reclaim → confirm → SL@sweep → band ₹750/₹2000 → no dig → Crude if <₹750',
    note:
      'Correct S/R + perfect SL is the paper≡live contract. Band is researched zone @ 1 lot.',
  },
};

/** Extras merged into Trap initialize() for LIVE_GREEN. */
function liveGreenTrapExtras(overrides = {}) {
  const t = LIVE_GREEN_DNA.trap;
  return {
    piercePts: t.piercePts,
    bankPiercePts: t.bankPiercePts,
    swingLb: t.swingLb || 5,
    srMethod: t.srMethod || 'pivot',
    pivotStrength: t.pivotStrength || 2,
    perfectSweepSl: t.perfectSweepSl !== false,
    slPadPts: t.slPadPts != null ? t.slPadPts : 1,
    profitLockArmRs: t.profitLockArmRs,
    profitLockLockRs: t.profitLockLockRs,
    profitLockGivebackRs: t.profitLockGivebackRs,
    slConfirmCutoffEnabled: t.slConfirmCutoffEnabled,
    slConfirmSoftRs: t.softRs,
    trapMode: t.trapMode || 'both',
    orConfluencePts: t.orConfluencePts || 0,
    pdhlConfluencePts: t.pdhlConfluencePts || 0,
    bounceOrPierceMult: 0,
    bounceOrPierceCap: 0,
    optionStandDownRs: LIVE_GREEN_DNA.liveOps.optionStandDownRs,
    ...overrides,
  };
}

function liveGreenRecoveryTrailExtras() {
  // Kept for API compat — band loop does not use a separate recovery trail.
  return liveGreenTrapExtras();
}

function liveGreenStartConfig() {
  const ops = LIVE_GREEN_DNA.liveOps;
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
    maxOpenLegs: ops.maxOpenLegs,
    optionStandDownRs: ops.optionStandDownRs,
    paperLivePath: true,
    fillFrictionPremium: ops.fillFrictionPremium,
    crudeAfterIndexClose: true,
    bankOnlyAfterNifty: ops.bankOnlyAfterNifty,
    bankOnlyAfterNiftyGreen: ops.bankOnlyAfterNiftyGreen,
    winStreakToBand: ops.winStreakToBand,
    indexFirstWinLock: ops.indexFirstWinLock,
    deskGreenLockRs: ops.deskGreenLockRs,
    recoveryMaxExtra: ops.recoveryMaxExtra,
    crudeOnlyBelowBand: ops.crudeOnlyBelowBand,
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenRecoveryTrailExtras,
  liveGreenStartConfig,
};
