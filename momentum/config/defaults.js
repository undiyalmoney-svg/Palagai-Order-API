'use strict';

const crypto = require('crypto');

/**
 * Strategy + risk parameters. Every tunable used by the decision engine lives
 * here, so the exact same object drives live signals, paper trading, backtests
 * and the optimiser.
 */

const HORIZONS = ['DAILY', 'WEEKLY', 'MONTHLY'];

/** Per-horizon behaviour: momentum look-back emphasis, review cadence, stops. */
const HORIZON_PRESETS = {
  DAILY: {
    momentumWeights: { ret1: 0.1, ret5: 0.3, ret21: 0.35, ret63: 0.25 },
    reviewEvery: 'DAILY',
    stopAtrMult: 2.0,
    trailAtrMult: 2.5,
    expectedHolding: 'days to ~2 weeks, held while the short-term thesis stays valid',
    holdingHint: 'Short-term momentum — every position is re-evaluated every trading day.',
  },
  WEEKLY: {
    momentumWeights: { ret5: 0.05, ret21: 0.2, ret63: 0.35, ret126: 0.3, ret231: 0.1 },
    reviewEvery: 'WEEKLY',
    stopAtrMult: 2.5,
    trailAtrMult: 3.0,
    expectedHolding: 'roughly 4-16 weeks, held while the thesis stays valid',
    holdingHint: 'Primary mode — rank weekly, rebalance when required, hold while the thesis is valid.',
  },
  MONTHLY: {
    momentumWeights: { ret63: 0.2, ret126: 0.35, ret231: 0.45 },
    reviewEvery: 'MONTHLY',
    stopAtrMult: 3.0,
    trailAtrMult: 4.0,
    expectedHolding: 'roughly 3-9 months, held while the long-term thesis stays valid',
    holdingHint: 'Longer-term momentum — monthly review, strategic allocation, low turnover.',
  },
};

const REGIME_POLICY = {
  BULLISH: {
    positionsMult: 1,
    minCashPct: 0.05,
    allowNewBuys: true,
    minEntryStatus: 'BUY',
    sizeMult: 1,
    scoreBonus: 0,
    trailMult: 1,
  },
  NEUTRAL: {
    positionsMult: 0.75,
    minCashPct: 0.15,
    allowNewBuys: true,
    minEntryStatus: 'BUY',
    sizeMult: 0.75,
    scoreBonus: 5,
    trailMult: 0.9,
  },
  HIGH_VOLATILITY: {
    positionsMult: 0.5,
    minCashPct: 0.3,
    allowNewBuys: true,
    minEntryStatus: 'STRONG_BUY',
    sizeMult: 0.5,
    scoreBonus: 8,
    trailMult: 0.8,
  },
  BEARISH: {
    positionsMult: 0.25,
    minCashPct: 0.5,
    allowNewBuys: true,
    minEntryStatus: 'BUY',
    sizeMult: 0.5,
    scoreBonus: 8,
    trailMult: 0.6,
  },
};

