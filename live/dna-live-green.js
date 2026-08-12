/**
 * LIVE_GREEN DNA — Daily Band Loop (₹750–₹2000 @ 1 lot).
 *
 * THE LOOP (research → when followed prints the band; when broken → red):
 *   1) Trap signals: pierce20 / Bank60 · peak ₹100/50/50 · max3/2 · stand ₹350
 *      · 09:45–14:45 · 3.5R · next-bar confirm
 *   2) Sequence: Nifty → Bank only after Nifty (and Nifty day green) →
 *      Crude after 15:15 only if dayNet still < ₹750
 *   3) One open leg across the desk
 *   4) Band: keep trading while dayNet < ₹750; LOCK at ₹750; hard LOCK ₹2000;
 *      hard STOP −₹2950
 *   5) No dig: once dayNet was green, a losing close stops further INDEX
 *      (Crude may still finish the band after NSE)
 *   6) Live ops: reject estimated premiums · trail SL ratchet · cancel SL
 *      before EXIT · fill ledger · option stand-down
 *
 * Evidence (Paper≡Live / live-path, 1 lot):
 *   Jul 2026 ≈ 23/23 · avg ~₹1,496/day
 *   21 Jul–10 Aug paper 15/15 · ~₹1.8k/day · friction-hard ~₹1.2k/day
 *   Aug MTD All3 days mostly ₹1.2k–₹2.8k (inside/above band)
 *   Broken ops: 10 Aug live −₹1,297 · 12 Aug re-hunt after +₹387 → −₹582
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-daily-band-v4',
  label: 'Daily Band ₹750–2000 · Nifty→Bank→Crude · Paper≡Live',
  version: '2026.08.12-daily-band',

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
   * Trap = Support/Resistance engine:
   *   swing lookback → S/R · pierce beyond level · reclaim close · next-bar confirm
   *   optional OR / PDHL confluence so we only trade structural S/R
   */
  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    swingLb: 5,
    trapMode: 'trap',
    /** Swing S/R must sit within N pts of morning OR hi/lo (0=off until hunt sets it) */
    orConfluencePts: 40,
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
    dailyBand: '₹750–₹2000 @ 1 lot when loop followed',
    july2026: '23/23 green · avg ~₹1,496/day',
    paper21Jul10Aug: '15/15 · ~₹1.8k/day (friction-hard ~₹1.2k)',
    allThreeZeroRed: '9/9 green · net ≈ ₹13.0k · bankOnlyAfterNifty',
    augMtdAll3:
      '≈ ₹12.1k / 7 days · daily ≈ ₹1.2k–₹2.8k (11 Aug +₹1,211 @ 1 lot)',
    breakExamples:
      '10 Aug live ops miss → −₹1,297 · 12 Aug re-hunt after +₹387 → −₹582',
    loop:
      'Nifty→Bank(after Nifty green)→band lock ₹750/₹2000→no dig after green→Crude if still <₹750',
    note:
      'Band is the researched average zone at 1 lot — not a calendar-day guarantee if signals skip or fills diverge.',
  },
};

/** Extras merged into Trap initialize() for LIVE_GREEN. */
function liveGreenTrapExtras(overrides = {}) {
  const t = LIVE_GREEN_DNA.trap;
  return {
    piercePts: t.piercePts,
    bankPiercePts: t.bankPiercePts,
    swingLb: t.swingLb || 5,
    profitLockArmRs: t.profitLockArmRs,
    profitLockLockRs: t.profitLockLockRs,
    profitLockGivebackRs: t.profitLockGivebackRs,
    slConfirmCutoffEnabled: t.slConfirmCutoffEnabled,
    slConfirmSoftRs: t.softRs,
    trapMode: t.trapMode || 'trap',
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
