/**
 * Treasure DNA — Pivot S/R · unlimited trades · zero-red live-path.
 * Capital: UI capitalRs → shared deskLots. Stop→Start to apply.
 */

const APP_VERSION = '1.4.1';
const APP_BUILD = '2026.08.13-charge-cover';
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

/** Desk lock band (0 = off for treasure DNA). */
const DAY_PROFIT_LOCK_RS =
  LIVE_GREEN_DNA.dayProfitLockRs != null ? LIVE_GREEN_DNA.dayProfitLockRs : 0;
const STRICT_DAY_STOP_RS =
  LIVE_GREEN_DNA.strictDayStopRs != null ? LIVE_GREEN_DNA.strictDayStopRs : 0;

const NIFTY_RS_PER_POINT = 65;
const BANK_RS_PER_POINT = 30;
const CRUDE_RS_PER_POINT = 10;

/** Hard cap — one-leg desk; raise only with intentional risk review. */
const MAX_DESK_LOTS = 10;

/**
 * Map UI capital → one shared desk lot size (Nifty = Bank = Crude).
 * Ladder (higher capital → higher lots):
 *   < ₹75k     → 1
 *   ₹75k–₹1.99L → 2
 *   ₹2L        → 2
 *   ₹3L        → 3
 *   …
 *   ₹6L        → 6
 *   ₹10L+      → 10 (cap)
 * Rule above ₹1L: floor(capital / ₹1L), minimum 2 once ≥ ₹75k.
 */
function deskLotsFromCapitalRs(capitalRs) {
  const c = Math.max(0, Number(capitalRs) || 0);
  if (!(c > 0)) return null;
  if (c < 75000) return 1;
  return Math.min(MAX_DESK_LOTS, Math.max(2, Math.floor(c / 100000)));
}

/** @deprecated use deskLotsFromCapitalRs — kept for callers expecting {nifty,bank,crude} */
function lotsFromCapitalRs(capitalRs) {
  const n = deskLotsFromCapitalRs(capitalRs);
  if (n == null) return null;
  return { niftyLots: n, bankLots: n, crudeLots: n };
}

const DAILY_3K_PRESET = {
  id: 'daily-index-core',
  label: 'Professional · Nifty+Bank core (Crude optional) · risk-managed',
  niftyLots: 1,
  bankLots: 1,
  crudeLots: 1,
  enableNifty: true,
  enableBank: true,
  /** Crude optional (off by default) — index N+B is the reliable engine. */
  enableCrude: false,
  enableNatGas: false,
  enableKutty: false,
  kuttyAlone: false,
  niftyStrategy: 'trap',
  bankStrategy: 'trap',
  crudeStrategy: 'live-crude-green',
  dayProfitLock: false,
  strictDayStop: false,
  crudeAfterIndexClose: true,
  paperLivePath: true,
  bankOnlyAfterNifty: false,
  researchNote:
    'Nifty+Bank core (17/17 green ~₹1,251/day). Crude optional — weakest book, only one with red days. Charges ~9% of gross (net figures). Lots auto from capital.',
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
  if (config?.bankOnlyAfterNifty) {
    parts.push('Bank after Nifty');
  }
  if (config?.paperLivePath !== false) {
    parts.push('Paper≡Live');
  }
  return parts;
}

function parseLotCount(raw) {
  if (raw == null || raw === '') return null;
  if (!Number.isFinite(Number(raw))) return null;
  return Math.max(1, Math.floor(Number(raw)));
}

/**
 * One desk lot for Nifty + Bank + Crude.
 * 1) capitalRs/capital wins (UI capital change must resize ALL books)
 * 2) else shared deskLots/lots/niftyLots/bankLots (first present)
 * 3) else preset
 * Crude never keeps a private crudeLots that differs from the desk.
 */
