'use strict';

const { PortfolioDecisionEngine } = require('../engine/portfolio-decision-engine');
const { PortfolioService } = require('./portfolio-service');
const { OrderManager } = require('../execution/order-manager');
const { PaperBroker } = require('../broker/paper-broker');
const { KiteBroker } = require('../broker/kite-broker');
const { BrokerSessions } = require('../broker/session-store');
const { resolveUserConfig, mergeSettings, mergeRisk, DEFAULT_SETTINGS } = require('./config');
const { STRATEGY_PRESETS, resolveParams, withOverrides, paramsHash, RISK_KEYS, DEFAULT_RISK_SETTINGS, HORIZON_PRESETS, presetById } = require('../config/defaults');
const { computeMetrics } = require('../backtest/metrics');
const { scoreFeatures, eligibility } = require('../engine/scoring');
const { computeRegime } = require('../engine/regime');
const { analyzeEntry } = require('../engine/entry-timing');
const { featureSnapshot } = require('../engine/features');
const narrator = require('../ai/narrator');
const { istDate, marketStatus, lastCompletedTradingDate } = require('../utils/dates');
const { round } = require('../utils/math');
const { listUniverse } = require('../data/universe');
const { newPosition } = require('../execution/ledger');

const ENABLE_LIVE_PHRASE = 'ENABLE LIVE TRADING';
const ENABLE_AUTO_PHRASE = 'ENABLE AUTOMATED EXECUTION';

class ServiceError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

class MomentumService {
  constructor({ store, marketData, clock = () => new Date(), providerFor, brokerOverride = null }) {
    this.store = store;
    this.marketData = marketData;
    this.clock = clock;
    this.providerFor = providerFor;
    this.engine = new PortfolioDecisionEngine();
    this.sessions = new BrokerSessions(store);
    this.portfolios = new PortfolioService({ store, clock });
    this.brokerOverride = brokerOverride;
    this.paperBrokers = new Map();
    this.screenCache = null;
    this.orders = new OrderManager({
      store,
      portfolios: this.portfolios,
      marketData,
      clock,
      getConfig: (userId) => this.config(userId),
      brokerFor: (portfolio, userId) => this.brokerFor(portfolio, userId),
    });
  }

  today() {
    return istDate(this.clock());
  }

  config(userId) {
    return resolveUserConfig(this.store, userId);
  }

  brokerFor(portfolio, userId) {
    if (this.brokerOverride) return this.brokerOverride(portfolio, userId);
    if (portfolio.mode === 'LIVE') return new KiteBroker({ getAuthorization: async () => this.sessions.authorization(userId) });
    const cfg = this.config(userId);
    const key = `${portfolio.id}:${cfg.slippageBps}:${cfg.settings.paper.partialFillPct}`;
    if (!this.paperBrokers.has(key)) {
      this.paperBrokers.set(key, new PaperBroker({ priceFor: (s) => this.marketData.priceFor(s), slippageBps: cfg.slippageBps, partialFillPct: cfg.settings.paper.partialFillPct }));
    }
    return this.paperBrokers.get(key);
  }

  // ------------------------------------------------------------------- status
  async status(userId) {
    const provider = await this.providerFor();
    const pstat = await provider.status();
    const cfg = this.config(userId);
    const stats = this.store.priceStats();
    const live = this.store.getPortfolio(userId, 'LIVE');
    return {
      provider: { ...pstat, simulatedNotice: pstat.simulated ? 'Prices are SIMULATED (deterministic mock provider). Results demonstrate how the engine behaves, not real market performance.' : null },
      data: stats,
      market: marketStatus(this.clock()),
      lastTradingDate: lastCompletedTradingDate(this.clock()),
      broker: { ...this.sessions.info(userId), liveEnabled: !!cfg.settings.live.enabled, hasLivePortfolio: !!live },
      strategy: cfg.strategy,
      horizon: cfg.params.horizon,
      today: this.today(),
    };
  }

  async ensureData() {
    if (!this.marketData.hasData()) return this.marketData.sync({ provider: await this.providerFor() });
    return null;
  }

  // ----------------------------------------------------------------- settings
  configView(userId) {
    const cfg = this.config(userId);
    const strategies = this.store.listStrategies(userId).map((s) => ({ id: s.id, name: s.name, description: s.description, preset: s.preset, horizon: s.params.horizon, paramsHash: s.paramsHash }));
    return {
      settings: cfg.settings,
      risk: cfg.risk,
      riskKeys: RISK_KEYS,
      strategy: cfg.strategy,
      strategies,
      params: cfg.params,
      horizons: Object.fromEntries(Object.entries(HORIZON_PRESETS).map(([k, v]) => [k, { review: v.reviewEvery, hint: v.holdingHint, expectedHolding: v.expectedHolding }])),
    };
  }

