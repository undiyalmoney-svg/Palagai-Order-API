/**
 * LIVE_CRUDE_GREEN DNA v3 — after NSE close only.
 *
 * Never enters before 15:15 IST. Entries start 16:00 IST (after index cash).
 *
 * Engine-validated May–Aug 2026 @ 1 lot (charge-aware):
 *   13/14 green (92.9%) · net ≈ ₹2.6k · 0 entries before 15:30
 *
 * Method: session-OR · OR width 40–60 · 16:00–21:00 · SL30/TP80
 *   trail ₹350→₹180 · max 1/day · first-win · confirm ON
 */

const LIVE_CRUDE_GREEN_DNA = {
  id: 'live-crude-green-v3',
  label: 'Live Crude Green · after NSE close',
  version: '2026.08.10-after-nse',
  profileId: 'live-crude-green',

  enableNifty: false,
  enableBank: false,
  enableCrude: true,
  crudeLots: 1,
  crudeStrategy: 'live-crude-green',

  dayProfitLock: true,
  dayProfitLockRs: 1500,
  strictDayStop: true,
  strictDayStopRs: 300,

  signal: {
    entryMode: 'session-or',
    orStart: '09:00',
    orEnd: '09:30',
    /** After Bank/Nifty cash close — no overlap with index session. */
    entryStart: '16:00',
    entryEnd: '21:00',
    stopPts: 30,
    targetPts: 80,
    requireConfirm: true,
    firstWinLock: true,
    maxTradesDay: 1,
    minOrWidth: 40,
    maxOrWidth: 60,
    breakBufferPts: 0,
    profitLockArmRs: 350,
    profitLockLockRs: 180,
    profitLockGivebackRs: 170,
  },

  liveOps: {
    maxOpenLegs: 1,
    /** Hard gate — no Crude entries before this IST time (always). */
    crudeAfterIndexClose: true,
    crudeAfterIndexCloseTime: '15:15',
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
  },

  research: {
    window: '2026-05-01 → 2026-08-10',
    greenDays: '13/14 (92.9%)',
    engineValidated: true,
    netRsApprox: 2641,
    earlyEntriesBefore1515: 0,
    note:
      'Entry window 16:00–21:00 + hard worker gate 15:15. No Crude before 3:15pm IST.',
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
      'After NSE · OR40–60 · 16:00–21:00 · SL30/TP80 · trail ₹350→₹180 · max1 · first-win',
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
    dnaId: withIndex ? 'live-green+crude-v3' : LIVE_CRUDE_GREEN_DNA.id,
    maxOpenLegs: LIVE_CRUDE_GREEN_DNA.liveOps.maxOpenLegs,
    crudeAfterIndexClose: true,
  };
}

module.exports = {
  LIVE_CRUDE_GREEN_DNA,
  liveCrudeGreenProfileOverrides,
  liveCrudeGreenStartConfig,
};
