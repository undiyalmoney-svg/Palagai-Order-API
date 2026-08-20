/**
 * PROFESSIONAL INDEX DNA (v8) — risk-managed Nifty 50 options desk (Bank/Crude off).
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
 *   - Trade budget: OPPORTUNITY-DRIVEN — no per-day trade cap (0 = unlimited);
 *     the worker's 12-min cooldown + per-option ₹ loss cap + daily loss stops
 *     are the actual risk rails.
 *   - Daily risk: hard day loss stop + per-option max-loss cap (capital protection).
 *
 * NOT a guaranteed-green promise. Validate in paper before real money.
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-pro-v8',
  label: 'Professional · Pivot S/R reversal · risk-managed',
  version: '2026.08.13-charge-cover',

  /** Kept for legacy desk-policy math; band lock itself is off. */
  dailyBand: {
    minRs: 0,
    maxRs: 0,
  },

  enableNifty: true,
  enableBank: false,
  /** Crude OFF — Nifty 50 only desk. */
  enableCrude: false,
  niftyLots: 1,
  bankLots: 1,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',

  /** Professional daily risk envelope (per lot; split across Nifty+Bank). */
  dayProfitLock: true,
  dayProfitLockRs: 2500,
  strictDayStop: true,
  strictDayStopRs: 1500,

  /** No profit lock — let winners run (only loss stops + anti-churn caps apply). */
  dailyTargetRs: 0,

  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    swingLb: 5,
    srMethod: 'pivot',
    /** 5-bar fractal — productive S/R levels (index books actually trade). */
    pivotStrength: 2,
    perfectSweepSl: true,
    slPadPts: 2,
    /** Trade both bounce + break at S/R (restores index participation). */
    trapMode: 'both',
    /** No confirm-body gate — it filtered index to zero. */
    minConfirmBody: 0,
    bankMinConfirmBody: 0,
    /** Risk band: skip chop (too-tight) and gaps (too-wide). */
    minRiskPts: 5,
    maxRiskPts: 40,
    bankMinRiskPts: 10,
    bankMaxRiskPts: 120,
    orConfluencePts: 0,
    pdhlConfluencePts: 0,
    bankPdhlConfluencePts: 0,
    /** Trail only after ~4× typical F&O round-trip charges (was ₹150/₹80 scalp lock). */
    profitLockArmRs: 400,
    profitLockLockRs: 200,
    profitLockGivebackRs: 150,
    /** 0 = unlimited — desk trades whenever a confirmed setup fires (worker cooldown + daily loss stops still apply). */
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
    /** Per-option hard max loss ₹/lot — the protective SL is placed at the
     * tighter of (structural sweep) vs (entry − cap/qty). 0 = off. */
    maxOptionLossRs: 300,
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
    /** No profit lock — let winners run. Loss stops + trade caps still protect. */
    deskGreenLockRs: 0,
    indexFirstWinLock: false,
    recoveryMaxExtra: 0,
    crudeOnlyBelowBand: false,
    dustTradeRs: 10,
    /** 0 = unlimited Nifty+Bank tickets. Crude keeps its own max 4. */
    deskMaxTradesDay: 0,
    /** Anti-churn (enforced in worker): cooldown + loss stops. */
    cooldownMin: 12,
    bookDayLossStopRs: 500,
    deskDayLossStopRs: 900,
    /**
     * Protect-green (× lots): once the desk day peak reaches arm, stop new
     * entries if it gives back to floor — a green day stays green, no upside cap.
     * This is the "discipline" that keeps EOD green (data: stopping early only
     * cut profit; not giving back a green day is what matters).
     */
    deskGreenProtectArmRs: 500,
    deskGreenProtectFloorRs: 150,
    /** 0 = off. Charge-cover (not a hard premium cap) kills fat-ATM scalps. */
    maxBankEntryPremium: 0,
    maxNiftyEntryPremium: 0,
    /** Expected option ₹ must cover this many round-trip charge estimates. */
    chargeCoverMultiple: 4,
  },

  research: {
    approach:
      'Pivot-2 both-direction S/R (index) + confirmed OR breakout (crude). No profit lock — winners run. Max 3/book/day + cooldown + daily loss stop still cap risk/churn.',
    measuredJulAug:
      '2026-07-01→08-12 live-path, 1 lot, guarded, NO lock: all-3 20/20 green · avg ~₹1,166/day (Bank ₹19,995 · Crude ₹2,052 · Nifty ₹1,274). Locked variant averaged ~₹989/day.',
    note:
      'Charge-cover 13 Aug: trail ₹400/₹200, max 2 Nifty + 1 Bank, skip unless expected ₹ ≥ 4× charges. Backtest on a favorable window; live can differ (intra-bar fills). Validate in PAPER — does not guarantee every calendar day.',
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