  saveSettings(userId, patch) {
    const current = mergeSettings(this.store.getSettings(userId));
    const next = { ...current };
    if (patch.strategyId !== undefined) {
      if (!this.store.getStrategy(userId, patch.strategyId)) throw new ServiceError('BAD_REQUEST', `Unknown strategy ${patch.strategyId}`);
      next.strategyId = patch.strategyId;
    }
    if (patch.slippageBps !== undefined) next.slippageBps = Math.min(200, Math.max(0, Number(patch.slippageBps) || 0));
    if (patch.costs) {
      next.costs = { ...current.costs, ...patch.costs };
      next.costs.extraBps = Math.min(200, Math.max(0, Number(next.costs.extraBps) || 0));
    }
    if (patch.paper) {
      next.paper = {
        fillWhenClosed: patch.paper.fillWhenClosed !== undefined ? !!patch.paper.fillWhenClosed : current.paper.fillWhenClosed,
        partialFillPct: patch.paper.partialFillPct !== undefined ? Math.min(1, Math.max(0.1, Number(patch.paper.partialFillPct) || 1)) : current.paper.partialFillPct,
      };
    }
    if (patch.live && patch.live.allowAmo !== undefined) next.live = { ...current.live, allowAmo: !!patch.live.allowAmo };
    this.store.saveSettings(userId, next);
    this.paperBrokers.clear();
    return this.configView(userId);
  }

  saveRisk(userId, patch) {
    const current = mergeRisk(this.store.getRisk(userId));
    const bounds = {
      maxPositions: [1, 40],
      minPositionValue: [500, 10_000_000],
      maxPositionPct: [0.03, 1],
      maxSectorPct: [0.05, 1],
      riskPerTradePct: [0.001, 0.05],
      maxOpenRiskPct: [0.01, 0.4],
      minCashPct: [0, 0.9],
      maxDrawdownHaltPct: [0.03, 0.9],
      maxDailyLossPct: [0.005, 0.2],
      maxOrderValue: [1000, 100_000_000],
      maxSignalAgeDays: [0, 30],
      maxPriceDeviationPct: [0.002, 0.2],
    };
    const next = { ...current };
    for (const [k, [lo, hi]] of Object.entries(bounds)) {
      if (patch[k] === undefined) continue;
      const n = Number(patch[k]);
      if (!Number.isFinite(n) || n < lo || n > hi) throw new ServiceError('BAD_REQUEST', `${k} must be between ${lo} and ${hi}`);
      next[k] = n;
    }
    this.store.saveRisk(userId, next);
    return this.configView(userId);
  }

  saveStrategy(userId, body) {
    const name = String(body.name || '').trim();
    if (!name) throw new ServiceError('BAD_REQUEST', 'Strategy name is required');
    const baseId = body.basePreset || this.config(userId).strategy.id;
    const base = this.store.getStrategy(userId, baseId);
    if (!base) throw new ServiceError('BAD_REQUEST', `Unknown base strategy ${baseId}`);
    const id = body.id || `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)}`;
    const existing = this.store.getStrategy(userId, id);
    if (existing?.preset) throw new ServiceError('BAD_REQUEST', 'Built-in presets cannot be overwritten; save under a new name');
    const params = withOverrides(base.params, { ...(body.overrides || {}), id, name });
    this.store.saveStrategy(userId, { id, name, description: body.description || `Custom strategy based on ${base.name}`, params, paramsHash: paramsHash(params), preset: false });
    return this.store.getStrategy(userId, id);
  }

  // ---------------------------------------------------------------- portfolios
  portfolioOrThrow(userId, mode) {
    const p = this.store.getPortfolio(userId, mode);
    if (!p) throw new ServiceError('NO_PORTFOLIO', mode === 'LIVE' ? 'Live trading has not been enabled' : 'No paper portfolio yet - start one with a starting capital', 404);
    return p;
  }

  initPaper(userId, capital, { reset = false } = {}) {
    const c = Number(capital);
    if (!Number.isFinite(c) || c < 10_000 || c > 1_000_000_000) throw new ServiceError('BAD_REQUEST', 'Starting capital must be between ₹10,000 and ₹100 crore');
    const existing = this.store.getPortfolio(userId, 'PAPER');
    if (existing && !reset) throw new ServiceError('EXISTS', 'A paper portfolio already exists (use reset to start over)', 409);
    if (existing) this.store.deletePortfolio(existing.id);
    const cfg = this.config(userId);
    const p = this.store.createPortfolio({ userId, mode: 'PAPER', name: 'Paper portfolio', capital: c, strategyId: cfg.strategy.id, autoExecute: true });
    this.store.addCapitalEvent({ userId, portfolioId: p.id, kind: 'INITIAL', amount: c, note: 'Starting capital' });
    this.portfolios.snapshot(p, (s) => this.marketData.priceFor(s)?.price);
    return p;
  }

