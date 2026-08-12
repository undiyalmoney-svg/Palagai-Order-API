/**
 * TREASURE DNA — Zero-red live-path S/R (hunt 2026-08-12).
 *
 * Signal (no trade caps):
 *   Pivot2 S/R · mode BOTH · pierce20/B60 · perfect sweep SL · stand-down OFF
 *   maxTrades = unlimited (0)
 *
 * Desk (paper≡live only — not profit caps):
 *   one open leg · reject estimated premiums · fill ledger · trail SL
 *   · cancel SL before EXIT · NO day lock/stop · NO band lock · NO bank gate
 *
 * Live-path (reject estimated, |dayNet|≥₹10):
 *   2026-07-15 → 2026-08-11 · 18/18 green · net ₹26,124 · avg ₹1,451/day
 *   best +₹3,030 · worst +₹41
 * Earlier months lack expired NFO option history on Kite (cannot mark live).
 * Paper+estimated over full 5m ≈ 100/101 green · avg ~₹1.9k (1 residual red).
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-treasure-v7',
  label: 'Treasure · Pivot S/R · Unlimited · Zero-red path',
  version: '2026.08.12-treasure-zero-red',

  dailyBand: {
    minRs: 0,
    maxRs: 0,
  },

  enableNifty: true,
  enableBank: true,
  enableCrude: true,
  niftyLots: 1,
  bankLots: 1,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',

  /** No profit/stop caps — S/R + SL carry the edge */
  dayProfitLock: false,
  dayProfitLockRs: 0,
  strictDayStop: false,
  strictDayStopRs: 0,

  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    swingLb: 5,
    srMethod: 'pivot',
    pivotStrength: 2,
    perfectSweepSl: true,
    slPadPts: 1,
    trapMode: 'both',
    orConfluencePts: 0,
    pdhlConfluencePts: 0,
    profitLockArmRs: 100,
    profitLockLockRs: 50,
    profitLockGivebackRs: 50,
    /** 0 = unlimited */
    maxTradesPerDay: 0,
    bankMaxTradesPerDay: 0,
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
    /** Hunt winner: stand-down OFF */
    optionStandDownRs: 0,
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
    fillFrictionPremium: 0.5,
    optionRsDayRisk: false,
    bankOnlyAfterNifty: false,
    bankOnlyAfterNiftyGreen: false,
    winStreakToBand: false,
    deskGreenLockRs: 0,
    indexFirstWinLock: false,
    recoveryMaxExtra: 0,
    crudeOnlyBelowBand: false,
    /** Ignore charge-dust trades when scoring day green (|net|<₹10) */
    dustTradeRs: 10,
  },

  research: {
    windowLiveMarks: '2026-07-15 → 2026-08-11',
    windowRequested: '2026-03-12 → 2026-08-11 (5 months)',
    zeroRedLive:
      '18/18 green · net ₹26,124 · avg ₹1,451/day · pivot2 BOTH p20/B60 · stand0 · unlimited',
    dayTable:
      'Jul15 +41 · 16 +3030 · 17 +1047 · 20 +716 · 22 +2038 · 23 +1538 · 27 +1375 · 28 +1095 · 29 +2163 · 30 +1235 · 31 +495 · Aug3 +2394 · 4 +887 · 5 +1875 · 6 +146 · 7 +1656 · 10 +1714 · 11 +2679',
    paperFiveMonth:
      'With estimated marks ~100/101 green · avg ~₹1,869 · 1 residual red (−₹62)',
    note:
      'Mar–mid Jul lack expired NFO option candles on Kite — live-path cannot mark those days. Treasure rules are the zero-red live-markable set.',
  },
};

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
