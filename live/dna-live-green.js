/**
 * LIVE_GREEN DNA — both books fade the 09:50 bar. 2 legs. No afternoon PE.
 *
 * Nifty: fade 09:50 (low 40% → CE, high 40% → PE). Skip continuation
 * (CE after a rising open, PE on a breakout / strong bull / hammer).
 * Bank: sharper fade at 09:50 (low 20% → CE, high 20% → PE, else PE).
 * Stand ₹350 both. Lots from UI capital. Crude OFF. Fade-only — no later trap.
 */

const LIVE_GREEN_DNA = {
  id: 'live-green-1k-40k-v11',
  label: 'Live Green · 09:50 quality fade · N₹500 B₹400',
  version: '2026.08.16-fade-quality',

  enableNifty: true,
  enableBank: true,
  enableCrude: false,
  niftyLots: 1,
  bankLots: 2,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',
  defaultCapitalRs: 40000,

  dayProfitLock: true,
  dayProfitLockRs: 1000,
  strictDayStop: false,
  strictDayStopRs: 0,

  trap: {
    piercePts: 20,
    bankPiercePts: 60,
    swingLb: 5,
    srMethod: 'pivot',
    pivotStrength: 2,
    perfectSweepSl: true,
    slPadPts: 2,
    minRiskPts: 5,
    maxRiskPts: 40,
    bankMinRiskPts: 10,
    bankMaxRiskPts: 120,
    profitLockArmRs: 400,
    profitLockLockRs: 400,
    profitLockGivebackRs: 0,
    /** Nifty gross option ₹ ≈ ₹500 after charges. Bank banks earlier (Mon MFE ~₹462). */
    optionBankRs: 540,
    bankOptionBankRs: 400,
    /** Fade the first completed 5m after 09:45. Skip continuation bars. */
    fadeBarEntry: true,
    fadeBarTime: '09:50',
    fadeBarLo: 0.4,
    fadeBarHi: 0.6,
    bankFadeBarLo: 0.2,
    bankFadeBarHi: 0.8,
    /** Mid Bank bar defaults to PE (Mon 0.24 / Thu 0.59). */
    bankFadeBarMidDir: 'SELL',
    fadeBarMinStopPts: 12,
    /** Confirm-next late-fills and kills the 09:55 option bank. Quality filter only. */
    fadeConfirmNext: false,
    bankFadeConfirmNext: false,
    /** Don't buy CE after a rising 09:15–09:45. */
    fadeCeMaxPreNet: 20,
    bankFadeCeMaxPreNet: 80,
    /** Don't fade PE on a strong bull 09:50 or OR breakout. */
    fadePeMaxBody: 0.65,
    bankFadePeMaxBody: 0.7,
    fadePeMaxLowerWick: 0.85,
    fadeSkipBreakout: true,
    /** Off — last-week Tue CE is a climax low (breakdown) that banks. */
    fadeSkipBreakdown: false,
    /** Nifty 2 fills / day. Bank 1 fill / day. */
    maxTradesPerDay: 2,
    bankMaxTradesPerDay: 1,
    targetRMultiple: 3.5,
    confirmNextBar: true,
    minConfirmBody: 0,
    bankMinConfirmBody: 0,
    /** Same as Friday live — both directions, so 10:15/10:25 can fire. */
    trapMode: 'both',
    allowDirection: '',
    slConfirmCutoffEnabled: false,
    softRs: 0,
    entryTimeStart: '09:45',
    entryTimeEnd: '14:15',
    sessionCutTime: '14:15',
    exitTime: '15:15',
    peSession: {
      enabled: false,
      entryTimeStart: '14:15',
      entryFillStart: '14:15',
      entryTimeEnd: '14:45',
      allowDirection: 'SELL',
      maxTrades: 0,
      trapMode: 'both',
    },
  },

  liveOps: {
    maxOpenLegs: 2,
    optionStandDownRs: 350,
    rejectEstimatedPremium: true,
    cancelSlBeforeExit: true,
    fillLedger: true,
    trailProtectiveSl: true,
    fillFrictionPremium: 0.5,
    optionRsDayRisk: true,
    /** Both books enter on their own signal. Do not wait for Nifty. */
    bankOnlyAfterNifty: false,
    bankOnlyAfterNiftyGreen: false,
    deskMaxTradesDay: 3,
    deskHaltAfterRed: false,
    chargeCoverMultiple: 4,
    /** 0 = allow fat Bank ATM on the 09:50 fade (last week ₹428–₹693). */
    maxBankEntryPremium: 0,
    maxNiftyEntryPremium: 0,
    /** 0 = do not park Bank after a Nifty green. */
    deskGreenProtectRs: 0,
    peSessionIgnoresHalt: false,
    peSessionOnlyIfNotGreen: false,
  },

  research: {
    window: '2017-01-02 → 2026-08-14',
    friday:
      'Both 09:50 quality fades. Nifty CE banks ₹500 at 09:55. Bank CE banks ₹400 at 09:55.',
    peSlice: 'OFF — afternoon PE removed',
    note:
      'Skip continuation 09:50 bars. Last week still 10/10. Fade-only — no later trap.',
  },
};