const BASE_PARAMS = {
  id: 'momentum-weekly',
  name: 'Momentum - Weekly (primary)',
  horizon: 'WEEKLY',

  emaPeriods: [20, 50, 100, 200],
  breakoutLookback: 20,

  weights: {
    momentum: 0.3,
    trend: 0.2,
    relativeStrength: 0.2,
    volume: 0.1,
    volatility: 0.05,
    technical: 0.15,
  },
  momentumWeights: null,

  minScore: 58,
  strongScore: 70,
  watchScore: 48,
  holdScore: 42,
  sellScore: 32,
  requireAboveLongEma: true,
  rsMin: 0,

  minHistoryBars: 126,
  minPrice: 15,
  minAdvRs: 5_000_000,

  volBreakoutMult: 1.3,
  maxExtensionAtr: 3.0,
  rsiMax: 78,
  minRewardRisk: 1.5,
  targetR: 3,
  stopAtrMult: null,
  minStopPct: 0.03,
  maxStopPct: 0.15,
  pullbackMaxRsi: 62,
  pullbackMinRsi: 35,
  breakoutFreshBars: 3,

  beAtR: 1.0,
  trailStartR: 1.5,
  trailAtrMult: null,
  trendBreakBars: 2,
  breakdownRelVol: 1.5,
  rsDeteriorationPct: -0.05,
  reduceFraction: 0.5,
  climaxExtensionAtr: 4.5,
  climaxRsi: 82,
  climaxTakeFraction: 1 / 3,
  sectorWeakPct: -0.03,

  maxPositions: 10,
  minPositionValue: 2_000,
  maxPositionPct: 0.2,
  maxSectorPct: 0.35,
  riskPerTradePct: 0.01,
  maxOpenRiskPct: 0.08,
  sizing: 'RISK_BASED',
  minCashPct: 0.05,
  maxAdvParticipation: 0.02,
  corrLimit: 0.85,
  corrLookback: 60,
  marginalDiversificationMin: 0.1,
  maxDrawdownHaltPct: 0.2,

  replaceMinScoreGain: 12,
  edgePerScorePointPct: 0.25,
  replaceCostMultiple: 2,
  concentrationTolerance: 0.25,
  addMinRoomPct: 0.02,
  minTicketValue: 200,

  scanEveryDay: false,
  regime: {
    bullishMin: 62,
    bearishMax: 38,
    highVolPercentile: 88,
    hysteresis: 3,
  },
  regimePolicy: REGIME_POLICY,
};

const RISK_KEYS = [
  'maxPositions',
  'minPositionValue',
  'maxPositionPct',
  'maxSectorPct',
  'riskPerTradePct',
  'maxOpenRiskPct',
  'minCashPct',
  'maxDrawdownHaltPct',
];

const DEFAULT_RISK_SETTINGS = {
  maxPositions: BASE_PARAMS.maxPositions,
  minPositionValue: BASE_PARAMS.minPositionValue,
  maxPositionPct: BASE_PARAMS.maxPositionPct,
  maxSectorPct: BASE_PARAMS.maxSectorPct,
  riskPerTradePct: BASE_PARAMS.riskPerTradePct,
  maxOpenRiskPct: BASE_PARAMS.maxOpenRiskPct,
  minCashPct: BASE_PARAMS.minCashPct,
  maxDrawdownHaltPct: BASE_PARAMS.maxDrawdownHaltPct,
  maxDailyLossPct: 0.03,
  maxOrderValue: 200_000,
  maxSignalAgeDays: 4,
  maxPriceDeviationPct: 0.04,
};

const STRATEGY_PRESETS = [
  {
    id: 'momentum-weekly',
    name: 'Momentum - Weekly (primary)',
    description: 'Weekly scan and rank, hold while the thesis is valid, protective stops checked daily.',
    overrides: { horizon: 'WEEKLY' },
  },
  {
    id: 'momentum-daily',
    name: 'Momentum - Daily (short-term)',
    description: 'Short-term momentum: entries and exits evaluated every day with tighter stops.',
    overrides: { horizon: 'DAILY', minScore: 62, maxPositions: 8 },
  },
  {
    id: 'momentum-monthly',
    name: 'Momentum - Monthly (long-term)',
    description: 'Longer-term momentum with monthly review, wide trailing stops and low turnover.',
    overrides: { horizon: 'MONTHLY', minScore: 58, maxPositions: 12 },
  },
  {
    id: 'momentum-conservative',
    name: 'Momentum - Conservative',
    description: 'Higher score bar, fewer positions, smaller risk per trade, tighter stops.',
    overrides: {
      horizon: 'WEEKLY',
      minScore: 68,
      strongScore: 78,
      maxPositions: 7,
      riskPerTradePct: 0.0075,
      stopAtrMult: 2.0,
      trailAtrMult: 2.5,
      maxPositionPct: 0.18,
    },
  },
  {
    id: 'momentum-aggressive',
    name: 'Momentum - Aggressive',
    description: 'Lower score bar, more positions, wider stops to ride trends longer.',
    overrides: {
      horizon: 'WEEKLY',
      minScore: 54,
      strongScore: 68,
      maxPositions: 12,
      riskPerTradePct: 0.0125,
      stopAtrMult: 3.0,
      trailAtrMult: 3.75,
      maxPositionPct: 0.22,
    },
  },
];

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

