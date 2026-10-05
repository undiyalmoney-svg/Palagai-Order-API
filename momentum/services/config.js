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

function mergeRisk(saved) {
  return { ...DEFAULT_RISK_SETTINGS, ...(saved || {}) };
}

/** Seed the built-in presets for a user (idempotent). */
function ensureStrategies(store, userId) {
  const existing = new Set(store.listStrategies(userId).map((s) => s.id));
  for (const p of STRATEGY_PRESETS) {
    if (existing.has(p.id)) continue;
    const params = paramsFromPreset(p.id);
    store.saveStrategy(userId, { id: p.id, name: p.name, description: p.description, params, paramsHash: paramsHash(params), preset: true });
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
