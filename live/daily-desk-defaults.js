/**
 * Daily desk config — Nifty 50 only (Bank & Crude hard-off, AUTOBOT_ALLOW_*).
 *
 * OWNERSHIP CONTRACT
 *   UI owns:   LOTS only (`lots` / `deskLots` / `niftyLots`, integer >= 1, cap 10;
 *              or `capitalRs`, which maps ~1 Nifty lot per Rs40k when lots are
 *              not sent explicitly).
 *   Code owns: trade counts, entry, exit, instrument selection, and every risk
 *              rail. These are read from the strategy DNA and CANNOT be changed
 *              by the Start payload - client values for them are ignored
 *              outright (see resolveTradeCounts / normalizeStartConfig).
 *
 * That split exists because the UI previously sent trade counts with a
 * hardcoded 0 ("unlimited") fallback, which silently overrode the strategy cap
 * and reproduced the Aug-10 churn loss (docs/owner-private/51).
 */

const APP_VERSION = '1.3.138';
const APP_BUILD = '2026.08.18-ui-lots';
const { LIVE_GREEN_DNA } = require('./dna-live-green');
const { LIVE_CRUDE_GREEN_DNA } = require('./dna-live-crude-green');

/** Nifty-only autobot — Bank & Crude are hard-off and never traded. */
const AUTOBOT_ALLOW_CRUDE = false;
const AUTOBOT_ALLOW_BANK = false;

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
const DAY_PROFIT_LOCK_RS = LIVE_GREEN_DNA.dayProfitLockRs || 1000;
const DESK_GREEN_PROTECT_RS =
  LIVE_GREEN_DNA.liveOps.deskGreenProtectRs != null
    ? Number(LIVE_GREEN_DNA.liveOps.deskGreenProtectRs) || 0
    : 0;
const STRICT_DAY_STOP_RS =
  LIVE_GREEN_DNA.strictDayStopRs != null ? Number(LIVE_GREEN_DNA.strictDayStopRs) : 0;

const NIFTY_RS_PER_POINT = 65;
const BANK_RS_PER_POINT = 30;
const CRUDE_RS_PER_POINT = 10;

/** Hard cap — one-leg desk; raise only with intentional risk review. */
const MAX_DESK_LOTS = 10;
/** UI lots are used as-is when provided; otherwise capital maps ~1 Nifty lot per ₹40k. */
const CAPITAL_RS_PER_LOT = 40000;
const BANK_BASE_LOTS = 1;

/**
 * Map UI capital → Nifty lots (Bank/Crude are disabled — values kept for API shape only).
 *   ₹40k  → 1 · ₹80k → 2 · ₹1.2L → 3 · ₹1.6L → 4 · ₹2L → 5 ...
 * Below ₹40k still the ₹40k band. Cap 10 lots.
 */
function bookLotsFromCapitalRs(capitalRs) {
  const c = Math.max(0, Number(capitalRs) || 0);
  if (!(c > 0)) return null;
  const niftyLots = Math.min(MAX_DESK_LOTS, Math.max(1, Math.floor(c / CAPITAL_RS_PER_LOT)));
  const bankLots = niftyLots;
  return { niftyLots, bankLots, crudeLots: niftyLots };
}

/** Nifty lot count only (desk is Nifty 50 only). */
function deskLotsFromCapitalRs(capitalRs) {
  const books = bookLotsFromCapitalRs(capitalRs);
  return books ? books.niftyLots : null;
}

function lotsFromCapitalRs(capitalRs) {
  return bookLotsFromCapitalRs(capitalRs);
}