function num(v, fallback, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Merge overrides onto BASE_PARAMS + the horizon preset and validate ranges.
 * The result is fully explicit (no nulls) so it can be hashed and stored.
 */
function resolveParams(overrides = {}) {
  const horizon = HORIZONS.includes(String(overrides.horizon || '').toUpperCase())
    ? String(overrides.horizon).toUpperCase()
    : BASE_PARAMS.horizon;
  const preset = HORIZON_PRESETS[horizon];
  let p = deepMerge(BASE_PARAMS, { horizon });
  p = deepMerge(p, {
    stopAtrMult: preset.stopAtrMult,
    trailAtrMult: preset.trailAtrMult,
    momentumWeights: preset.momentumWeights,
  });
  const cleaned = { ...overrides };
  delete cleaned.horizon;
  p = deepMerge(p, cleaned);
  if (!isPlainObject(p.momentumWeights) || !Object.keys(p.momentumWeights).length) {
    p.momentumWeights = { ...preset.momentumWeights };
  }

  p.minScore = num(p.minScore, 58, 30, 95);
  p.strongScore = num(p.strongScore, 70, p.minScore, 99);
  p.watchScore = num(p.watchScore, 48, 10, p.minScore);
  p.holdScore = num(p.holdScore, 42, 5, p.minScore);
  p.sellScore = num(p.sellScore, 32, 0, p.holdScore);
  p.maxPositions = Math.round(num(p.maxPositions, 10, 1, 40));
  p.minPositionValue = num(p.minPositionValue, 2_000, 200, 10_000_000);
  p.maxPositionPct = num(p.maxPositionPct, 0.2, 0.03, 1);
  p.maxSectorPct = num(p.maxSectorPct, 0.35, 0.05, 1);
  p.riskPerTradePct = num(p.riskPerTradePct, 0.01, 0.001, 0.05);
  p.maxOpenRiskPct = num(p.maxOpenRiskPct, 0.08, 0.01, 0.4);
  p.minCashPct = num(p.minCashPct, 0.05, 0, 0.9);
  p.minTicketValue = num(p.minTicketValue, 200, 50, 1_000_000);
  p.stopAtrMult = num(p.stopAtrMult, preset.stopAtrMult, 0.5, 8);
  p.trailAtrMult = num(p.trailAtrMult, preset.trailAtrMult, 0.5, 10);
  p.volBreakoutMult = num(p.volBreakoutMult, 1.3, 0.5, 5);
  p.rsMin = num(p.rsMin, 0, -0.5, 0.5);
  p.maxDrawdownHaltPct = num(p.maxDrawdownHaltPct, 0.2, 0.03, 0.9);
  if (!['RISK_BASED', 'EQUAL_WEIGHT'].includes(p.sizing)) p.sizing = 'RISK_BASED';
  if (!Array.isArray(p.emaPeriods) || p.emaPeriods.length !== 4) p.emaPeriods = [...BASE_PARAMS.emaPeriods];
  p.emaPeriods = p.emaPeriods.map((x, i) => Math.round(num(x, BASE_PARAMS.emaPeriods[i], 2, 400)));
  for (let i = 1; i < 4; i += 1) {
    if (p.emaPeriods[i] <= p.emaPeriods[i - 1]) p.emaPeriods[i] = p.emaPeriods[i - 1] + 1;
  }
  p.breakoutLookback = Math.round(num(p.breakoutLookback, 20, 5, 120));
  return p;
}

/**
 * Apply overrides to an already-resolved params object. When the horizon
 * changes, the horizon-derived defaults (stops, trail, momentum weights) are
 * re-derived for the new horizon unless explicitly overridden.
 */
function withOverrides(base, overrides = {}) {
  const merged = { ...base };
  const ov = {};
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined && v !== null) ov[k] = v;
  const newHorizon = ov.horizon ? String(ov.horizon).toUpperCase() : base.horizon;
  if (newHorizon !== base.horizon) {
    for (const k of ['stopAtrMult', 'trailAtrMult', 'momentumWeights']) if (ov[k] === undefined) delete merged[k];
  }
  return resolveParams({ ...merged, ...ov });
}

