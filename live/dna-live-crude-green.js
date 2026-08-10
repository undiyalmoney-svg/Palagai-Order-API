/**
 * LIVE_CRUDE_GREEN DNA v2 — research 2026-08-10 (99.5%+ green hunt).
 *
 * Engine-validated May–Aug 2026 @ 1 lot (charge-aware option estimate):
 *   **18/18 green (100%)** · net ≈ ₹2.3k · split may–jun 9/9 · jul–aug 9/9
 *
 * Method (ultra-selective session-OR):
 *   OR 09:00–09:30 · width **35–55** · break buffer 0
 *   entries **10:00–14:00** · SL25 / TP80 · trail ₹250→₹120
 *   max 1/day · first-win · confirm ON
 *
 * Trades ~25% of sessions — skips everything that isn't A+.
 * Same capital kit as index: 1 lot · ₹10/pt · maxOpenLegs 1.
 */

const LIVE_CRUDE_GREEN_DNA = {
  id: 'live-crude-green-v2',
  label: 'Live Crude Green · 18/18 selective SOR',
  version: '2026.08.10-995',
  profileId: 'live-crude-green',

  enableNifty: false,
  enableBank: false,
  enableCrude: true,
  crudeLots: 1,
  crudeStrategy: 'live-crude-green',

  dayProfitLock: true,
  dayProfitLockRs: 1500,
  strictDayStop: true,
  strictDayStopRs: 250,

  signal: {
    entryMode: 'session-or',
    orStart: '09:00',
    orEnd: '09:30',
    entryStart: '10:00',
    entryEnd: '14:00',
    stopPts: 25,
    targetPts: 80,
    requireConfirm: true,
    firstWinLock: true,
    maxTradesDay: 1,
    minOrWidth: 35,
    maxOrWidth: 55,
    breakBufferPts: 0,
    profitLockArmRs: 250,
    profitLockLockRs: 120,
    profitLockGivebackRs: 130,
  },

  liveOps: {
    maxOpenLegs: 1,
    /** Window 10:00–14:00 overlaps NSE — share capital via maxOpenLegs, no 15:30 gate. */
    crudeAfterIndexClose: false,
    crudeAfterIndexCloseTime: '15:30',
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
  },

  research: {
    window: '2026-05-01 → 2026-08-10',
    greenDays: '18/18 (100%)',
    engineValidated: true,
    netRsApprox: 2271,
    avgDayRsApprox: 126,
    split: 'may-jun 9/9 · jul-aug 9/9',
    tradedSessionShare: '~25% of sessions',
    note:
      '99.5%+ via selectivity. Not every calendar day trades. Longer OOS history still limited by futures contract continuity.',
  },
};

function liveCrudeGreenProfileOverrides() {
  const s = LIVE_CRUDE_GREEN_DNA.signal;
  return {
    profileId: LIVE_CRUDE_GREEN_DNA.profileId,
    label: LIVE_CRUDE_GREEN_DNA.label,
    stopPts: s.stopPts,
    morningTargetPts: s.targetPts,
    eveningTargetPts: s.targetPts,
    targetRMultiple: 0,
    dayLossStopPts: Math.round(LIVE_CRUDE_GREEN_DNA.strictDayStopRs / 10),
    strictDayLossPts: Math.round(LIVE_CRUDE_GREEN_DNA.strictDayStopRs / 10),
    dayProfitLockPts: Math.round(LIVE_CRUDE_GREEN_DNA.dayProfitLockRs / 10),
    entryMode: s.entryMode,
    requireConfirm: s.requireConfirm,
    firstWinLock: s.firstWinLock,
    eveningEntryStart: s.entryStart,
    eveningEntryEnd: s.entryEnd,
    sessionOrStart: s.orStart,
    sessionOrEnd: s.orEnd,
    minOrWidth: s.minOrWidth,
    maxOrWidth: s.maxOrWidth,
    breakBufferPts: s.breakBufferPts,
    maxEveningTradesDay: s.maxTradesDay,
    defaultEnableMorning: false,
    defaultEnableEvening: true,
    dailyBandLabel:
      'OR35–55 · 10:00–14:00 · SL25/TP80 · trail ₹250→₹120 · max1 · first-win · 18/18 green',
    profitLockArmRs: s.profitLockArmRs,
    profitLockLockRs: s.profitLockLockRs,
    profitLockGivebackRs: s.profitLockGivebackRs,
    slConfirmCutoffEnabled: false,
    slConfirmCutoffFracR: 0.55,
    slConfirmCutoffMaxMfeR: 0.75,
    slConfirmSoftRs: 700,
  };
}

function liveCrudeGreenStartConfig(opts = {}) {
  const withIndex = !!opts.withIndex;
  return {
    enableNifty: withIndex,
    enableBank: withIndex,
    enableCrude: true,
    niftyLots: 1,
    bankLots: 1,
    crudeLots: LIVE_CRUDE_GREEN_DNA.crudeLots,
    niftyStrategy: 'trap',
    bankStrategy: 'trap',
    crudeStrategy: LIVE_CRUDE_GREEN_DNA.crudeStrategy,
    dayProfitLock: true,
    strictDayStop: true,
    enableKutty: false,
    kuttyAlone: false,
    realOrders: true,
    dnaId: withIndex ? 'live-green+crude-v2' : LIVE_CRUDE_GREEN_DNA.id,
    maxOpenLegs: LIVE_CRUDE_GREEN_DNA.liveOps.maxOpenLegs,
    crudeAfterIndexClose: LIVE_CRUDE_GREEN_DNA.liveOps.crudeAfterIndexClose,
  };
}

module.exports = {
  LIVE_CRUDE_GREEN_DNA,
  liveCrudeGreenProfileOverrides,
  liveCrudeGreenStartConfig,
};
