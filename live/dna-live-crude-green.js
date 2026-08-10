/**
 * LIVE_CRUDE_GREEN DNA — research 2026-08-10 (charge-aware option estimate).
 *
 * Goal: Crude-only desk that stays daily-green under live fees, using the same
 * capital/lot model as index LIVE_GREEN (1 lot · ₹10/pt · lock ₹3k · stop ₹2950
 * · maxOpenLegs 1).
 *
 * Method: All-Green session-OR (09:00–09:30 OR break), but fee-capped:
 *   SL20 / TP120 · protect trail ₹500→₹240 · max 2/day · first-win lock.
 *
 * May–Aug 2026 (1 lot, delta·charges model):
 *   green 48/65 days (74.4%) · net ≈ ₹4.4k · ~1.5 trades/day · worst ≈ −₹222
 *
 * Unlimited All-Green is greener on gross but ~10 trades/day — historically
 * burned MCX option charges in live. Do not re-enable unlimited as default.
 */

const LIVE_CRUDE_GREEN_DNA = {
  id: 'live-crude-green-v1',
  label: 'Live Crude Green · SOR SL20/TP120 max2',
  version: '2026.08.10',
  profileId: 'live-crude-green',

  /** Books — Crude desk; index stays on LIVE_GREEN when combined. */
  enableNifty: false,
  enableBank: false,
  enableCrude: true,
  crudeLots: 1,
  crudeStrategy: 'live-crude-green',

  /** Same ₹ band as index desk @ 1 lot (₹10/pt → 300 / 295 pts). */
  dayProfitLock: true,
  dayProfitLockRs: 3000,
  strictDayStop: true,
  strictDayStopRs: 2950,

  signal: {
    entryMode: 'session-or',
    orStart: '09:00',
    orEnd: '09:30',
    entryStart: '09:00',
    entryEnd: '23:00',
    stopPts: 20,
    targetPts: 120,
    requireConfirm: true,
    firstWinLock: true,
    maxTradesDay: 2,
    maxOrWidth: 0,
    profitLockArmRs: 500,
    profitLockLockRs: 240,
    profitLockGivebackRs: 260,
  },

  liveOps: {
    maxOpenLegs: 1,
    /**
     * When index books are also on, only enter Crude after NSE close so the
     * one-leg capital slot is free. Pure Crude desk ignores this.
     */
    crudeAfterIndexClose: true,
    crudeAfterIndexCloseTime: '15:30',
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
  },

  research: {
    window: '2026-05-01 → 2026-08-10',
    greenDays: '48/65 (74.4%)',
    netRsApprox: 4432,
    avgDayRsApprox: 70,
    tradesPerDay: 1.52,
    worstDayRsApprox: -222,
    runnerUp:
      'Trap 3.5R + protect max2 firstWin · 71.2% green · higher net ≈ ₹6.7k',
    note:
      'Unlimited All-Green ~74% green but ~10 t/d — fee death in live. Cap at max2 + first-win.',
  },
};

/** Profile overrides merged into resolveCrudeStrategyProfile('live-crude-green'). */
function liveCrudeGreenProfileOverrides() {
  const s = LIVE_CRUDE_GREEN_DNA.signal;
  const lockPts = Math.round(LIVE_CRUDE_GREEN_DNA.dayProfitLockRs / 10);
  const stopPts = Math.round(LIVE_CRUDE_GREEN_DNA.strictDayStopRs / 10);
  return {
    profileId: LIVE_CRUDE_GREEN_DNA.profileId,
    label: LIVE_CRUDE_GREEN_DNA.label,
    stopPts: s.stopPts,
    morningTargetPts: s.targetPts,
    eveningTargetPts: s.targetPts,
    targetRMultiple: 0,
    dayLossStopPts: stopPts,
    strictDayLossPts: stopPts,
    dayProfitLockPts: lockPts,
    entryMode: s.entryMode,
    requireConfirm: s.requireConfirm,
    firstWinLock: s.firstWinLock,
    eveningEntryStart: s.entryStart,
    eveningEntryEnd: s.entryEnd,
    sessionOrStart: s.orStart,
    sessionOrEnd: s.orEnd,
    maxOrWidth: s.maxOrWidth,
    maxEveningTradesDay: s.maxTradesDay,
    defaultEnableMorning: false,
    defaultEnableEvening: true,
    dailyBandLabel:
      'OR 09:00–09:30 · SL20/TP120 · trail ₹500→₹240 · max2 · first-win · desk ₹3k/₹2950',
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
    dnaId: withIndex ? 'live-green+crude-v1' : LIVE_CRUDE_GREEN_DNA.id,
    maxOpenLegs: LIVE_CRUDE_GREEN_DNA.liveOps.maxOpenLegs,
    crudeAfterIndexClose: LIVE_CRUDE_GREEN_DNA.liveOps.crudeAfterIndexClose,
  };
}

module.exports = {
  LIVE_CRUDE_GREEN_DNA,
  liveCrudeGreenProfileOverrides,
  liveCrudeGreenStartConfig,
};
