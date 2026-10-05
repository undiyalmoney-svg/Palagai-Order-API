'use strict';

const { isoWeekKey, monthKey, addDays, isTradingDay, lastCompletedTradingDate, marketStatus, toIstParts } = require('../utils/dates');
const { resolveParams, indicatorKey } = require('../config/defaults');
const { computeRegime } = require('../engine/regime');
const { round } = require('../utils/math');

/**
 * Scheduled work. Every run claims (job, period) in `job_runs` first, so the
 * same period can never be executed twice - not by a repeated tick, a manual
 * trigger, or a second server process sharing the database.
 *
 *   daily    data + indicators + rankings + regime, evaluate holdings,
 *            produce signals (hard exits every day; entries when triggers fire;
 *            the engine itself decides whether today is a review day)
 *   weekly   last trading day of the ISO week: guarantees a full review took
 *            place (rebalance / selection / allocation) and writes a report
 *   monthly  last trading day of the month: performance, portfolio and risk
 *            review, and a strategy validation backtest
 */
class JobRunner {
  constructor({ store, marketData, momentum, research, providerFor, clock = () => new Date(), log = () => {} }) {
    this.store = store;
    this.marketData = marketData;
    this.momentum = momentum;
    this.research = research;
    this.providerFor = providerFor;
    this.clock = clock;
    this.log = log;
    this.timer = null;
    this.ticking = false;
  }

  nextTradingDay(date) {
    let d = addDays(date, 1);
    while (!isTradingDay(d)) d = addDays(d, 1);
    return d;
  }

  isLastOfWeek(date) {
    return isoWeekKey(this.nextTradingDay(date)) !== isoWeekKey(date);
  }

  isLastOfMonth(date) {
    return monthKey(this.nextTradingDay(date)) !== monthKey(date);
  }

  async guarded(job, key, fn, { force = false } = {}) {
    if (force) this.store.db.prepare("UPDATE job_runs SET status='FAILED' WHERE job=? AND period_key=? AND status<>'RUNNING'").run(job, key);
    const id = this.store.claimJob(job, key);
    if (id === null) return { skipped: true, job, key, reason: 'already ran or running for this period' };
    try {
      const result = await fn();
      this.store.finishJob(id, { status: 'DONE', result });
      return { job, key, status: 'DONE', result };
    } catch (err) {
      this.store.finishJob(id, { status: 'FAILED', error: err.message });
      this.log(`[momentum] ${job} ${key} failed: ${err.message}`);
      return { job, key, status: 'FAILED', error: err.message };
    }
  }

  async runDaily({ date = lastCompletedTradingDate(this.clock()), force = false } = {}) {
    return this.guarded('daily', date, async () => {
      const report = { date, steps: [] };
      const step = (name, detail) => report.steps.push({ name, ...detail });

      let sync = null;
      try {
        sync = await this.marketData.sync();
        step('data', { ok: true, newRows: sync.newRows, lastDate: sync.last, failures: sync.failures.length });
      } catch (err) {
        step('data', { ok: false, error: err.message });
      }
      if (!this.marketData.hasData()) throw new Error('No market data available');
      const last = this.marketData.latestDate();
      const panel = this.marketData.loadPanel();
      const params = resolveParams({});
      const view = panel.view(panel.lastIndex, params);
      const regime = computeRegime(view, params, null);
      this.store.saveRegime(panel.dates[panel.lastIndex], regime);
      step('regime', { ok: true, regime: regime.regime, score: regime.score });

      const ctx = view.context();
      const sample = this.momentum.engine.decide({ view, params, portfolio: { cash: 1_000_000, positions: [], peakEquity: 1_000_000 }, now: this.clock() });
      this.store.saveIndicatorRows(
        sample.asOf,
        indicatorKey(params),
        sample.ranking.map((r) => ({ symbol: r.symbol, score: r.score, rank: r.rank, data: { ret: r.ret, rsi: r.rsi, adx: r.adx, relVolume: r.relVolume, rsVsIndex3m: r.rsVsIndex3m, atrPct: r.atrPct, aboveEma: r.aboveEma, components: r.components, status: r.status } })),
      );
      step('indicators', { ok: true, symbols: sample.ranking.length, breadthAboveMid: round(ctx.breadth.pctAboveMid, 3) });

      const portfolios = this.store.listPortfolios('ACTIVE');
      const results = [];
      for (const p of portfolios) results.push(await this.decidePortfolio(p, { kind: 'SCHEDULED', asOfDate: last, staleOk: false }));
      step('portfolios', { ok: true, results });

      const rec = await this.reconcileOrders();
      step('orders', rec);
      return report;
    }, { force });
  }