function liveGreenTrapExtras(instrumentId) {
  const t = LIVE_GREEN_DNA.trap;
  const pe = t.peSession || {};
  const bank = /bank/i.test(String(instrumentId || ''));
  return {
    piercePts: t.piercePts,
    bankPiercePts: t.bankPiercePts,
    swingLb: t.swingLb || 5,
    srMethod: t.srMethod || 'pivot',
    pivotStrength: t.pivotStrength || 2,
    perfectSweepSl: t.perfectSweepSl !== false,
    slPadPts: t.slPadPts != null ? t.slPadPts : 2,
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
    minConfirmBody: bank
      ? t.bankMinConfirmBody != null
        ? t.bankMinConfirmBody
        : t.minConfirmBody || 0
      : t.minConfirmBody || 0,
    trapMode: t.trapMode === 'both' ? 'both' : 'trap',
    peTrapMode: pe.trapMode === 'trap' ? 'trap' : pe.trapMode === 'both' ? 'both' : '',
    allowDirection: t.allowDirection === 'BUY' || t.allowDirection === 'SELL' ? t.allowDirection : '',
    sessionCutTime: t.sessionCutTime || '',
    peEntryStart: !bank && pe.enabled === true ? pe.entryTimeStart || '' : '',
    peEntryEnd: !bank && pe.enabled === true ? pe.entryTimeEnd || '' : '',
    peAllowDirection:
      !bank && pe.enabled === true && (pe.allowDirection === 'BUY' || pe.allowDirection === 'SELL')
        ? pe.allowDirection
        : '',
    peMaxTrades: !bank && pe.enabled === true ? pe.maxTrades || 1 : 0,
    bounceOrPierceMult: 0,
    bounceOrPierceCap: 0,
    optionStandDownRs: LIVE_GREEN_DNA.liveOps.optionStandDownRs,
    optionBankRs: bank
      ? t.bankOptionBankRs != null
        ? t.bankOptionBankRs
        : t.optionBankRs || 0
      : t.optionBankRs || 0,
    fadeBarEntry: t.fadeBarEntry === true,
    fadeBarTime: t.fadeBarTime || '09:50',
    fadeBarLo: bank
      ? t.bankFadeBarLo != null
        ? t.bankFadeBarLo
        : 0.2
      : t.fadeBarLo != null
        ? t.fadeBarLo
        : 0.4,
    fadeBarHi: bank
      ? t.bankFadeBarHi != null
        ? t.bankFadeBarHi
        : 0.8
      : t.fadeBarHi != null
        ? t.fadeBarHi
        : 0.6,
    fadeBarMidDir: bank ? t.bankFadeBarMidDir || 'SELL' : '',
    fadeBarMinStopPts: t.fadeBarMinStopPts != null ? t.fadeBarMinStopPts : 12,
    fadeConfirmNext: bank ? t.bankFadeConfirmNext === true : t.fadeConfirmNext === true,
    fadeCeMaxPreNet: bank
      ? t.bankFadeCeMaxPreNet != null
        ? t.bankFadeCeMaxPreNet
        : 80
      : t.fadeCeMaxPreNet != null
        ? t.fadeCeMaxPreNet
        : 20,
    fadePeMaxBody: bank
      ? t.bankFadePeMaxBody != null
        ? t.bankFadePeMaxBody
        : 0.7
      : t.fadePeMaxBody != null
        ? t.fadePeMaxBody
        : 0.65,
    fadePeMaxLowerWick: t.fadePeMaxLowerWick != null ? t.fadePeMaxLowerWick : 0.85,
    fadeSkipBreakout: t.fadeSkipBreakout !== false,
    fadeSkipBreakdown: t.fadeSkipBreakdown === true,
    optionOnlyExit: t.fadeBarEntry === true,
  };
}

function liveGreenStartConfig() {
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
    maxOpenLegs: LIVE_GREEN_DNA.liveOps.maxOpenLegs,
    optionStandDownRs: LIVE_GREEN_DNA.liveOps.optionStandDownRs,
    paperLivePath: true,
    fillFrictionPremium: LIVE_GREEN_DNA.liveOps.fillFrictionPremium,
    crudeAfterIndexClose: true,
    bankOnlyAfterNifty: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty,
    bankOnlyAfterNiftyGreen: LIVE_GREEN_DNA.liveOps.bankOnlyAfterNiftyGreen,
    deskGreenProtectRs: LIVE_GREEN_DNA.liveOps.deskGreenProtectRs,
    deskHaltAfterRed: LIVE_GREEN_DNA.liveOps.deskHaltAfterRed === true,
    deskMaxTradesDay: LIVE_GREEN_DNA.liveOps.deskMaxTradesDay,
    peSessionOnlyIfNotGreen: LIVE_GREEN_DNA.liveOps.peSessionOnlyIfNotGreen === true,
    capitalRs: LIVE_GREEN_DNA.defaultCapitalRs,
  };
}

module.exports = {
  LIVE_GREEN_DNA,
  liveGreenTrapExtras,
  liveGreenStartConfig,
};