const DAILY_3K_PRESET = {
  id: 'daily-index-core',
  label: 'Pivot S/R · lots from UI',
  capitalRs: LIVE_GREEN_DNA.defaultCapitalRs || 40000,
  niftyLots: 1,
  bankLots: 1,
  crudeLots: 1,
  enableNifty: true,
  enableBank: false,
  enableCrude: false,
  enableNatGas: false,
  enableKutty: false,
  kuttyAlone: false,
  niftyStrategy: LIVE_GREEN_DNA.niftyStrategy,
  bankStrategy: LIVE_GREEN_DNA.bankStrategy,
  crudeStrategy: 'live-crude-green',
  dayProfitLock: LIVE_GREEN_DNA.dayProfitLock !== false,
  strictDayStop: LIVE_GREEN_DNA.strictDayStop === true,
  crudeAfterIndexClose: true,
  paperLivePath: true,
  bankOnlyAfterNifty: false,
  /**
   * DISPLAY ONLY — mirrors the DNA so /live/defaults can show the desk's real
   * budget. The server no longer reads trade counts from the Start payload
   * (see resolveTradeCounts), so a client value cannot change them.
   */
  niftyMaxTradesDay: Math.max(0, Number(LIVE_GREEN_DNA.trap.maxTradesPerDay) || 0),
  bankMaxTradesDay: Math.max(0, Number(LIVE_GREEN_DNA.trap.bankMaxTradesPerDay) || 0),
  crudeMaxTradesDay: 0,
  deskMaxTradesDay: Math.max(0, Number(LIVE_GREEN_DNA.liveOps.deskMaxTradesDay) || 0),
  tradeCountsNote:
    'Decided by the server strategy DNA, not the UI. Shown for reference only; ' +
    'values sent on Start are ignored. The UI controls LOTS only.',
  researchNote:
    'Pivot S/R · Nifty 50 only · lots from UI (lots / niftyLots)',
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
  const nifty = Math.max(1, Math.floor(Number(config.niftyLots)) || 1);
  const bank = Math.max(1, Math.floor(Number(config.bankLots)) || 1);
  if (config.enableBank && !config.enableNifty) return bank;
  if (config.enableNifty && !config.enableBank) return nifty;
  return Math.max(nifty, bank);
}

function profitLockMoneyRs(lots) {
  return DAY_PROFIT_LOCK_RS * Math.max(1, Math.floor(Number(lots)) || 1);
}

