/**
 * Daily desk DNA — must match Trade Desk Local Live (palagai.app) + Autobot.
 *
 * Multi-strategy live desk (not Trap-only):
 *   1) Nifty Trap  — index session
 *   2) Bank Trap   — same session, one-leg shared capital
 *   3) Crude LIVE_CRUDE_GREEN — after NSE close only (second session)
 *
 * Paper ≡ Live: reject estimated premiums, one open leg, option-₹ day lock,
 * fill friction — so Paper stops painting greener fiction than the broker.
 */

const APP_VERSION = '1.3.116';
const APP_BUILD = '2026.08.11-paper-live-multi';
const { LIVE_GREEN_DNA } = require('./dna-live-green');
const { LIVE_CRUDE_GREEN_DNA } = require('./dna-live-crude-green');

/**
 * Autobot book gates — multi-strategy: index Trap + evening Crude.
 */
const AUTOBOT_ALLOW_CRUDE = true;
/** Bank ON with one-leg + option-₹ lock (live-path). */
const AUTOBOT_ALLOW_BANK = true;

/** Allowed crudeStrategy ids for Autobot / backtest normalize. */
const CRUDE_STRATEGY_IDS = new Set([
  'selective',
  'all-green',
  'live-crude-green',
  'trap-confirm',
  'daily-profit',
  'champion',
  'daily-income',
]);

function normalizeCrudeStrategy(raw) {
  const id = String(raw || '').trim();
  if (CRUDE_STRATEGY_IDS.has(id)) return id;
  return 'selective';
}

/** Base ₹ bands at 1 lot (combined index books). */
const DAY_PROFIT_LOCK_RS = 3000;
const STRICT_DAY_STOP_RS = 2950;

/** ₹ per index point (same as Trade Desk). */
const NIFTY_RS_PER_POINT = 65;
const BANK_RS_PER_POINT = 30;
const CRUDE_RS_PER_POINT = 10;

const DAILY_3K_PRESET = {
  id: 'daily-3k',
  label: 'Multi-strat · Paper≡Live',
  niftyLots: 1,
  bankLots: 1,
  crudeLots: 1,
  enableNifty: true,
  enableBank: true,
  enableCrude: true,
  enableNatGas: false,
  enableKutty: false,
  kuttyAlone: false,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',
  crudeStrategy: 'live-crude-green',
  dayProfitLock: true,
  strictDayStop: true,
  /** Crude only after NSE close — never during Nifty/Bank session. */
  crudeAfterIndexClose: true,
  /** Paper backtest always uses live-path gates. */
  paperLivePath: true,
  researchNote:
    'Nifty+Bank Trap one-leg · Crude after NSE · option-₹ lock · Paper≡Live',
  dnaId: 'live-green+crude-multi-v1',
};

function rsPerPointForInstrument(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  if (id.includes('natgas') || id.includes('naturalgas')) return 50;
  if (id.includes('crude')) return CRUDE_RS_PER_POINT;
  if (id.includes('bank')) return BANK_RS_PER_POINT;
  return NIFTY_RS_PER_POINT;
}

function deskRiskLots(config) {
  if (!config) return 1;
  if (config.enableBank && !config.enableNifty) {
    return Math.max(1, Math.floor(Number(config.bankLots)) || 1);
  }
  return Math.max(1, Math.floor(Number(config.niftyLots)) || 1);
}

function profitLockMoneyRs(lots) {
  return DAY_PROFIT_LOCK_RS * Math.max(1, Math.floor(Number(lots)) || 1);
}

function strictStopMoneyRs(lots) {
  return STRICT_DAY_STOP_RS * Math.max(1, Math.floor(Number(lots)) || 1);
}

/**
 * Day risk overrides for Trap.
 * Default = option-₹ lock/stop (live/paper parity). Pass useIndexPts:true for legacy.
 * Share 50/50 when both Nifty + Bank are on.
 */