  async decidePortfolio(portfolio, { kind, asOfDate, forceReview = false }) {
    const userId = portfolio.userId;
    try {
      if (portfolio.mode === 'LIVE' && this.momentum.sessions.authorization(userId)) {
        try {
          await this.momentum.importLiveHoldings(userId);
        } catch (err) {
          this.log(`[momentum] live holdings sync failed: ${err.message}`);
          try {
            await this.momentum.syncLiveCash(userId);
          } catch (cashErr) {
            this.log(`[momentum] live cash sync failed: ${cashErr.message}`);
          }
        }
      }
      const fresh = this.store.getPortfolioById(portfolio.id);
      const existing = this.store.getDecisionRun(fresh.id, asOfDate, kind);
      if (existing) return { portfolioId: fresh.id, mode: fresh.mode, skipped: true, reason: `${kind} decision for ${asOfDate} already exists`, runId: existing.id };
      const { result, paramsHash: hash } = this.momentum.decideNow({ userId, portfolio: fresh, forceReview, asOf: asOfDate });
      const run = this.momentum.persistDecision({ userId, portfolio: fresh, kind, result, hash });
      const exec = await this.momentum.autoExecuteIfEnabled(userId, this.store.getPortfolioById(fresh.id), run.runId);
      return { portfolioId: fresh.id, mode: fresh.mode, runId: run.runId, answer: result.summary.answer, counts: result.summary.counts, executed: exec ? exec.results.length : 0, autoExecute: fresh.autoExecute };
    } catch (err) {
      return { portfolioId: portfolio.id, mode: portfolio.mode, error: err.message };
    }
  }

  async reconcileOrders() {
    try {
      const res = await this.momentum.orders.processOpenOrders();
      return { ok: true, processed: res.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async runWeekly({ date = lastCompletedTradingDate(this.clock()), force = false } = {}) {
    return this.guarded('weekly', isoWeekKey(date), async () => {
      const rows = [];
      for (const p of this.store.listPortfolios('ACTIVE')) {
        const fresh = this.store.getPortfolioById(p.id);
        const reviewed = fresh.lastReviewDate && isoWeekKey(fresh.lastReviewDate) === isoWeekKey(date);
        let review = null;
        if (!reviewed) review = await this.decidePortfolio(fresh, { kind: 'REVIEW', asOfDate: this.marketData.latestDate(), forceReview: true });
        const perf = this.momentum.performance(fresh.userId, fresh.mode);
        rows.push({ portfolioId: fresh.id, mode: fresh.mode, reviewAlreadyDone: !!reviewed, review, equity: perf.equity, totalReturnPct: perf.totalReturnPct, positions: this.store.listPositions(fresh.id).length });
      }
      return { week: isoWeekKey(date), portfolios: rows };
    }, { force });
  }

  async runMonthly({ date = lastCompletedTradingDate(this.clock()), force = false } = {}) {
    return this.guarded('monthly', monthKey(date), async () => {
      const rows = [];
      for (const p of this.store.listPortfolios('ACTIVE')) {
        const perf = this.momentum.performance(p.userId, p.mode);
        const cfg = this.momentum.config(p.userId);
        const view = this.momentum.portfolioView(p.userId, p.mode);
        const flags = [];
        const maxSector = Math.max(0, ...Object.values(view.sectors));
        if (maxSector > cfg.params.maxSectorPct * 100 + 1) flags.push(`Sector concentration ${maxSector}% exceeds cap ${round(cfg.params.maxSectorPct * 100, 0)}%`);
        const openRisk = view.positions.reduce((a, x) => a + (x.riskToStop || 0), 0);
        if (view.valuation.equity && openRisk / view.valuation.equity > cfg.params.maxOpenRiskPct) flags.push('Open risk exceeds cap');
        let validation = null;
        try {
          const panel = this.marketData.loadPanel();
          const to = panel.dates[panel.lastIndex];
          const from = panel.dates[Math.max(0, panel.lastIndex - 260)];
          const bt = this.research.runBacktest(p.userId, { capital: 1_000_000, from, to, name: `Monthly validation ${monthKey(date)}` });
          validation = { backtestId: bt.id, cagrPct: bt.metrics.cagrPct, sharpe: bt.metrics.sharpe, maxDrawdownPct: bt.metrics.maxDrawdownPct, benchmarkCagrPct: bt.metrics.benchmarkCagrPct };
          if (bt.metrics.sharpe < 0) flags.push('Strategy validation: trailing-12-month Sharpe is negative');
          if (bt.metrics.cagrPct < (bt.metrics.benchmarkCagrPct ?? -Infinity)) flags.push('Strategy validation: trailing-12-month return trails buy-and-hold NIFTY');
        } catch (err) {
          validation = { error: err.message };
        }
        rows.push({ portfolioId: p.id, mode: p.mode, equity: perf.equity, totalReturnPct: perf.totalReturnPct, winRatePct: perf.winRatePct, maxSectorPct: maxSector, flags, validation });
      }
      return { month: monthKey(date), portfolios: rows };
    }, { force });
  }

  /** One scheduler pass. Cheap when nothing is due. */
  async tick() {
    if (this.ticking) return null;
    this.ticking = true;
    try {
      const now = this.clock();
      const p = toIstParts(now);
      const minutes = p.hour * 60 + p.minute;
      const out = {};
      if (marketStatus(now).open || minutes >= 9 * 60 + 15) out.orders = await this.reconcileOrders();
      if (minutes >= 16 * 60) {
        const date = lastCompletedTradingDate(now);
        out.daily = await this.runDaily({ date });
        if (out.daily.status === 'DONE' || out.daily.skipped) {
          if (this.isLastOfWeek(date)) out.weekly = await this.runWeekly({ date });
          if (this.isLastOfMonth(date)) out.monthly = await this.runMonthly({ date });
        }
      }
      return out;
    } finally {
      this.ticking = false;
    }
  }

  start(intervalMs = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log(`[momentum] scheduler tick failed: ${err.message}`));
    }, intervalMs);
    this.timer.unref?.();
    setTimeout(() => this.tick().catch(() => {}), 5000).unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { JobRunner };
