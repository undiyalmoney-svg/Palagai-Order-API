'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const { runBacktest } = require('../backtest/backtester');
const { whatIf } = require('../research/whatif');
const { runOptimization, runWalkForward } = require('../research/optimizer');
const { resolveParams, paramsHash, STRATEGY_PRESETS, paramsFromPreset, withOverrides } = require('../config/defaults');
const { normalizeCosts } = require('../execution/costs');
const { ServiceError } = require('./momentum-service');

const MAX_CONCURRENT_RUNS = 2;

/** Historical layer: backtests, "what would have happened", and the strategy lab. */
class ResearchService {
  constructor({ store, marketData, momentum, dbPath = null }) {
    this.store = store;
    this.marketData = marketData;
    this.momentum = momentum;
    this.dbPath = dbPath;
    this.active = new Map();
  }

  paramsFor(userId, body = {}) {
    const cfg = this.momentum.config(userId);
    let base = cfg.params;
    if (body.strategyId) {
      const s = this.store.getStrategy(userId, body.strategyId);
      if (!s) throw new ServiceError('BAD_REQUEST', `Unknown strategy ${body.strategyId}`);
      base = resolveParams({ ...s.params, ...this.riskOnly(cfg.risk) });
    }
    const overrides = { ...(body.overrides || {}) };
    const horizon = body.rebalance ? String(body.rebalance).toUpperCase() : null;
    if (horizon) {
      if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(horizon)) throw new ServiceError('BAD_REQUEST', 'rebalance must be DAILY, WEEKLY or MONTHLY');
      overrides.horizon = horizon;
    }
    if (body.numStocks) overrides.maxPositions = Math.round(Number(body.numStocks));
    return withOverrides(base, { ...clean(overrides), id: base.id, name: base.name });
  }

  riskOnly(risk) {
    const keys = ['maxPositions', 'minPositionValue', 'maxPositionPct', 'maxSectorPct', 'riskPerTradePct', 'maxOpenRiskPct', 'minCashPct', 'maxDrawdownHaltPct'];
    return Object.fromEntries(keys.map((k) => [k, risk[k]]));
  }

  backtestConfig(userId, body) {
    const cfg = this.momentum.config(userId);
    const panel = this.marketData.loadPanel();
    const capital = Number(body.capital ?? 1_000_000);
    if (!Number.isFinite(capital) || capital < 10_000) throw new ServiceError('BAD_REQUEST', 'Capital must be at least ₹10,000');
    const from = body.from || panel.dates[Math.min(panel.lastIndex, 300)];
    const to = body.to || panel.dates[panel.lastIndex];
    if (from >= to) throw new ServiceError('BAD_REQUEST', 'Start date must be before end date');
    const costs = normalizeCosts({ ...cfg.costs, ...(body.costs || {}) });
    const slippageBps = body.slippageBps !== undefined ? Math.max(0, Number(body.slippageBps) || 0) : cfg.slippageBps;
    const capitalEvents = (body.capitalEvents || []).filter((e) => e && e.date && Number.isFinite(Number(e.amount))).map((e) => ({ date: e.date, amount: Number(e.amount) }));
    return { panel, capital, from, to, costs, slippageBps, capitalEvents, risk: cfg.risk };
  }

  runBacktest(userId, body = {}) {
    const params = this.paramsFor(userId, body);
    const bc = this.backtestConfig(userId, body);
    const hash = paramsHash(params);
    const id = this.store.insertBacktest({
      userId,
      name: body.name || `${params.name} ${bc.from} to ${bc.to}`,
      strategyId: body.strategyId || params.id,
      params,
      paramsHash: hash,
      config: { capital: bc.capital, costs: bc.costs, slippageBps: bc.slippageBps, capitalEvents: bc.capitalEvents, rebalance: params.horizon, numStocks: params.maxPositions },
      from: bc.from,
      to: bc.to,
    });
    try {
      const r = runBacktest({ panel: bc.panel, params, capital: bc.capital, from: bc.from, to: bc.to, costs: bc.costs, slippageBps: bc.slippageBps, maxPriceDeviationPct: bc.risk.maxPriceDeviationPct, capitalEvents: bc.capitalEvents });
      const extra = {
        actualFrom: r.config.from,
        actualTo: r.config.to,
        timeline: sampleTimeline(r.timeline),
        openPositions: r.openPositions,
        rejected: r.rejected.slice(0, 100),
        roundTrips: r.roundTrips,
        exitBreakdown: exitBreakdown(r.fills),
        benchmark: sampleSeries(r.benchmark, r.equity.length),
      };
      this.store.finishBacktest(id, { status: 'DONE', metrics: r.metrics, equity: sampleEquity(r.equity), extra, trades: r.fills });
      return this.getBacktest(userId, id);
    } catch (err) {
      this.store.finishBacktest(id, { status: 'FAILED', error: err.message });
      throw new ServiceError('BACKTEST_FAILED', err.message);
    }
  }

  getBacktest(userId, id) {
    const b = this.store.getBacktest(userId, id);
    if (!b) throw new ServiceError('NOT_FOUND', 'Backtest not found', 404);
    return { ...b, trades: this.store.listBacktestTrades(id) };
  }

  compare(userId, body = {}) {
    const ids = body.strategyIds?.length ? body.strategyIds : STRATEGY_PRESETS.map((p) => p.id);
    const bc = this.backtestConfig(userId, body);
    const rows = [];
    for (const sid of ids) {
      const s = this.store.getStrategy(userId, sid);
      if (!s) continue;
      const params = resolveParams({ ...s.params, ...this.riskOnly(this.momentum.config(userId).risk), id: s.id, name: s.name });
      try {
        const r = runBacktest({ panel: bc.panel, params, capital: bc.capital, from: bc.from, to: bc.to, costs: bc.costs, slippageBps: bc.slippageBps, keepTimeline: false });
        rows.push({ strategyId: s.id, name: s.name, horizon: params.horizon, metrics: r.metrics, equity: sampleEquity(r.equity, 120) });
      } catch (err) {
        rows.push({ strategyId: s.id, name: s.name, error: err.message });
      }
    }
    return { from: bc.from, to: bc.to, capital: bc.capital, rows };
  }

  whatIf(userId, body = {}) {
    const params = this.paramsFor(userId, body);
    const cfg = this.momentum.config(userId);
    const capital = Number(body.capital ?? 100_000);
    if (!body.date) throw new ServiceError('BAD_REQUEST', 'A date (YYYY-MM-DD) is required');
    try {
      const w = whatIf({ panel: this.marketData.loadPanel(), params, date: body.date, capital, costs: cfg.costs, slippageBps: cfg.slippageBps });
      return { ...w, result: this.momentum.compactResult(w.result), strategy: { id: params.id, name: params.name }, capital };
    } catch (err) {
      if (err.code === 'NO_HISTORY') throw new ServiceError('NO_HISTORY', err.message);
      throw err;
    }
  }

  // ------------------------------------------------------------ strategy lab
  startRun(userId, kind, body = {}) {
    if ([...this.active.values()].filter((a) => a.userId === String(userId)).length >= MAX_CONCURRENT_RUNS) {
      throw new ServiceError('BUSY', 'Too many research runs in progress; wait for one to finish', 429);
    }
    const params = this.paramsFor(userId, body);
    const bc = this.backtestConfig(userId, body);
    const cfg = { baseParams: params, from: bc.from, to: bc.to, capital: bc.capital, costs: bc.costs, slippageBps: bc.slippageBps };
    if (kind === 'OPTIMIZE') {
      cfg.candidates = Math.min(40, Math.max(4, Number(body.candidates) || 16));
      cfg.seed = String(body.seed || 'v1');
    } else {
      cfg.trainMonths = Number(body.trainMonths) || 24;
      cfg.testMonths = Number(body.testMonths) || 6;
      cfg.candidates = Math.min(12, Math.max(3, Number(body.candidates) || 6));
      cfg.seed = String(body.seed || 'wf');
    }
    const runId = this.store.insertRun(userId, kind, { ...cfg, baseParams: undefined, strategy: params.id, paramsHash: paramsHash(params) });
    const finish = (patch) => {
      this.active.delete(runId);
      this.store.updateRun(runId, patch);
    };
    const onProgress = (v) => this.store.updateRun(runId, { progress: Math.round(v * 100) / 100 });

    if (this.dbPath && this.dbPath !== ':memory:') {
      const worker = new Worker(path.join(__dirname, '..', 'research', 'worker.js'), { workerData: { dbPath: this.dbPath, kind, cfg } });
      this.active.set(runId, { userId: String(userId), cancel: () => worker.terminate() });
      let last = 0;
      worker.on('message', (m) => {
        if (m.type === 'progress' && m.value - last >= 0.02) {
          last = m.value;
          onProgress(m.value);
        } else if (m.type === 'done') finish({ status: 'DONE', progress: 1, result: m.result });
        else if (m.type === 'error') finish({ status: 'FAILED', error: m.message });
      });
      worker.on('error', (err) => finish({ status: 'FAILED', error: err.message }));
      worker.on('exit', (code) => {
        if (this.active.has(runId)) finish({ status: code === 0 ? 'FAILED' : 'CANCELLED', error: code === 0 ? 'Worker ended without a result' : 'Cancelled' });
      });
    } else {
      let cancelled = false;
      this.active.set(runId, { userId: String(userId), cancel: () => { cancelled = true; } });
      setImmediate(() => {
        try {
          const panel = this.marketData.loadPanel();
          const fn = kind === 'WALK_FORWARD' ? runWalkForward : runOptimization;
          const result = fn({ panel, ...cfg, onProgress, shouldCancel: () => cancelled });
          finish({ status: 'DONE', progress: 1, result });
        } catch (err) {
          finish({ status: err.cancelled ? 'CANCELLED' : 'FAILED', error: err.message });
        }
      });
    }
    return this.store.getRun(userId, runId);
  }

  cancelRun(userId, runId) {
    const a = this.active.get(runId);
    if (!a || a.userId !== String(userId)) throw new ServiceError('NOT_FOUND', 'No such active run', 404);
    a.cancel();
    return { cancelled: true };
  }

  async waitForRun(runId, timeoutMs = 120_000) {
    const t0 = Date.now();
    for (;;) {
      const r = this.store.db.prepare('SELECT status FROM strategy_runs WHERE id=?').get(runId);
      if (r && r.status !== 'RUNNING') return r.status;
      if (Date.now() - t0 > timeoutMs) throw new Error('Timed out waiting for run');
      await new Promise((res) => setTimeout(res, 50));
    }
  }

  applyCandidate(userId, runId, name) {
    const run = this.store.getRun(userId, runId);
    if (!run || run.status !== 'DONE' || run.kind !== 'OPTIMIZE') throw new ServiceError('BAD_REQUEST', 'Only a completed optimisation can be applied');
    const best = run.result.best;
    if (!best) throw new ServiceError('BAD_REQUEST', 'This run found no candidate');
    return this.momentum.saveStrategy(userId, { name: name || `Optimised ${runId}`, basePreset: run.config.strategy, overrides: best.overrides, description: `Saved from optimisation run #${runId}. ${run.result.verdict}` });
  }

  presets() {
    return STRATEGY_PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description, params: paramsFromPreset(p.id) }));
  }
}

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

