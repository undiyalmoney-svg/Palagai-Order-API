/**
 * PROFESSIONAL INDEX DNA (v8) — risk-managed Nifty + Bank options desk.
 *
 * Philosophy (why this beats the old "unlimited zero-red" fiction):
 *   - Live re-runs every 60s and the real exchange SL fills intra-bar. The old
 *     unlimited/confirm-off DNA churned 26 round-trips/day, bleeding spread +
 *     charges. A professional book trades FEW, HIGH-CONVICTION setups and holds
 *     for a real R-multiple so the spread is a small fraction of the move.
 *
 * Rules:
 *   - Entry: confirmed pivot S/R (strength 3) reversal, with a real confirm
 *     candle body, preferring prior-day H/L structural levels. Mode = trap
 *     (fade extremes) — no chasing both directions on every bar.
 *   - Risk: structural sweep SL padded, clamped to a min/max risk band so we
 *     skip chop (too-tight) and gaps (too-wide). Target 2.5R, lock to
 *     breakeven+ after the move arms.
 *   - Trade budget: max 3 quality trades/book/day + cooldown (worker guard).
 *   - Daily risk: hard day loss stop + day profit lock (capital protection).
 *
 * NOT a guaranteed-green promise. Validate in paper before real money.
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-pro-v8',
  label: 'Professional · Pivot S/R reversal · risk-managed',
  version: '2026.08.12-professional',

  /** Kept for legacy desk-policy math; band lock itself is off. */
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

  /** Professional daily risk envelope (per lot; split across Nifty+Bank). */
  dayProfitLock: true,
  dayProfitLockRs: 2500,
  strictDayStop: true,
  strictDayStopRs: 1500,

  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    swingLb: 5,
    srMethod: 'pivot',
    /** Cleaner, rarer levels (7-bar fractal) → fewer, better setups. */
    pivotStrength: 3,
    perfectSweepSl: true,
    slPadPts: 2,
    /** Reversal at structural S/R only — no both-direction chasing. */
    trapMode: 'trap',
    /** Require a real confirmation candle body (points) before entry. */
    minConfirmBody: 8,
    bankMinConfirmBody: 20,
    /** Skip chop (too-tight SL) and gaps (too-wide SL). */
    minRiskPts: 10,
    maxRiskPts: 45,
    bankMinRiskPts: 25,
    bankMaxRiskPts: 120,
    orConfluencePts: 0,
    /** Prefer prior-day High/Low as structural S/R (strong levels). */
    pdhlConfluencePts: 30,
    bankPdhlConfluencePts: 80,
    /** Arm a protective lock after a real move, give back little. */
    profitLockArmRs: 900,
    profitLockLockRs: 500,
    profitLockGivebackRs: 300,
    /** Quality over quantity — capped, cooldown enforced in worker. */
    maxTradesPerDay: 3,
    bankMaxTradesPerDay: 3,
    targetRMultiple: 2.5,
    confirmNextBar: true,
    slConfirmCutoffEnabled: false,
    softRs: 0,
    entryTimeStart: '09:45',
    entryTimeEnd: '14:30',
    exitTime: '15:15',
  },

  liveOps: {
    maxOpenLegs: 1,
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
    dustTradeRs: 10,
    /** Anti-churn (enforced in worker): cooldown + trade caps + loss stops. */
    cooldownMin: 12,
    bookDayLossStopRs: 500,
    deskDayLossStopRs: 900,
  },

  research: {
    approach:
      'Professional risk-managed reversal at confirmed pivot S/R. Few high-conviction trades, 2.5R targets, breakeven trail, max 3/book/day, cooldown, daily loss stop + profit lock.',
    note:
      'Redesigned after live churn losses (26 round-trips/day bled spread). Backtest ≠ live for high-frequency options; this trades slower on purpose. Validate in PAPER before real money — no all-green guarantee.',
  },
};

function liveGreenTrapExtras(overrides = {}) {
  const t = LIVE_GREEN_DNA.trap;
  return {
    piercePts: t.piercePts,
    bankPiercePts: t.bankPiercePts,
    swingLb: t.swingLb || 5,
    srMethod: t.srMethod || 'pivot',
    pivotStrength: t.pivotStrength || 3,
    perfectSweepSl: t.perfectSweepSl !== false,
    slPadPts: t.slPadPts != null ? t.slPadPts : 2,
    minConfirmBody: t.minConfirmBody != null ? t.minConfirmBody : 0,
    minRiskPts: t.minRiskPts != null ? t.minRiskPts : 4,
    maxRiskPts: t.maxRiskPts != null ? t.maxRiskPts : 28,
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

/** Bank uses wider risk/confirm bands (bigger point moves). */
function liveGreenBankTrapExtras(overrides = {}) {
  const t = LIVE_GREEN_DNA.trap;
  return liveGreenTrapExtras({
    minConfirmBody: t.bankMinConfirmBody != null ? t.bankMinConfirmBody : t.minConfirmBody,
    minRiskPts: t.bankMinRiskPts != null ? t.bankMinRiskPts : t.minRiskPts,
    maxRiskPts: t.bankMaxRiskPts != null ? t.bankMaxRiskPts : t.maxRiskPts,
    pdhlConfluencePts: t.bankPdhlConfluencePts != null ? t.bankPdhlConfluencePts : t.pdhlConfluencePts,
    ...overrides,
  });
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
  liveGreenBankTrapExtras,
  liveGreenRecoveryTrailExtras,
  liveGreenStartConfig,
};
