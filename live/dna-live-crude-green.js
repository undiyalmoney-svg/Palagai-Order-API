/**
 * CRUDE TREASURE DNA v4 — pairs with index treasure (Nifty+Bank).
 *
 * Hunt + refine 2026-08-12 (live-path · reject estimated · dust ₹10):
 *   Session-OR · SL20/TP60 · OR width 35–65 · confirm OFF · unlimited
 *   · trail ₹350→₹180 · after NSE 16:00–21:00 · no day lock/stop
 *
 * Crude-only (Jul 1 → Aug 11 marks): 11/11 green · avg ~₹839/day
 * All3 with index treasure: 20/20 green · avg ~₹1,719/day
 *
 * Hard worker gate: no new Crude before 15:15 IST.
 */

const LIVE_CRUDE_GREEN_DNA = {
  id: 'live-crude-treasure-v4',
  label: 'Crude Treasure · Session-OR · Unlimited · Zero-red',
  version: '2026.08.12-crude-treasure',
  profileId: 'live-crude-green',

  enableNifty: false,
  enableBank: false,
  enableCrude: true,
  crudeLots: 1,
  crudeStrategy: 'live-crude-green',

  /** No profit/stop caps — S/R-OR + trail carry the edge */
  dayProfitLock: false,
  dayProfitLockRs: 0,
  strictDayStop: false,
  strictDayStopRs: 0,

  signal: {
    entryMode: 'session-or',
    orStart: '09:00',
    orEnd: '09:30',
    /** After Bank/Nifty cash close — no overlap with index session. */
    entryStart: '16:00',
    entryEnd: '21:00',
    stopPts: 20,
    targetPts: 60,
    /** Hunt winner: confirm OFF */
    requireConfirm: false,
    firstWinLock: false,
    /** 0 = unlimited */
    maxTradesDay: 0,
    minOrWidth: 35,
    maxOrWidth: 65,
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
    windowLiveMarks: '2026-07-01 → 2026-08-11',
    crudeZeroRed:
      '11/11 green · avg ~₹839/day · sor SL20/TP60 · OR35–65 · confirm OFF · unlimited · trail on',
    all3ZeroRed:
      '20/20 green · avg ~₹1,719/day with index treasure (pivot2 BOTH p20/B60 stand0)',
    note:
      'After NSE only. OR35–65 beat OR40–60 (more crude days + higher All3 avg). Trail required (off → 1 red). No trade/profit caps.',
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
    dayLossStopPts: 0,
    strictDayLossPts: 0,
    dayProfitLockPts: 0,
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
      'Treasure · after NSE · OR35–65 · 16:00–21:00 · SL20/TP60 · no confirm · trail ₹350→₹180 · unlimited',
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
    dayProfitLock: false,
    strictDayStop: false,
    enableKutty: false,
    kuttyAlone: false,
    realOrders: true,
    dnaId: withIndex ? 'live-green-treasure+crude-v4' : LIVE_CRUDE_GREEN_DNA.id,
    maxOpenLegs: LIVE_CRUDE_GREEN_DNA.liveOps.maxOpenLegs,
    crudeAfterIndexClose: true,
  };
}

module.exports = {
  LIVE_CRUDE_GREEN_DNA,
  liveCrudeGreenProfileOverrides,
  liveCrudeGreenStartConfig,
};