  priceOf = (symbol) => this.marketData.priceFor(symbol)?.price;

  portfolioView(userId, mode) {
    const p = this.portfolioOrThrow(userId, mode);
    const val = this.portfolios.value(p, this.priceOf);
    const panel = this.marketData.loadPanel();
    const positions = val.positions.map((pos) => ({
      symbol: pos.symbol,
      name: panel.nameOf(pos.symbol),
      sector: panel.sectorOf(pos.symbol),
      qty: pos.qty,
      avgPrice: round(pos.avgPrice, 2),
      lastPrice: round(pos.lastPrice, 2),
      value: pos.value,
      weightPct: val.equity ? round((pos.value / val.equity) * 100, 1) : 0,
      unrealizedPnl: pos.unrealizedPnl,
      unrealizedPct: pos.unrealizedPct,
      entryDate: pos.entryDate,
      stopPrice: pos.stopPrice,
      initialStop: pos.initialStop,
      riskToStop: pos.stopPrice ? round(Math.max(0, pos.lastPrice - pos.stopPrice) * pos.qty, 2) : null,
      realizedPnl: round(pos.realizedPnl, 2),
    }));
    const sectors = {};
    for (const pos of positions) sectors[pos.sector] = round((sectors[pos.sector] || 0) + pos.weightPct, 1);
    return {
      portfolio: { id: p.id, mode: p.mode, name: p.name, strategyId: p.strategyId, autoExecute: p.autoExecute, initialCapital: p.initialCapital, lastReviewDate: p.lastReviewDate, prevRegime: p.prevRegime, peakEquity: p.peakEquity, createdAt: p.createdAt },
      valuation: { equity: val.equity, cash: val.cash, invested: val.invested, unrealized: val.unrealized, exposurePct: val.equity ? round((val.invested / val.equity) * 100, 1) : 0 },
      positions,
      sectors,
      openOrders: this.store.listOpenOrders(p.id),
      capitalEvents: this.store.listCapitalEvents(p.id),
    };
  }

  setAutoExecute(userId, mode, enabled, phrase) {
    const p = this.portfolioOrThrow(userId, mode);
    if (mode === 'LIVE' && enabled) {
      const cfg = this.config(userId);
      if (!cfg.settings.live.enabled) throw new ServiceError('LIVE_DISABLED', 'Enable live trading first');
      if (String(phrase || '').trim() !== ENABLE_AUTO_PHRASE) throw new ServiceError('CONFIRMATION_REQUIRED', `Type "${ENABLE_AUTO_PHRASE}" to allow the system to place real orders automatically`, 400, { phrase: ENABLE_AUTO_PHRASE });
    }
    this.store.updatePortfolio(p.id, { autoExecute: !!enabled });
    return this.store.getPortfolioById(p.id);
  }

  async enableLive(userId, phrase) {
    if (String(phrase || '').trim() !== ENABLE_LIVE_PHRASE) throw new ServiceError('CONFIRMATION_REQUIRED', `Type "${ENABLE_LIVE_PHRASE}" to enable live trading`, 400, { phrase: ENABLE_LIVE_PHRASE });
    if (!this.sessions.authorization(userId)) throw new ServiceError('NO_BROKER', 'Connect your Kite session first (Settings > Broker)', 400);
    const broker = this.brokerFor({ mode: 'LIVE' }, userId);
    let funds;
    try {
      funds = await broker.funds();
    } catch (err) {
      throw new ServiceError('BROKER_ERROR', `Could not verify the Kite session: ${err.message}`, 502);
    }
    const cfg = this.config(userId);
    this.store.saveSettings(userId, { ...cfg.settings, live: { ...cfg.settings.live, enabled: true, enabledAt: this.clock().toISOString() } });
    let p = this.store.getPortfolio(userId, 'LIVE');
    const cash = funds.equityCash || 0;
    if (!p) {
      p = this.store.createPortfolio({ userId, mode: 'LIVE', name: 'Live portfolio', capital: cash, strategyId: cfg.strategy.id, autoExecute: false });
      this.store.addCapitalEvent({ userId, portfolioId: p.id, kind: 'INITIAL', amount: cash, note: 'Available Kite equity cash at enable time' });
    }
    let holdings = null;
    try {
      holdings = await this.importLiveHoldings(userId);
    } catch (err) {
      holdings = { error: err.message, imported: [], updated: [], removed: [], skipped: [] };
    }
    return { enabled: true, portfolio: this.store.getPortfolio(userId, 'LIVE'), funds, holdings };
  }

