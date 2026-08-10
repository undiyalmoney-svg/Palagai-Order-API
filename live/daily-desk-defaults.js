/**
 * Daily desk DNA — must match Trade Desk Local Live (palagai.app) + Autobot.
 * Point thresholds use the 1-lot ₹ band; money at stop ≈ band × lots (do not multiply points by lots).
 *
 * Trap: pierce20 · Bank40 · peak₹100 · max3 · 3.5R · dayStop 60 · option −₹350 stand-down.
 * Index only by default (Crude OFF — fee protection).
 */

const APP_VERSION = '1.3.108';
const APP_BUILD = '2026.08.10-desk-parity-option350';

/** Base ₹ bands at 1 lot (combined index books). */
const DAY_PROFIT_LOCK_RS = 3000;
const STRICT_DAY_STOP_RS = 2950;

/**
 * Combined index option-₹ day stand-down (1-lot). Uses real option OHLC P&L
 * from two-pass replay — not index-point proxy. Scale × lots.
 */
const OPTION_DAY_LOSS_RS = 350;

/** ₹ per index point (same as Trade Desk). */
const NIFTY_RS_PER_POINT = 65;
const BANK_RS_PER_POINT = 30;
const CRUDE_RS_PER_POINT = 10;

/** Trap DNA day-stop in index points (not lot-multiplied). */
const TRAP_DAY_STOP_PTS = 60;

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
  crudeStrategy: 'selective',
  dayProfitLock: true,
  /** On for hands-off — capital must not drain (Trade Desk parity). */
  strictDayStop: true,
  researchNote:
    '₹40k · Trap pierce20/B40 · peak₹100 · max3 · 3.5R · dayStop 60 · option −₹350 stand-down',
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

function optionDayLossMoneyRs(lots) {
  return OPTION_DAY_LOSS_RS * Math.max(1, Math.floor(Number(lots)) || 1);
}

/**
 * True when combined option-₹ day net (real premium P&L) is at/under the
 * −₹350 × lots stand-down floor. netRs is signed (losses negative).
 */
function isOptionDayLossBreached(netRs, lots = 1) {
  const n = Number(netRs);
  if (!Number.isFinite(n)) return false;
  return n <= -optionDayLossMoneyRs(lots);
}

/**
 * Index point overrides for Trap day risk — mirrors Trade Desk.
 * dayStopPts fixed at Trap DNA 60; profit-lock points share 50/50 when both books on.
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
    out.dayStopPts = TRAP_DAY_STOP_PTS;
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
  parts.push(`option stop −₹${optionDayLossMoneyRs(lots).toLocaleString('en-IN')}`);
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
    crudeStrategy: config.crudeStrategy === 'all-green' ? 'all-green' : 'selective',
    // Desk risk: profit lock ON unless client opts out; strict ON unless client opts out.
    dayProfitLock: config.dayProfitLock !== false,
    strictDayStop: config.strictDayStop !== false,
    enableKutty: !!config.enableKutty,
    kuttyAlone: !!config.kuttyAlone,
    realOrders: !!config.realOrders,
  };
}

module.exports = {
  APP_VERSION,
  APP_BUILD,
  DAY_PROFIT_LOCK_RS,
  STRICT_DAY_STOP_RS,
  OPTION_DAY_LOSS_RS,
  TRAP_DAY_STOP_PTS,
  NIFTY_RS_PER_POINT,
  BANK_RS_PER_POINT,
  DAILY_3K_PRESET,
  rsPerPointForInstrument,
  deskRiskLots,
  profitLockMoneyRs,
  strictStopMoneyRs,
  optionDayLossMoneyRs,
  isOptionDayLossBreached,
  indexDayRiskOverrides,
  riskStatusLabels,
  normalizeStartConfig,
};
