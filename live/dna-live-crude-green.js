/**
 * PROFESSIONAL CRUDE DNA (v5) — risk-managed after-NSE breakout.
 *
 * Why the old v4 bled: SL20 is nothing for Crude Oil (moves 20 pts constantly),
 * confirm-off + unlimited re-entered every 60s tick → 18 losing round-trips,
 * each paying the option spread. Professional fix:
 *   - Confirmation ON, wider structural SL (40 pts), 2R target.
 *   - Max 2 trades/day + cooldown (worker guard) + daily loss stop.
 *   - Only clean OR-range breakouts after NSE close (16:00–21:00).
 *
 * NOT a guaranteed-green promise. Validate in paper.
 */

const LIVE_CRUDE_GREEN_DNA = {
  id: 'live-crude-pro-v5',
  label: 'Crude Professional · OR breakout · risk-managed',
  version: '2026.08.12-crude-professional',
  profileId: 'live-crude-green',

  enableNifty: false,
  enableBank: false,
  enableCrude: true,
  crudeLots: 1,
  crudeStrategy: 'live-crude-green',

  /** Professional daily risk envelope. */
  dayProfitLock: true,
  dayProfitLockRs: 1500,
  strictDayStop: true,
  strictDayStopRs: 800,

  signal: {
    entryMode: 'session-or',
    orStart: '09:00',
    orEnd: '09:30',
    /** After Bank/Nifty cash close — no overlap with index session. */
    entryStart: '16:00',
    entryEnd: '21:00',
    /** Wider structural stop — Crude noise chops a 20pt SL to pieces. */
    stopPts: 40,
    targetPts: 80,
    /** Confirmation ON — no raw break entries. */
    requireConfirm: true,
    firstWinLock: false,
    /** Hard cap — quality over churn (worker cooldown also applies). */
    maxTradesDay: 2,
    minOrWidth: 35,
    maxOrWidth: 65,
    breakBufferPts: 5,
    profitLockArmRs: 400,
    profitLockLockRs: 220,
    profitLockGivebackRs: 180,
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
    /** Anti-churn (enforced in worker). */
    cooldownMin: 20,
    maxTradesDay: 2,
    dayLossStopRs: 500,
  },

  research: {
    approach:
      'After-NSE OR breakout with confirmation, wider 40pt SL, 2R target, max 2 trades/day, cooldown, daily loss stop. Slower & selective to survive Crude noise + option spread.',
    note:
      'Redesigned after v4 churned 18 losing round-trips live (SL20 too tight, confirm off, unlimited). Validate in PAPER — no all-green guarantee.',
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
      'Professional · after NSE · OR35–65 · 16:00–21:00 · SL40/TP80 · confirm ON · trail ₹400→₹220 · max 2/day',
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
