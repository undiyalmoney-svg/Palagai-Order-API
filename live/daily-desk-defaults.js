/**
 * Daily desk DNA — must match Trade Desk Local Live (palagai.app) + Autobot.
 * Point thresholds use the 1-lot ₹ band; money at stop ≈ band × lots (do not multiply points by lots).
 *
 * Trap: pierce20 · Bank40 · peak₹100 · max3 · 3.5R · lock ₹3k · strict stop on.
 * Index only by default (Crude OFF — fee protection).
 */

const APP_VERSION = '1.3.109';
const APP_BUILD = '2026.08.10-live-crude-995';
const { LIVE_GREEN_DNA } = require('./dna-live-green');
const { LIVE_CRUDE_GREEN_DNA } = require('./dna-live-crude-green');

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
  label: 'Option ₹ · ₹40k',
  niftyLots: 1,
  bankLots: 1,
  crudeLots: 1,
  enableNifty: true,
  enableBank: true,
  /** Off by default — fee protection (same as Auto Trader UI). */
  enableCrude: false,
  enableNatGas: false,
  enableKutty: false,
  kuttyAlone: false,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',
  /** Prefer fee-capped LIVE_CRUDE_GREEN when Crude is enabled. */
  crudeStrategy: 'live-crude-green',
  dayProfitLock: true,
  /** On for hands-off — capital must not drain (Trade Desk parity). */
  strictDayStop: true,
  /**
   * LIVE_CRUDE_GREEN v2 trades 10:00–14:00 — do not gate to 15:30 or it never
   * fires with index on. Capital sharing is maxOpenLegs: 1.
   */
  crudeAfterIndexClose: false,
  researchNote:
    'LIVE_GREEN index + LIVE_CRUDE_GREEN v2 (OR35–55 · 10:00–14:00 · SL25/TP80 · engine 18/18 green) · one-leg',
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

/**
 * Index point overrides for Trap day risk — mirrors Trade Desk.
 * Share 50/50 when both Nifty + Bank are on. Points are NOT lot-multiplied.
 */
function indexDayRiskOverrides({
  instrumentId,
  enableNifty,
  enableBank,
  dayProfitLock,
  strictDayStop,
}) {
  if (!dayProfitLock && !strictDayStop) return null;
  const share = enableNifty && enableBank ? 0.5 : 1;
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
    parts.push(`profit lock +₹${profitLockMoneyRs(lots).toLocaleString('en-IN')}`);
  }
  return parts;
}

function normalizeStartConfig(config = {}) {
  const preset = DAILY_3K_PRESET;
  const hasBookFlag =
    config.enableNifty != null ||
    config.enableBank != null ||
    config.enableCrude != null;

  return {
    enableNifty: hasBookFlag ? !!config.enableNifty : preset.enableNifty,
    enableBank: hasBookFlag ? !!config.enableBank : preset.enableBank,
    enableCrude: hasBookFlag ? !!config.enableCrude : preset.enableCrude,
    niftyLots: Math.max(1, Math.floor(Number(config.niftyLots)) || preset.niftyLots),
    bankLots: Math.max(1, Math.floor(Number(config.bankLots)) || preset.bankLots),
    crudeLots: Math.max(1, Math.floor(Number(config.crudeLots)) || preset.crudeLots),
    // Daily path: Trap only (Genie only if client explicitly asks).
    bankStrategy: config.bankStrategy === 'genie' ? 'genie' : 'trap',
    niftyStrategy: 'trap',
    crudeStrategy: normalizeCrudeStrategy(config.crudeStrategy ?? preset.crudeStrategy),
    // Desk risk: profit lock ON unless client opts out; strict ON unless client opts out.
    dayProfitLock: config.dayProfitLock !== false,
    strictDayStop: config.strictDayStop !== false,
    enableKutty: !!config.enableKutty,
    kuttyAlone: !!config.kuttyAlone,
    realOrders: !!config.realOrders,
    dnaId: config.dnaId || LIVE_GREEN_DNA.id,
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
  };
}

module.exports = {
  APP_VERSION,
  APP_BUILD,
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