  disableLive(userId) {
    const cfg = this.config(userId);
    this.store.saveSettings(userId, { ...cfg.settings, live: { ...cfg.settings.live, enabled: false } });
    const p = this.store.getPortfolio(userId, 'LIVE');
    if (p) this.store.updatePortfolio(p.id, { autoExecute: false });
    return { enabled: false };
  }

  /** Align the live portfolio's cash with the broker's available equity funds. */
  async syncLiveCash(userId) {
    const p = this.portfolioOrThrow(userId, 'LIVE');
    const funds = await this.brokerFor(p, userId).funds();
    this.store.updatePortfolio(p.id, { cash: funds.equityCash });
    return { cash: funds.equityCash, funds };
  }

  classifyBrokerHoldings(raw) {
    const universe = new Set(listUniverse().map((u) => u.symbol));
    const wanted = new Map();
    const skipped = [];
    for (const h of raw || []) {
      const symbol = String(h.symbol || h.tradingsymbol || '').toUpperCase();
      const qty = Math.floor(Number(h.qty ?? h.quantity) || 0);
      const avgPrice = Number(h.avgPrice ?? h.average_price) || 0;
      const lastPrice = Number(h.lastPrice ?? h.last_price) || avgPrice || 0;
      const exchange = String(h.exchange || 'NSE').toUpperCase();
      if (!symbol || qty <= 0) continue;
      if (exchange && exchange !== 'NSE' && exchange !== 'BSE') {
        skipped.push({ symbol, qty, avgPrice, lastPrice: lastPrice || avgPrice || 0, reason: `exchange ${exchange}` });
        continue;
      }
      if (!universe.has(symbol)) {
        skipped.push({ symbol, qty, avgPrice, lastPrice: lastPrice || avgPrice || 0, reason: 'outside momentum universe' });
        continue;
      }
      const px = avgPrice || this.marketData.priceFor(symbol)?.price || lastPrice || 0;
      if (!px) {
        skipped.push({ symbol, qty, avgPrice, lastPrice: lastPrice || 0, reason: 'no price' });
        continue;
      }
      wanted.set(symbol, { symbol, qty, avgPrice: px, lastPrice: lastPrice || px });
    }
    return { wanted, skipped };
  }

  /** Read CNC holdings without enabling live trading or writing a live book. */
  async previewCncHoldings(userId) {
    if (!this.sessions.authorization(userId)) {
      throw new ServiceError('NO_BROKER', 'No Kite session', 400);
    }
    const broker = this.brokerFor({ mode: 'LIVE' }, userId);
    if (typeof broker.holdings !== 'function') {
      throw new ServiceError('NOT_SUPPORTED', 'This broker does not report holdings', 400);
    }
    let raw;
    try {
      raw = await broker.holdings();
    } catch (err) {
      throw new ServiceError('BROKER_ERROR', `Could not read broker holdings: ${err.message}`, 502);
    }
    const classified = this.classifyBrokerHoldings(raw);
    return { universeHoldings: [...classified.wanted.values()], skipped: classified.skipped };
  }

  /** Equity cash available for new CNC buys. Does not enable live trading. */
  async readLiveFunds(userId) {
    if (!this.sessions.authorization(userId)) {
      throw new ServiceError('NO_BROKER', 'No Kite session', 400);
    }
    const broker = this.brokerFor({ mode: 'LIVE' }, userId);
    if (typeof broker.funds !== 'function') {
      throw new ServiceError('NOT_SUPPORTED', 'This broker does not report funds', 400);
    }
    try {
      return await broker.funds();
    } catch (err) {
      throw new ServiceError('BROKER_ERROR', `Could not read broker funds: ${err.message}`, 502);
    }
  }

