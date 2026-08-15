/**
 * LIVE_GREEN DNA — ₹1,000 / day desk @ ₹40k capital (1 lot).
 *
 * Quality path (not a guarantee of every trade):
 *   Entry: confirmed S/R trap only (no bounce), next-bar confirm, real premium
 *   Bank: only after Nifty closed GREEN that day
 *   Exit: arm ₹400 then lock ₹400 (no giveback). Stand-down ₹350 if wrong.
 *   Desk: lock +₹1,000 · protect 50% at +₹500 · max 3 (Nifty 2 / Bank 1)
 *   Lots: UI capital ÷ ₹40k (₹40k→1, ₹80k→2, ₹1.2L→3). Trade count does not scale.
 *   Crude OFF
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-1k-40k-v4',
  label: 'Live Green · ₹1k @ ₹40k · floor ₹400 · lots÷40k',
  version: '2026.08.15-lot40k-floor400',

  /** Books — ₹40k capital maps to 1 shared desk lot */
  enableNifty: true,
  enableBank: true,
  enableCrude: false,
  niftyLots: 1,
  bankLots: 1,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',
  defaultCapitalRs: 40000,

  /** Day risk (₹ band @ 1 lot) — measured on option ₹, not index pts */
  dayProfitLock: true,
  dayProfitLockRs: 1000,
  /** No desk day-loss kill. Stand-down ₹350 still cuts a bad leg. */
  strictDayStop: false,
  strictDayStopRs: 0,

  /** Trap — pierce + next-bar confirm only (bounce entries are noise). */
  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    /** Arm at ₹400 / lot, then keep ₹400 — do not drain ₹200. Scales with lots. */
    profitLockArmRs: 400,
    profitLockLockRs: 400,
    profitLockGivebackRs: 0,
    maxTradesPerDay: 2,
    bankMaxTradesPerDay: 1,
    targetRMultiple: 3.5,
    confirmNextBar: true,
    minConfirmBody: 4,
    trapMode: 'trap',
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
    /** Zero-red: Bank only after Nifty traded that day */
    bankOnlyAfterNifty: true,
    /** Bank only if Nifty's closed trades today are net green */
    bankOnlyAfterNiftyGreen: true,
    /** Desk-wide cap so fees don't eat a green day (2–3 trades) */
    deskMaxTradesDay: 3,
    chargeCoverMultiple: 4,
    /**
     * 50/50 of the ₹1,000 target: once day net ≥ ₹500, stop new entries.
     * Stops Bank/Nifty #2 from giving back a made day (13 Aug Nifty +₹600 then Bank −₹487).
     */
    deskGreenProtectRs: 500,
  },

  research: {
    window: '2026-07-15 → 2026-08-13',
    target: '₹1,000 net @ 1 lot (₹40k) in ≤3 trades',
    allThreeZeroRed: 'Bank-after-Nifty kills 15 Jul / 21 Jul / 06 Aug Bank-alone reds',
    note:
      'Floor ₹400 after arm (no giveback). Lots = capital/₹40k. Nifty 2 + Bank 1 regardless of lots. Crude off.',
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
    minConfirmBody: t.minConfirmBody || 0,
    trapMode: t.trapMode === 'both' ? 'both' : 'trap',
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
    bankOnlyAfterNiftyGreen: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNiftyGreen,
    deskGreenProtectRs: LIVE_GREEN_DNA.liveOps.deskGreenProtectRs,
    capitalRs: LIVE_GREEN_DNA.defaultCapitalRs,
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenStartConfig,
};
