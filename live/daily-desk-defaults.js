/**
 * Daily desk DNA — Autobot multi-strategy Paper≡Live.
 *
 * 1) Nifty Trap (primary)
 * 2) Bank Trap — only AFTER Nifty traded that day (zero-red all-three rule)
 * 3) Crude LIVE_CRUDE_GREEN after NSE (second session)
 *
 * Capital: UI `capitalRs` / `capital` → lots (one-leg desk reuses the same
 * capital across books). Explicit niftyLots/bankLots/crudeLots still win.
 */

const APP_VERSION = '1.3.117';
const APP_BUILD = '2026.08.11-all3-daily';
const { LIVE_GREEN_DNA } = require('./dna-live-green');
const { LIVE_CRUDE_GREEN_DNA } = require('./dna-live-crude-green');

const AUTOBOT_ALLOW_CRUDE = true;
const AUTOBOT_ALLOW_BANK = true;

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

/** Research desk lock band (option ₹). */
const DAY_PROFIT_LOCK_RS = LIVE_GREEN_DNA.dayProfitLockRs || 2500;
const STRICT_DAY_STOP_RS = LIVE_GREEN_DNA.strictDayStopRs || 2950;

const NIFTY_RS_PER_POINT = 65;
const BANK_RS_PER_POINT = 30;
const CRUDE_RS_PER_POINT = 10;

/**
 * Map UI capital → lot counts.
 * One-leg desk: only one book open at a time, so the same capital rotates
 * Nifty → Bank → evening Crude. ₹12k+ ≈ 1 lot each; ₹75k+ ≈ 2 lots.
 */
function lotsFromCapitalRs(capitalRs) {
  const c = Math.max(0, Number(capitalRs) || 0);
  if (!(c > 0)) return null;
  if (c >= 75000) return { niftyLots: 2, bankLots: 2, crudeLots: 2 };
  return { niftyLots: 1, bankLots: 1, crudeLots: 1 };
}

const DAILY_3K_PRESET = {
  id: 'daily-all3',
  label: 'All3 · Nifty→Bank→Crude',
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
  crudeAfterIndexClose: true,
  paperLivePath: true,
  bankOnlyAfterNifty: true,
  researchNote:
    'Nifty first · Bank after Nifty · Crude after NSE · Paper≡Live · 0-red research path',
  dnaId: LIVE_GREEN_DNA.id,
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
  if (config?.bankOnlyAfterNifty !== false) {
    parts.push('Bank after Nifty');
  }
  if (config?.paperLivePath !== false) {
    parts.push('Paper≡Live');
  }
  return parts;
}

function normalizeStartConfig(config = {}) {
  const preset = DAILY_3K_PRESET;
  const capitalRaw = config.capitalRs != null ? config.capitalRs : config.capital;
  const fromCap = lotsFromCapitalRs(capitalRaw);

  const niftyLots =
    Math.max(1, Math.floor(Number(config.niftyLots)) || 0) ||
    fromCap?.niftyLots ||
    preset.niftyLots;
  const bankLots =
    Math.max(1, Math.floor(Number(config.bankLots)) || 0) ||
    fromCap?.bankLots ||
    preset.bankLots;
  const crudeLots =
    Math.max(1, Math.floor(Number(config.crudeLots)) || 0) ||
    fromCap?.crudeLots ||
    preset.crudeLots;

  return {
    enableNifty: true,
    enableBank: AUTOBOT_ALLOW_BANK,
    enableCrude: AUTOBOT_ALLOW_CRUDE,
    niftyLots,
    bankLots,
    crudeLots,
    capitalRs: capitalRaw != null && Number(capitalRaw) > 0 ? Number(capitalRaw) : null,
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
        : LIVE_GREEN_DNA.liveOps.fillFrictionPremium ?? 0.5,
    bankOnlyAfterNifty:
      config.bankOnlyAfterNifty != null
        ? !!config.bankOnlyAfterNifty
        : LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty !== false,
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
  lotsFromCapitalRs,
  rsPerPointForInstrument,
  deskRiskLots,
  profitLockMoneyRs,
  strictStopMoneyRs,
  indexDayRiskOverrides,
  riskStatusLabels,
  normalizeStartConfig,
};