  /**
   * Seed / refresh the live book from CNC holdings the broker reports.
   * Cash is set to available equity funds so holdings are not double-counted.
   * Names outside the momentum universe are skipped, not invented.
   */
  async importLiveHoldings(userId) {
    const p = this.portfolioOrThrow(userId, 'LIVE');
    const broker = this.brokerFor(p, userId);
    if (typeof broker.holdings !== 'function') {
      throw new ServiceError('NOT_SUPPORTED', 'This broker does not report holdings', 400);
    }
    let raw;
    try {
      raw = await broker.holdings();
    } catch (err) {
      throw new ServiceError('BROKER_ERROR', `Could not read broker holdings: ${err.message}`, 502);
    }
    const { wanted, skipped } = this.classifyBrokerHoldings(raw);
    const today = this.today();
    const existing = this.store.listPositions(p.id);
    const imported = [];
    const updated = [];
    const removed = [];
    this.store.tx(() => {
      for (const pos of existing) {
        if (!wanted.has(pos.symbol)) {
          this.store.deletePosition(p.id, pos.symbol);
          removed.push(pos.symbol);
        }
      }
      for (const row of wanted.values()) {
        const prev = this.store.getPosition(p.id, row.symbol);
        const next = newPosition({
          symbol: row.symbol,
          qty: row.qty,
          price: row.avgPrice,
          cost: prev?.buyCosts || 0,
          date: prev?.entryDate || today,
          initialStop: prev?.initialStop ?? null,
          stopPrice: prev?.stopPrice ?? null,
          signalId: prev?.entrySignalId ?? null,
        });
        if (prev) {
          next.peakClose = Math.max(prev.peakClose || 0, row.avgPrice);
          updated.push(row.symbol);
        } else {
          imported.push(row.symbol);
        }
        this.store.savePosition(p.id, next);
      }
    });
    let funds = null;
    try {
      funds = await broker.funds();
      this.store.updatePortfolio(p.id, { cash: funds.equityCash });
    } catch {
      funds = null;
    }
    this.store.addCapitalEvent({
      userId,
      portfolioId: p.id,
      kind: 'IMPORT',
      amount: 0,
      note: `Broker holdings sync: ${imported.length} new, ${updated.length} updated, ${removed.length} removed`,
    });
    return {
      imported,
      updated,
      removed,
      skipped,
      cash: funds?.equityCash ?? this.store.getPortfolioById(p.id).cash,
      holdings: [...wanted.values()],
    };
  }

  // ---------------------------------------------------------------- decisions
  buildPortfolioInput(portfolio) {
    const pending = this.store.listOpenOrders(portfolio.id).map((o) => ({ symbol: o.symbol, side: o.side, qty: o.qty - o.filledQty, price: o.limitPrice || o.priceRef }));
    return {
      portfolio: { cash: portfolio.cash, positions: this.store.listPositions(portfolio.id), peakEquity: portfolio.peakEquity },
      state: { prevRegime: portfolio.prevRegime, lastReviewDate: portfolio.lastReviewDate },
      pendingOrders: pending,
    };
  }

  decideNow({ userId, portfolio = null, capital = null, capitalEvent = null, forceReview = false, asOf = null, lean = false, params = null }) {
    const cfg = this.config(userId);
    const panel = this.marketData.loadPanel();
    const p = params || cfg.params;
    const idx = asOf ? panel.indexOnOrBefore(asOf) : panel.lastIndex;
    const view = panel.view(idx, p);
    const input = portfolio
      ? this.buildPortfolioInput(portfolio)
      : { portfolio: { cash: capital, positions: [], peakEquity: capital }, state: {}, pendingOrders: [] };
    const result = this.engine.decide({
      view,
      params: p,
      ...input,
      capitalEvent,
      costs: cfg.costs,
      slippageBps: cfg.slippageBps,
      forceReview,
      now: this.clock(),
      lean,
    });
    return { result, paramsHash: paramsHash(p) };
  }

  /** Run + persist a decision for a real (paper/live) portfolio. */
  runDecision({ userId, mode, kind = 'MANUAL', capitalEvent = null, forceReview = false, params = null }) {
    const portfolio = this.portfolioOrThrow(userId, mode);
    const { result, paramsHash: hash } = this.decideNow({ userId, portfolio, capitalEvent, forceReview, params });
    return this.persistDecision({ userId, portfolio, kind, result, hash });
  }

  persistDecision({ userId, portfolio, kind, result, hash }) {
    return this.store.tx(() => {
      const runId = this.store.saveDecisionRun({ userId, portfolioId: portfolio.id, asOf: result.asOf, kind, paramsHash: hash, result });
      const signals = [];
      for (const d of result.decisions) {
        const s = this.store.insertSignalIfNew({ userId, portfolioId: portfolio.id, runId, decision: d });
        signals.push({ id: s.id, created: s.created, decisionKey: d.decisionKey });
      }
      this.portfolios.applyHoldUpdates(portfolio, result.decisions, this.priceOf);
      this.store.updatePortfolio(portfolio.id, { prevRegime: result.nextState.regime, lastReviewDate: result.nextState.lastReviewDate });
      this.store.saveRegime(result.asOf, result.regime);
      this.portfolios.snapshot(portfolio, this.priceOf);
      return { runId, result, signals };
    });
  }

  signalsForRun(userId, runId) {
    return this.store.listSignals({ userId, limit: 500 }).filter((s) => s.runId === runId);
  }

  /** Execute every actionable PENDING signal: exits first, then entries. */
  async executeSignals(userId, signalIds, { auto = false } = {}) {
    const sigs = signalIds.map((id) => this.store.getSignal(id)).filter(Boolean);
    const rank = (s) => (s.action === 'BUY' ? 1 : 0);
    sigs.sort((a, b) => rank(a) - rank(b));
    const out = [];
    for (const s of sigs) {
      if (!['BUY', 'SELL', 'EXIT', 'REDUCE'].includes(s.action)) continue;
      try {
        const r = await this.orders.executeSignal({ signalId: s.id, userId });
        out.push({ signalId: s.id, symbol: s.symbol, action: s.action, orderId: r.order.id, status: r.order.status, duplicate: !!r.duplicate, message: r.message || r.order.error || null });
      } catch (err) {
        out.push({ signalId: s.id, symbol: s.symbol, action: s.action, status: 'ERROR', message: err.message });
      }
    }
    return { auto, results: out };
  }