function applyRiskSettings(params, risk) {
  if (!risk) return params;
  const out = { ...params };
  for (const k of RISK_KEYS) {
    if (risk[k] !== undefined && risk[k] !== null) out[k] = risk[k];
  }
  return resolveParams(out);
}

function stableStringify(obj) {
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  if (isPlainObject(obj)) {
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(obj);
}

function paramsHash(params) {
  return crypto.createHash('sha256').update(stableStringify(params)).digest('hex').slice(0, 16);
}

/** Key for caching indicators: only the params that change indicator values. */
function indicatorKey(params) {
  return `${params.emaPeriods.join('-')}|${params.breakoutLookback}`;
}

function presetById(id) {
  return STRATEGY_PRESETS.find((p) => p.id === id) || null;
}

function paramsFromPreset(id, extra = {}) {
  const preset = presetById(id) || STRATEGY_PRESETS[0];
  return resolveParams({ ...preset.overrides, id: preset.id, name: preset.name, ...extra });
}

/**
 * Weekly momentum on a small book (₹10k start) cannot use the large-cap
 * ticket floors: ₹10,000 min position + 5% cash reserve leaves nothing to
 * deploy. Scale the live limits from equity so 2–3 names of ₹2–4k each
 * can actually be bought, while a ₹1L+ book keeps the original caps.
 */
function scaleParamsForCapital(params, equity) {
  const p = { ...params };
  const cap = Number(equity);
  if (!Number.isFinite(cap) || cap <= 0) return p;
  if (cap <= 25_000) {
    p.minPositionValue = Math.min(p.minPositionValue, Math.max(500, Math.round(cap * 0.12)));
    p.minTicketValue = Math.min(p.minTicketValue || 200, 200);
    p.maxPositionPct = Math.max(p.maxPositionPct, 0.4);
    p.maxSectorPct = Math.max(p.maxSectorPct, 0.55);
    p.maxPositions = Math.min(p.maxPositions, 3);
    p.minCashPct = Math.min(p.minCashPct, 0.02);
    p.minAdvRs = Math.min(p.minAdvRs, 2_000_000);
    p.minPrice = Math.min(p.minPrice || 15, 10);
    p.maxOpenRiskPct = Math.max(p.maxOpenRiskPct, 0.12);
    p.replaceMinScoreGain = Math.max(p.replaceMinScoreGain || 12, 18);
  } else if (cap <= 75_000) {
    p.minPositionValue = Math.min(p.minPositionValue, 3_000);
    p.minTicketValue = Math.min(p.minTicketValue || 200, 500);
    p.maxPositionPct = Math.max(p.maxPositionPct, 0.28);
    p.maxPositions = Math.min(p.maxPositions, 5);
    p.minAdvRs = Math.min(p.minAdvRs, 5_000_000);
  }
  return p;
}

module.exports = {
  HORIZONS,
  HORIZON_PRESETS,
  REGIME_POLICY,
  BASE_PARAMS,
  RISK_KEYS,
  DEFAULT_RISK_SETTINGS,
  STRATEGY_PRESETS,
  resolveParams,
  applyRiskSettings,
  withOverrides,
  paramsHash,
  indicatorKey,
  stableStringify,
  presetById,
  paramsFromPreset,
  scaleParamsForCapital,
  deepMerge,
};