function sampleEquity(eq, max = 400) {
  if (eq.length <= max) return eq.map((e) => ({ date: e.date, equity: e.equity, invested: e.invested }));
  const step = Math.ceil(eq.length / max);
  const out = [];
  for (let i = 0; i < eq.length; i += step) out.push({ date: eq[i].date, equity: eq[i].equity, invested: eq[i].invested });
  const last = eq[eq.length - 1];
  if (out[out.length - 1].date !== last.date) out.push({ date: last.date, equity: last.equity, invested: last.invested });
  return out;
}

function sampleSeries(arr, n, max = 400) {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  out.push(arr[arr.length - 1]);
  return out;
}

function sampleTimeline(t, max = 600) {
  if (t.length <= max) return t;
  const step = Math.ceil(t.length / max);
  return t.filter((_, i) => i % step === 0);
}

function exitBreakdown(fills) {
  const out = {};
  for (const f of fills.filter((x) => x.side === 'SELL')) {
    const k = f.trigger || 'OTHER';
    out[k] = out[k] || { count: 0, pnl: 0, avgHoldingDays: 0 };
    out[k].count += 1;
    out[k].pnl += f.pnl;
    out[k].avgHoldingDays += f.holdingDays;
  }
  for (const v of Object.values(out)) {
    v.pnl = Math.round(v.pnl * 100) / 100;
    v.avgHoldingDays = Math.round((v.avgHoldingDays / v.count) * 10) / 10;
  }
  return out;
}

module.exports = { ResearchService };