  async autoExecuteIfEnabled(userId, portfolio, runId) {
    if (!portfolio.autoExecute) return null;
    if (portfolio.mode === 'LIVE' && !this.config(userId).settings.live.enabled) return null;
    const pending = this.signalsForRun(userId, runId).filter((s) => s.status === 'PENDING' && s.portfolioId === portfolio.id);
    if (!pending.length) return { auto: true, results: [] };
    return this.executeSignals(userId, pending.map((s) => s.id), { auto: true });
  }

  /** "I have ₹X. What should I buy today?" - hypothetical, nothing is stored. */
  advise(userId, { capital, useExisting = false, mode = 'PAPER' }) {
    const cfg = this.config(userId);
    let out;
    if (useExisting) {
      const p = this.portfolioOrThrow(userId, mode);
      out = this.decideNow({ userId, portfolio: p });
    } else {
      const c = Number(capital);
      if (!Number.isFinite(c) || c < 5_000) throw new ServiceError('BAD_REQUEST', 'Enter a capital of at least ₹5,000');
      out = this.decideNow({ userId, capital: c });
    }
    return { hypothetical: !useExisting, strategy: cfg.strategy, ...this.compactResult(out.result) };
  }

  compactResult(r) {
    return {
      asOf: r.asOf,
      answer: r.summary.answer,
      headline: r.summary.headline,
      summary: r.summary,
      regime: r.regime,
      review: r.review,
      triggers: r.triggers,
      capital: r.capital,
      portfolioSize: { n: r.portfolioSize.n, explanation: r.portfolioSize.explanation, constraints: r.portfolioSize.constraints, reservePct: r.portfolioSize.reservePct, rho: r.portfolioSize.rho },
      allocation: r.allocation,
      decisions: r.decisions,
      exposure: r.stats,
      drawdown: r.drawdown,
    };
  }