function indexDayRiskOverrides({
  instrumentId,
  enableNifty,
  enableBank,
  dayProfitLock,
  strictDayStop,
  useIndexPts = false,
}) {
  if (!dayProfitLock && !strictDayStop) return null;
  const share = enableNifty && enableBank ? 0.5 : 1;
  if (!useIndexPts) {
    const out = {
      dayProfitLockPts: 0,
      dayStopPts: 0,
    };
    if (strictDayStop) {
      out.dayStopRs = Math.max(1, Math.round(STRICT_DAY_STOP_RS * share));
    }
    if (dayProfitLock) {
      out.dayProfitLockRs = Math.max(1, Math.round(DAY_PROFIT_LOCK_RS * share));
    }
    return out;
  }
  const rs = rsPerPointForInstrument(instrumentId);
  const out = {};
  if (strictDayStop) {
    out.dayStopPts = Math.max(1, Math.round((STRICT_DAY_STOP_RS * share) / rs));
  }
  if (dayProfitLock) {
    out.dayProfitLockPts = Math.max(1, Math.round((DAY_PROFIT_LOCK_RS * share) / rs));
  }
  return out;
}

function riskStatusLabels(config) {
  const lots = deskRiskLots(config);
  const parts = [];
  if (config?.strictDayStop) {
    parts.push(`strict −₹${strictStopMoneyRs(lots).toLocaleString('en-IN')}`);
  }
  if (config?.dayProfitLock) {
    parts.push(`profit lock +₹${profitLockMoneyRs(lots).toLocaleString('en-IN')} (option ₹)`);
  }
  if (config?.paperLivePath !== false) {
    parts.push('Paper≡Live');
  }
  return parts;
}

function normalizeStartConfig(config = {}) {
  const preset = DAILY_3K_PRESET;

  return {
    enableNifty: true,
    /** When allowed, keep Bank ON (ignore UI capital→lots off). */
    enableBank: AUTOBOT_ALLOW_BANK,
    /** Autobot: evening Crude ON when allowed (second strategy session). */
    enableCrude: AUTOBOT_ALLOW_CRUDE,
    niftyLots: Math.max(1, Math.floor(Number(config.niftyLots)) || preset.niftyLots),
    bankLots: Math.max(1, Math.floor(Number(config.bankLots)) || preset.bankLots),
    crudeLots: Math.max(1, Math.floor(Number(config.crudeLots)) || preset.crudeLots),
    bankStrategy: config.bankStrategy === 'genie' ? 'genie' : 'trap',
    niftyStrategy: 'trap',
    crudeStrategy: normalizeCrudeStrategy(config.crudeStrategy ?? preset.crudeStrategy),
    dayProfitLock: config.dayProfitLock !== false,
    strictDayStop: config.strictDayStop !== false,
    enableKutty: !!config.enableKutty,
    kuttyAlone: !!config.kuttyAlone,
    realOrders: !!config.realOrders,
    dnaId: config.dnaId || preset.dnaId,
    maxOpenLegs:
      config.maxOpenLegs != null
        ? Math.max(0, Math.floor(Number(config.maxOpenLegs)) || 0)
        : LIVE_GREEN_DNA.liveOps.maxOpenLegs,
    optionStandDownRs:
      config.optionStandDownRs != null
        ? Math.max(0, Number(config.optionStandDownRs) || 0)
        : LIVE_GREEN_DNA.liveOps.optionStandDownRs,
    crudeAfterIndexClose:
      config.crudeAfterIndexClose != null
        ? !!config.crudeAfterIndexClose
        : preset.crudeAfterIndexClose !== false,
    paperLivePath: config.paperLivePath !== false,
    fillFrictionPremium:
      config.fillFrictionPremium != null
        ? Math.max(0, Number(config.fillFrictionPremium) || 0)
        : 0.5,
  };
}

module.exports = {
  APP_VERSION,
  APP_BUILD,
  AUTOBOT_ALLOW_CRUDE,
  AUTOBOT_ALLOW_BANK,
  DAY_PROFIT_LOCK_RS,
  STRICT_DAY_STOP_RS,
  NIFTY_RS_PER_POINT,
  BANK_RS_PER_POINT,
  CRUDE_RS_PER_POINT,
  DAILY_3K_PRESET,
  LIVE_GREEN_DNA,
  LIVE_CRUDE_GREEN_DNA,
  CRUDE_STRATEGY_IDS,
  normalizeCrudeStrategy,
  rsPerPointForInstrument,
  deskRiskLots,
  profitLockMoneyRs,
  strictStopMoneyRs,
  indexDayRiskOverrides,
  riskStatusLabels,
  normalizeStartConfig,
};
