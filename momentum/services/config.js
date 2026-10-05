'use strict';

const { DEFAULT_RISK_SETTINGS, STRATEGY_PRESETS, resolveParams, applyRiskSettings, paramsHash, paramsFromPreset } = require('../config/defaults');
const { normalizeCosts } = require('../execution/costs');

const DEFAULT_SETTINGS = {
  strategyId: 'momentum-weekly',
  costs: { model: 'zerodha_delivery', extraBps: 0 },
  slippageBps: 5,
  paper: { fillWhenClosed: true, partialFillPct: 1 },
  live: { enabled: false, allowAmo: true, enabledAt: null },
};

function mergeSettings(saved) {
  const s = saved || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    costs: { ...DEFAULT_SETTINGS.costs, ...(s.costs || {}) },
    paper: { ...DEFAULT_SETTINGS.paper, ...(s.paper || {}) },
    live: { ...DEFAULT_SETTINGS.live, ...(s.live || {}) },
  };
}

/** Old factory risk (5 names × 22%) — rewrite to the 2–3 name payday book. */
function isLegacyFactoryRisk(saved) {
  if (!saved) return false;
  return Number(saved.maxPositions) === 5 && Number(saved.maxPositionPct) === 0.22;
}

function mergeRisk(saved) {
  const merged = { ...DEFAULT_RISK_SETTINGS, ...(saved || {}) };
  if (isLegacyFactoryRisk(saved)) {
    merged.maxPositions = DEFAULT_RISK_SETTINGS.maxPositions;
    merged.maxPositionPct = DEFAULT_RISK_SETTINGS.maxPositionPct;
    merged.maxSectorPct = DEFAULT_RISK_SETTINGS.maxSectorPct;
    merged.riskPerTradePct = DEFAULT_RISK_SETTINGS.riskPerTradePct;
    merged.maxDrawdownHaltPct = DEFAULT_RISK_SETTINGS.maxDrawdownHaltPct;
  }
  return merged;
}

/** Seed / refresh the built-in presets for a user (idempotent). Custom strategies are left alone. */
function ensureStrategies(store, userId) {
  const existing = new Map(store.listStrategies(userId).map((s) => [s.id, s]));
  for (const p of STRATEGY_PRESETS) {
    const params = paramsFromPreset(p.id);
    const hash = paramsHash(params);
    const cur = existing.get(p.id);
    if (cur && !cur.preset) continue;
    if (cur && cur.preset && cur.paramsHash === hash) continue;
    store.saveStrategy(userId, { id: p.id, name: p.name, description: p.description, params, paramsHash: hash, preset: true });
  }
}

/** Everything the engine and order pipeline need for one user, resolved. */
function resolveUserConfig(store, userId) {
  ensureStrategies(store, userId);
  const settings = mergeSettings(store.getSettings(userId));
  const risk = mergeRisk(store.getRisk(userId));
  const strategy = store.getStrategy(userId, settings.strategyId) || store.getStrategy(userId, DEFAULT_SETTINGS.strategyId);
  const base = resolveParams(strategy.params);
  const params = applyRiskSettings(base, risk);
  return {
    settings,
    risk,
    strategy: { id: strategy.id, name: strategy.name, description: strategy.description || null },
    params,
    costs: normalizeCosts(settings.costs),
    slippageBps: settings.slippageBps,
  };
}

module.exports = { DEFAULT_SETTINGS, mergeSettings, mergeRisk, ensureStrategies, resolveUserConfig };