  /** Capital change on a real portfolio: deposit is booked, then the engine allocates it. */
  async changeCapital(userId, mode, amount, note) {
    const p = this.portfolioOrThrow(userId, mode);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt === 0) throw new ServiceError('BAD_REQUEST', 'Enter a non-zero amount (positive to add, negative to withdraw)');
    if (mode === 'LIVE') throw new ServiceError('BAD_REQUEST', 'Live capital follows your broker account; adjust funds at the broker and use "Sync funds".');
    if (amt > 0) {
      const before = this.portfolios.value(p, this.priceOf).equity;
      const updated = this.portfolios.deposit(p, amt, note);
      const run = this.runDecision({ userId, mode, kind: 'CAPITAL', capitalEvent: { amount: amt, kind: 'DEPOSIT' }, forceReview: true });
      const exec = await this.autoExecuteIfEnabled(userId, updated, run.runId);
      return { kind: 'DEPOSIT', before, amount: amt, run: this.compactResult(run.result), runId: run.runId, execution: exec };
    }
    const need = -amt;
    const view = this.portfolios.value(p, this.priceOf);
    const spare = p.cash - view.equity * this.config(userId).params.minCashPct;
    if (need <= spare) {
      this.portfolios.withdraw(p, need, note);
      return { kind: 'WITHDRAWAL', amount: amt, status: 'DONE', message: `Withdrew ${need.toLocaleString('en-IN')} from spare cash. No positions were sold.` };
    }
    const run = this.runDecision({ userId, mode, kind: 'CAPITAL', capitalEvent: { amount: amt, kind: 'WITHDRAWAL' }, forceReview: true });
    const exec = await this.autoExecuteIfEnabled(userId, this.store.getPortfolioById(p.id), run.runId);
    return { kind: 'WITHDRAWAL', amount: amt, status: 'NEEDS_SELLS', message: 'Cash is not enough; the engine proposes selling the lowest-ranked holdings. Execute the sells, then repeat the withdrawal.', run: this.compactResult(run.result), runId: run.runId, execution: exec };
  }

  // -------------------------------------------------------------- read models
  performance(userId, mode) {
    const p = this.portfolioOrThrow(userId, mode);
    const val = this.portfolios.value(p, this.priceOf);
    const snaps = this.store.listEquitySnapshots(p.id);
    const events = this.store.listCapitalEvents(p.id);
    const flowByDate = new Map();
    for (const e of events) {
      if (e.kind === 'INITIAL') continue;
      const d = e.ts.slice(0, 10);
      flowByDate.set(d, (flowByDate.get(d) || 0) + e.amount);
    }
    const series = snaps.map((s) => ({ date: s.date, equity: s.equity, invested: s.invested, flow: flowByDate.get(s.date) || 0 }));
    const trades = this.store.listTrades(p.id, 1000);
    const closed = trades.filter((t) => t.side === 'SELL' && t.pnl !== null);
    const roundTrips = closed.map((t) => ({ pnl: t.pnl, returnPct: t.pnlPct || 0, holdingDays: t.holdingDays || 0 }));
    const costs = trades.reduce((a, t) => a + t.cost, 0);
    const metrics = series.length > 1 ? computeMetrics({ equity: series, roundTrips, fills: trades.map((t) => ({ value: t.value })), costs, slippage: 0, startCapital: p.initialCapital }) : null;
    const wins = closed.filter((t) => t.pnl > 0).length;
    const contributions = events.reduce((a, e) => a + e.amount, 0);
    return {
      equity: val.equity,
      cash: val.cash,
      invested: val.invested,
      unrealized: val.unrealized,
      realizedPnl: round(closed.reduce((a, t) => a + t.pnl, 0), 2),
      totalPnl: round(val.equity - contributions, 2),
      totalReturnPct: contributions > 0 ? round(((val.equity - contributions) / contributions) * 100, 2) : 0,
      contributions: round(contributions, 2),
      tradesClosed: closed.length,
      winRatePct: closed.length ? round((wins / closed.length) * 100, 1) : 0,
      totalCosts: round(costs, 2),
      metrics,
      equitySeries: snaps,
      note: 'Win rate and P&L are per exit fill. Metrics need at least two daily snapshots.',
    };
  }

  dashboard(userId) {
    const cfg = this.config(userId);
    const panel = this.marketData.loadPanel();
    const paper = this.store.getPortfolio(userId, 'PAPER');
    const live = this.store.getPortfolio(userId, 'LIVE');
    const screen = this.screener(userId, {});
    const regimes = this.store.listRegimes(120);
    const pending = this.store.listSignals({ userId, status: 'PENDING', actionable: true, limit: 50 });
    const out = {
      asOf: panel.dates[panel.lastIndex],
      strategy: cfg.strategy,
      horizon: cfg.params.horizon,
      regime: screen.regime,
      regimeHistory: regimes.map((r) => ({ date: r.date, regime: r.regime, score: r.score })),
      topRanked: screen.rows.slice(0, 8),
      pendingSignals: pending,
      paper: paper ? { ...this.portfolios.value(paper, this.priceOf), positions: undefined, positionCount: this.store.listPositions(paper.id).length, id: paper.id } : null,
      live: live ? { ...this.portfolios.value(live, this.priceOf), positions: undefined, positionCount: this.store.listPositions(live.id).length, id: live.id } : null,
      recentTrades: paper ? this.store.listTrades(paper.id, 8) : [],
    };
    return out;
  }

  screener(userId, filters = {}) {
    const cfg = this.config(userId);
    const panel = this.marketData.loadPanel();
    const key = `${panel.lastIndex}|${paramsHash(cfg.params)}`;
    if (!this.screenCache || this.screenCache.key !== key) {
      const view = panel.view(panel.lastIndex, cfg.params);
      const r = this.engine.decide({ view, params: cfg.params, portfolio: { cash: 1_000_000, positions: [], peakEquity: 1_000_000 }, costs: cfg.costs, slippageBps: cfg.slippageBps, now: this.clock() });
      this.screenCache = { key, result: r };
    }
    const r = this.screenCache.result;
    let rows = r.ranking.map((x) => ({ ...x }));
    if (filters.sector) rows = rows.filter((x) => x.sector === filters.sector);
    if (filters.minScore) rows = rows.filter((x) => x.score >= Number(filters.minScore));
    if (filters.status) rows = rows.filter((x) => x.status === filters.status);
    if (filters.eligibleOnly) rows = rows.filter((x) => x.eligible);
    if (filters.q) rows = rows.filter((x) => `${x.symbol} ${x.name}`.toLowerCase().includes(String(filters.q).toLowerCase()));
    const sortKey = filters.sort || 'score';
    const dir = filters.dir === 'asc' ? 1 : -1;
    const val = (x) => (sortKey === 'score' ? x.score : sortKey === 'm1' ? x.ret.m1 : sortKey === 'm3' ? x.ret.m3 : sortKey === 'm6' ? x.ret.m6 : sortKey === 'rs' ? x.rsVsIndex3m : sortKey === 'relVolume' ? x.relVolume : x[sortKey]);
    rows.sort((a, b) => (typeof val(a) === 'string' ? String(val(a)).localeCompare(String(val(b))) * -dir : ((val(a) ?? -Infinity) - (val(b) ?? -Infinity)) * dir));
    return {
      asOf: r.asOf,
      regime: { regime: r.regime.regime, score: r.regime.score, reasons: r.regime.reasons, policy: r.regime.policy },
      universeSize: r.universeSize,
      sectors: [...new Set(r.ranking.map((x) => x.sector))].sort(),
      rows,
    };
  }

  stockDetail(userId, symbol) {
    const cfg = this.config(userId);
    const panel = this.marketData.loadPanel();
    const sym = String(symbol).toUpperCase();
    if (!panel.data.has(sym)) throw new ServiceError('NOT_FOUND', `Unknown symbol ${sym}`, 404);
    const params = cfg.params;
    const idx = panel.lastIndex;
    const view = panel.view(idx, params);
    const f = view.features(sym);
    const ctx = view.context();
    const regime = computeRegime(view, params, null);
    const sector = ctx.sectors.get(view.sector(sym)) || null;
    const detail = { symbol: sym, name: panel.nameOf(sym), sector: panel.sectorOf(sym), asOf: panel.dates[idx] };
    const n = 260;
    const start = Math.max(0, idx - n + 1);
    const ind = panel.indicators(sym, params);
    const d = panel.data.get(sym);
    const pick = (arr) => Array.from({ length: idx - start + 1 }, (_, i) => (Number.isFinite(arr[start + i]) ? round(arr[start + i], 2) : null));
    detail.candles = Array.from({ length: idx - start + 1 }, (_, i) => ({ date: panel.dates[start + i], open: d.open[start + i], high: d.high[start + i], low: d.low[start + i], close: d.close[start + i], volume: d.volume[start + i] })).filter((c) => Number.isFinite(c.close));
    detail.overlays = { emaFast: pick(ind.emaFast), emaMid: pick(ind.emaMid), emaSlow: pick(ind.emaSlow), emaLong: pick(ind.emaLong), dates: panel.dates.slice(start, idx + 1) };
    if (f && f.valid) {
      const score = scoreFeatures(f, ctx, params, sector ? sector.ret3m : NaN);
      const elig = eligibility(f, view.barsAvailable(sym), params);
      detail.score = score;
      detail.eligibility = elig;
      detail.entry = analyzeEntry({ f, score, elig, regime, params, sector, horizonPresets: HORIZON_PRESETS });
      detail.features = featureSnapshot(f);
      detail.regime = regime.regime;
    } else {
      detail.note = 'Not enough history to score this stock yet.';
    }
    const held = ['PAPER', 'LIVE'].map((m) => this.store.getPortfolio(userId, m)).filter(Boolean).map((p) => ({ mode: p.mode, position: this.store.getPosition(p.id, sym) })).filter((x) => x.position);
    detail.holdings = held;
    detail.signals = this.store.listSignals({ userId, symbol: sym, limit: 10 }).map((s) => ({ id: s.id, asOf: s.asOf, action: s.action, reason: s.reason, status: s.status }));
    return detail;
  }

  regimeView() {
    const panel = this.marketData.loadPanel();
    const params = resolveParams({});
    const view = panel.view(panel.lastIndex, params);
    const cur = computeRegime(view, params, null);
    return { current: { regime: cur.regime, score: cur.score, components: cur.components, metrics: cur.metrics, reasons: cur.reasons, policy: cur.policy, asOf: cur.asOf }, history: this.store.listRegimes(260) };
  }

  ask(userId, mode, question) {
    const p = this.store.getPortfolio(userId, mode) || this.store.getPortfolio(userId, mode === 'PAPER' ? 'LIVE' : 'PAPER');
    let decisionRun = null;
    let performance = null;
    if (p) {
      const runs = this.store.listDecisionRuns(p.id, 1);
      decisionRun = runs.length ? this.store.getDecisionRunById(runs[0].id) : null;
      performance = this.performance(userId, p.mode);
    }
    return narrator.ask(question, { store: this.store, userId, portfolio: p, symbols: this.marketData.loadPanel().symbols(), decisionRun, performance });
  }

  signalDetail(userId, id) {
    const s = this.store.getSignal(id);
    if (!s || String(s.userId) !== String(userId)) throw new ServiceError('NOT_FOUND', 'Signal not found', 404);
    const order = s.orderId ? this.store.getOrder(s.orderId) : null;
    return { signal: s, story: narrator.signalStory(s), source: narrator.SOURCE, order, orderEvents: order ? this.store.listOrderEvents(order.id) : [] };
  }
}

module.exports = { MomentumService, ServiceError, ENABLE_LIVE_PHRASE, ENABLE_AUTO_PHRASE, DEFAULT_SETTINGS, STRATEGY_PRESETS, presetById, DEFAULT_RISK_SETTINGS };
