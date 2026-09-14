/**
 * LIVE_CRUDE_GREEN DNA v3 — after NSE close only.
 *
 * Never enters before 15:15 IST. Entries start 16:00 IST (after index cash).
 *
 * Engine-validated 2026-08-13→09-13 @ 1 Mini lot (charge-aware):
 *   13W/7L · net ₹+1,800 · PF 1.76 · 0 entries before 16:00
 *
 * Method: session-OR · OR width ≤60 · 16:00–19:00 · SL30/TP80
 *   trail ₹350→₹180 · max 2/day · confirm ON · no fade PDH
 * Killed: SL20/15 (more losses). Max 1/day overfit the Aug–Sep slice.
 */

const LIVE_CRUDE_GREEN_DNA = {
  id: 'live-crude-green-v3',
  label: 'Live Crude Green · after NSE close',
  version: '2026.09-19-max2',
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
    /** Late-session PE (after 19:00) was the 14 Aug −₹1,020 SL. */
    entryEnd: '19:00',
    stopPts: 30,
    targetPts: 80,
    requireConfirm: true,
    firstWinLock: false,
    /**
     * Max 1/day cut Aug 13–Sep 13 losses to ₹0, but on Kite 2026-06-01→09-14
     * (CRUDEOILM26SEPFUT) it ate net: max1+19:00 ₹3,840 vs max2+19:00 ₹8,640.
     * Last-entry 19:00 is the loss cut that still raises net (vs 21:00).
     */
    maxTradesDay: 2,
    minOrWidth: 0,
    maxOrWidth: 60,
    /** Afternoon CE (long Mini) was the −₹1,020 bleed on 13 Aug–13 Sep. PE only. */
    allowBuy: false,
    allowSell: true,
    /**
     * Do not short into/above the prior day's high (ORB: that is a fade into
     * resistance, not a breakdown). Buffer 10 pts also skips shorts hugging PDH.
     * Kite CRUDEOILM26SEPFUT 2026-06-01→09-14 @ 3 lots:
     *   max2+21:00  loss ₹12,270 net ₹5,280
     *   max1+19:00  loss ₹6,120  net ₹3,840  (overfit)
     *   max2+19:00  loss ₹8,160  net ₹8,640  <- live DNA
     */
    skipFadePriorDay: true,
    fadeBufferPts: 10,
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
    /** Crude is its own evening book — do not sit out on Nifty/Bank P&L. */
    crudeSkipIfIndexGreen: false,
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
  },

  research: {
    window: '2026-08-13 → 2026-09-13',
    greenDays: '16W / 8L @ 3 lots (Jun–mid Sep Kite)',
    engineValidated: true,
    netRsApprox: 8640,
    profitFactor: 2.06,
    earlyEntriesBefore1515: 0,
    note:
      'PE only. Skip PDH fade. Max 2/day. Last entry 19:00. SL30. Max 1/day overfit Aug–Sep.',
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
    allowBuy: s.allowBuy !== false,
    allowSell: s.allowSell !== false,
    skipFadePriorDay: s.skipFadePriorDay === true,
    fadeBufferPts: s.fadeBufferPts || 0,
    defaultEnableMorning: false,
    defaultEnableEvening: true,
    dailyBandLabel:
      'After NSE · OR≤60 · PE only · no fade PDH · 16:00–19:00 · SL30/TP80 · trail ₹350→₹180 · max2',
    profitLockArmRs: s.profitLockArmRs,
    profitLockLockRs: s.profitLockLockRs,
    profitLockGivebackRs: s.profitLockGivebackRs,
    slConfirmCutoffEnabled: false,
    slConfirmCutoffFracR: 0.55,
    slConfirmCutoffMaxMfeR: 0.75,
    slConfirmSoftRs: 700,
  };
}


/**
 * liveCrudeGreenStartConfig() was REMOVED 2026-08-28 (Phase 3.0 section 21),
 * same reason as liveGreenStartConfig(): it returned `realOrders: true`,
 * nothing referenced it, and it was reachable by any future caller.
 */
module.exports = {
  LIVE_CRUDE_GREEN_DNA,
  liveCrudeGreenProfileOverrides,
};
