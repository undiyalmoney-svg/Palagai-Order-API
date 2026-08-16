/**
 * PROFESSIONAL INDEX DNA (v8) — pivot S/R. Same entry as Friday live.
 * Lots come from UI capital (₹40k → Nifty 1 / Bank 2). Fade-bar is OFF.
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-pro-v8',
  label: 'Professional · Pivot S/R reversal · risk-managed',
  version: '2026.08.16-pivot-sr-lots',

  dailyBand: {
    minRs: 0,
    maxRs: 0,
  },

  enableNifty: true,
  enableBank: true,
  enableCrude: false,
  niftyLots: 1,
  bankLots: 2,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',
  defaultCapitalRs: 40000,

  dayProfitLock: true,
  dayProfitLockRs: 2500,
  strictDayStop: true,
  strictDayStopRs: 1500,

  dailyTargetRs: 0,

  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    swingLb: 5,
    srMethod: 'pivot',
    pivotStrength: 2,
    perfectSweepSl: true,
    slPadPts: 2,
    trapMode: 'both',
    minConfirmBody: 0,
    bankMinConfirmBody: 0,
    minRiskPts: 5,
    maxRiskPts: 40,
    bankMinRiskPts: 10,
    bankMaxRiskPts: 120,
    orConfluencePts: 0,
    pdhlConfluencePts: 0,
    bankPdhlConfluencePts: 0,
    profitLockArmRs: 400,
    profitLockLockRs: 200,
    profitLockGivebackRs: 150,
    maxTradesPerDay: 2,
    bankMaxTradesPerDay: 1,
    targetRMultiple: 3.5,
    confirmNextBar: true,
    slConfirmCutoffEnabled: false,
    softRs: 0,
    entryTimeStart: '09:45',
    entryTimeEnd: '14:45',
    exitTime: '15:15',
    /** Fade-bar OFF — Friday pivot S/R only. */
    fadeBarEntry: false,
    sessionCutTime: '',
    peSession: { enabled: false, maxTrades: 0 },
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
    cooldownMin: 12,
    bookDayLossStopRs: 500,
    deskDayLossStopRs: 900,
    deskGreenProtectArmRs: 500,
    deskGreenProtectFloorRs: 150,
    maxBankEntryPremium: 0,
    maxNiftyEntryPremium: 0,
    chargeCoverMultiple: 4,
    deskMaxTradesDay: 3,
    deskHaltAfterRed: false,
    deskGreenProtectRs: 0,
  },

  research: {
    approach:
      'Pivot-2 both-direction S/R. Friday live book. Lots from UI capital. Fade-bar off.',
    note:
      'Same entry as Fri 14 Aug ₹663 (1 lot). New lot map only. Live fills can differ from paper.',
  },
};

function liveGreenTrapExtras(instrumentIdOrOverrides = {}) {
  const t = LIVE_GREEN_DNA.trap;
  const bank =
    typeof instrumentIdOrOverrides === 'string'
      ? /bank/i.test(instrumentIdOrOverrides)
      : false;
  const overrides =
    instrumentIdOrOverrides && typeof instrumentIdOrOverrides === 'object'
      ? instrumentIdOrOverrides
      : {};
  return {
    piercePts: t.piercePts,
    bankPiercePts: t.bankPiercePts,
    swingLb: t.swingLb || 5,
    srMethod: t.srMethod || 'pivot',
    pivotStrength: t.pivotStrength || 2,
    perfectSweepSl: t.perfectSweepSl !== false,
    slPadPts: t.slPadPts != null ? t.slPadPts : 2,
    minConfirmBody: bank
      ? t.bankMinConfirmBody != null
        ? t.bankMinConfirmBody
        : t.minConfirmBody || 0
      : t.minConfirmBody || 0,
    minRiskPts: bank
      ? t.bankMinRiskPts != null
        ? t.bankMinRiskPts
        : t.minRiskPts
      : t.minRiskPts,
    maxRiskPts: bank
      ? t.bankMaxRiskPts != null
        ? t.bankMaxRiskPts
        : t.maxRiskPts
      : t.maxRiskPts,
    profitLockArmRs: t.profitLockArmRs,
    profitLockLockRs: t.profitLockLockRs,
    profitLockGivebackRs: t.profitLockGivebackRs,
    slConfirmCutoffEnabled: t.slConfirmCutoffEnabled,
    slConfirmSoftRs: t.softRs,
    trapMode: t.trapMode || 'trap',
    orConfluencePts: t.orConfluencePts || 0,
    pdhlConfluencePts: bank
      ? t.bankPdhlConfluencePts || 0
      : t.pdhlConfluencePts || 0,
    bounceOrPierceMult: 0,
    bounceOrPierceCap: 0,
    optionStandDownRs: LIVE_GREEN_DNA.liveOps.optionStandDownRs,
    fadeBarEntry: false,
    sessionCutTime: '',
    optionBankRs: 0,
    optionOnlyExit: false,
    ...overrides,
  };
}

function liveGreenBankTrapExtras(overrides = {}) {
  return { ...liveGreenTrapExtras('bank-nifty'), ...overrides };
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
    capitalRs: LIVE_GREEN_DNA.defaultCapitalRs,
    deskMaxTradesDay: ops.deskMaxTradesDay,
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenBankTrapExtras,
  liveGreenRecoveryTrailExtras,
  liveGreenStartConfig,
};