function greenProtectMoneyRs(lots) {
  return DESK_GREEN_PROTECT_RS * Math.max(1, Math.floor(Number(lots)) || 1);
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
  // Full desk band on every book (do NOT split 50/50). A 50/50 split locked
  // each book at ₹500 and kept taking charge-eaten extras past the ₹1k target.
  void enableNifty;
  void enableBank;
  if (!useIndexPts) {
    const out = {
      dayProfitLockPts: 0,
      dayStopPts: 0,
    };
    if (strictDayStop) {
      out.dayStopRs = Math.max(1, Math.round(STRICT_DAY_STOP_RS));
    }
    if (dayProfitLock) {
      out.dayProfitLockRs = Math.max(1, Math.round(DAY_PROFIT_LOCK_RS));
    }
    return out;
  }
  const rs = rsPerPointForInstrument(instrumentId);
  const out = {};
  if (strictDayStop) {
    out.dayStopPts = Math.max(1, Math.round(STRICT_DAY_STOP_RS / rs));
  }
  if (dayProfitLock) {
    out.dayProfitLockPts = Math.max(1, Math.round(DAY_PROFIT_LOCK_RS / rs));
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
  const protect =
    config?.deskGreenProtectRs != null
      ? Number(config.deskGreenProtectRs)
      : DESK_GREEN_PROTECT_RS;
  if (LIVE_GREEN_DNA.liveOps.deskHaltAfterRed) {
    parts.push('halt after first (win or lose)');
  } else if (protect > 0 && protect <= 1) {
    parts.push('halt after first green');
  } else if (protect > 0) {
    parts.push(`protect +₹${(protect * lots).toLocaleString('en-IN')} (50%)`);
  }
  if (config?.enableBank) {
    if (config?.bankOnlyAfterNiftyGreen) {
      parts.push('Bank after Nifty green');
    } else if (config?.bankOnlyAfterNifty === true) {
      parts.push('Bank after Nifty (repair only)');
    } else {
      parts.push('Nifty+Bank same bar');
    }
  } else {
    parts.push('Nifty 50 only');
  }
  if (config?.paperLivePath !== false) {
    parts.push('Paper≡Live');
  }
  const maxT =
    config?.deskMaxTradesDay != null
      ? Math.max(0, Math.floor(Number(config.deskMaxTradesDay)) || 0)
      : LIVE_GREEN_DNA.liveOps.deskMaxTradesDay || 0;
  if (maxT > 0) parts.push(`max ${maxT} trades`);
  const cut = LIVE_GREEN_DNA.trap.sessionCutTime;
  const pe = LIVE_GREEN_DNA.trap.peSession;
  if (cut && pe && pe.enabled === true) {
    parts.push(`Friday till ${cut} then PE ${pe.entryTimeStart}–${pe.entryTimeEnd}`);
  } else if (cut) {
    parts.push(`flatten ${cut} · no afternoon PE`);
  }
  return parts;
}

/**
 * Trade counts are OWNED BY THE CODE, not the UI.
 *
 * Contract: the UI supplies LOTS only. Trade count, entry, exit and instrument
 * selection are decided here. Client-sent niftyMaxTradesDay / bankMaxTradesDay
 * / crudeMaxTradesDay / deskMaxTradesDay are deliberately IGNORED.
 *
 * Why this is not merely tidier: the UI shipped a hardcoded `0` fallback for
 * these fields, and 0 meant "unlimited" — so one failed /live/defaults fetch
 * silently re-armed the churn setting the Aug-10 RCA (doc 51) blamed for an
 * all-red day. Reading them at all is the bug class; the fix is to not read
 * them. Values come from the same DNA the strategy and backtests use.
 */
function resolveTradeCounts(_config = {}) {
  const trapCap = Math.max(0, Number(LIVE_GREEN_DNA.trap.maxTradesPerDay) || 0);
  return {
    niftyMaxTradesDay: trapCap,
    bankMaxTradesDay: Math.max(
      0,
      Number(LIVE_GREEN_DNA.trap.bankMaxTradesPerDay) || trapCap,
    ),
    crudeMaxTradesDay: Math.max(0, Number(LIVE_CRUDE_GREEN_DNA.signal.maxTradesDay) || 0),
    deskMaxTradesDay:
      LIVE_GREEN_DNA.liveOps.deskMaxTradesDay != null
        ? Math.max(0, Number(LIVE_GREEN_DNA.liveOps.deskMaxTradesDay) || 0)
        : trapCap,
  };
}

function parseLotCount(raw) {
  if (raw == null || raw === '') return null;
  if (!Number.isFinite(Number(raw))) return null;
  return Math.max(1, Math.floor(Number(raw)));
}

/**
 * Per-book lots.
 * 1) explicit niftyLots / bankLots / crudeLots from UI (any one set)
 * 2) else capitalRs/capital map
 * 3) else preset (₹40k → Nifty 1 · Bank 2 · Crude 1)
 */
function resolveBookLots(config = {}, preset = DAILY_3K_PRESET) {
  const cap = (n) => Math.min(MAX_DESK_LOTS, Math.max(1, n));
  const uiN = parseLotCount(config.niftyLots);
  const uiB = parseLotCount(config.bankLots);
  const uiC = parseLotCount(config.crudeLots);
  const uiDesk = parseLotCount(config.deskLots) || parseLotCount(config.lots);
  const capitalRaw = config.capitalRs != null ? config.capitalRs : config.capital;
  const fromCap = bookLotsFromCapitalRs(capitalRaw);
  if (uiN != null || uiB != null || uiC != null || uiDesk != null) {
    const niftyLots = cap(uiN || uiDesk || fromCap?.niftyLots || preset.niftyLots || 1);
    const bankLots = cap(uiB || uiDesk || fromCap?.bankLots || preset.bankLots || BANK_BASE_LOTS);
    const crudeLots = cap(uiC || 1);
    return { niftyLots, bankLots, crudeLots };
  }
  if (fromCap) {
    return {
      niftyLots: fromCap.niftyLots,
      bankLots: fromCap.bankLots,
      crudeLots: cap(fromCap.crudeLots || 1),
    };
  }
  return {
    niftyLots: cap(preset.niftyLots || 1),
    bankLots: cap(preset.bankLots || BANK_BASE_LOTS),
    crudeLots: cap(preset.crudeLots || 1),
  };
}

function resolveDeskLots(config = {}, preset = DAILY_3K_PRESET) {
  return resolveBookLots(config, preset).niftyLots;
}

function normalizeStartConfig(config = {}) {
  const preset = DAILY_3K_PRESET;
  const capitalRaw = config.capitalRs != null ? config.capitalRs : config.capital;
  const books = resolveBookLots(config, preset);
  const counts = resolveTradeCounts(config);
  const niftyLots = books.niftyLots;
  const bankLots = books.bankLots;
  const crudeLots = books.crudeLots;
  const deskLots = niftyLots;

  return {
    enableNifty: true,
    enableBank: AUTOBOT_ALLOW_BANK,
    enableCrude: AUTOBOT_ALLOW_CRUDE,
    deskLots,
    niftyLots,
    bankLots,
    crudeLots,
    capitalRs: capitalRaw != null && Number(capitalRaw) > 0 ? Number(capitalRaw) : null,
    bankStrategy: config.bankStrategy === 'genie' ? 'genie' : 'trap',
    niftyStrategy: LIVE_GREEN_DNA.niftyStrategy || 'trap-v2',
    /** Autobot always uses fee-capped LIVE_CRUDE_GREEN (ignore UI 'selective'/'all-green'). */
    crudeStrategy: AUTOBOT_ALLOW_CRUDE
      ? 'live-crude-green'
      : normalizeCrudeStrategy(config.crudeStrategy ?? preset.crudeStrategy),
    dayProfitLock: config.dayProfitLock !== false,
    strictDayStop:
      config.strictDayStop != null
        ? !!config.strictDayStop
        : LIVE_GREEN_DNA.strictDayStop === true,
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
    niftyMaxTradesDay: counts.niftyMaxTradesDay,
    bankMaxTradesDay: counts.bankMaxTradesDay,
    crudeMaxTradesDay: counts.crudeMaxTradesDay,
    deskMaxTradesDay: counts.deskMaxTradesDay,
    deskGreenProtectRs:
      config.deskGreenProtectRs != null
        ? Math.max(0, Number(config.deskGreenProtectRs) || 0)
        : LIVE_GREEN_DNA.liveOps.deskGreenProtectRs != null
          ? Number(LIVE_GREEN_DNA.liveOps.deskGreenProtectRs) || 0
          : 0,
    deskHaltAfterRed:
      config.deskHaltAfterRed != null
        ? !!config.deskHaltAfterRed
        : LIVE_GREEN_DNA.liveOps.deskHaltAfterRed === true,
  };
}

module.exports = {
  APP_VERSION,
  APP_BUILD,
  bookLotsFromCapitalRs,
  deskLotsFromCapitalRs,
  resolveBookLots,
  resolveDeskLots,
  resolveTradeCounts,
  MAX_DESK_LOTS,
  CAPITAL_RS_PER_LOT,
  AUTOBOT_ALLOW_CRUDE,
  AUTOBOT_ALLOW_BANK,
  DAY_PROFIT_LOCK_RS,
  DESK_GREEN_PROTECT_RS,
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
  greenProtectMoneyRs,
  strictStopMoneyRs,
  indexDayRiskOverrides,
  riskStatusLabels,
  normalizeStartConfig,
};