function resolveDeskLots(config = {}, preset = DAILY_3K_PRESET) {
  const capitalRaw = config.capitalRs != null ? config.capitalRs : config.capital;
  const fromCap = deskLotsFromCapitalRs(capitalRaw);
  if (fromCap != null) return fromCap;
  return (
    parseLotCount(config.deskLots) ||
    parseLotCount(config.lots) ||
    parseLotCount(config.niftyLots) ||
    parseLotCount(config.bankLots) ||
    parseLotCount(config.crudeLots) ||
    preset.niftyLots ||
    1
  );
}

function normalizeStartConfig(config = {}) {
  const preset = DAILY_3K_PRESET;
  const capitalRaw = config.capitalRs != null ? config.capitalRs : config.capital;
  const deskLots = resolveDeskLots(config, preset);
  const niftyLots = deskLots;
  const bankLots = deskLots;
  const crudeLots = deskLots;

  return {
    enableNifty: true,
    enableBank: AUTOBOT_ALLOW_BANK,
    /**
     * Crude OFF by default — data shows it is the weakest book (avg ~₹187/day)
     * and the only one with red days; index (Nifty+Bank) is 17/17 green at
     * ~₹1,251/day. Still fully toggleable from the UI (send enableCrude:true).
     */
    enableCrude:
      config.enableCrude != null ? !!config.enableCrude : false,
    deskLots,
    niftyLots,
    bankLots,
    crudeLots,
    capitalRs: capitalRaw != null && Number(capitalRaw) > 0 ? Number(capitalRaw) : null,
    bankStrategy: config.bankStrategy === 'genie' ? 'genie' : 'trap',
    niftyStrategy: 'trap',
    /** Autobot always uses fee-capped LIVE_CRUDE_GREEN (ignore UI 'selective'/'all-green'). */
    crudeStrategy: AUTOBOT_ALLOW_CRUDE
      ? 'live-crude-green'
      : normalizeCrudeStrategy(config.crudeStrategy ?? preset.crudeStrategy),
    dayProfitLock:
      config.dayProfitLock != null
        ? !!config.dayProfitLock
        : !!LIVE_GREEN_DNA.dayProfitLock,
    strictDayStop:
      config.strictDayStop != null
        ? !!config.strictDayStop
        : !!LIVE_GREEN_DNA.strictDayStop,
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
        : LIVE_GREEN_DNA.liveOps.bankOnlyAfterNifty === true,
    bankOnlyAfterNiftyGreen:
      config.bankOnlyAfterNiftyGreen != null
        ? !!config.bankOnlyAfterNiftyGreen
        : LIVE_GREEN_DNA.liveOps.bankOnlyAfterNiftyGreen === true,
    winStreakToBand:
      config.winStreakToBand != null
        ? !!config.winStreakToBand
        : LIVE_GREEN_DNA.liveOps.winStreakToBand === true,
    indexFirstWinLock:
      config.indexFirstWinLock != null
        ? !!config.indexFirstWinLock
        : LIVE_GREEN_DNA.liveOps.indexFirstWinLock === true,
    deskGreenLockRs:
      config.deskGreenLockRs != null
        ? Math.max(0, Number(config.deskGreenLockRs) || 0)
        : Number(LIVE_GREEN_DNA.liveOps.deskGreenLockRs) || 0,
    recoveryMaxExtra:
      config.recoveryMaxExtra != null
        ? Math.max(0, Math.floor(Number(config.recoveryMaxExtra) || 0))
        : LIVE_GREEN_DNA.liveOps.recoveryMaxExtra ?? 0,
    crudeOnlyBelowBand:
      config.crudeOnlyBelowBand != null
        ? !!config.crudeOnlyBelowBand
        : LIVE_GREEN_DNA.liveOps.crudeOnlyBelowBand === true,
  };
}

module.exports = {
  APP_VERSION,
  APP_BUILD,
  deskLotsFromCapitalRs,
  resolveDeskLots,
  MAX_DESK_LOTS,
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
