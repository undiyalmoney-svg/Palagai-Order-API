'use strict';

const express = require('express');
const siteAuth = require('../../auth/auth.middleware');
const { ServiceError, ENABLE_LIVE_PHRASE, ENABLE_AUTO_PHRASE } = require('../services/momentum-service');
const desk = require('../services/desk');
const { OrderError } = require('../execution/order-manager');
const { fetchUserMargins } = require('../../services/kite-market');

const STATUS_BY_CODE = { NOT_FOUND: 404, NO_PORTFOLIO: 404, EXISTS: 409, BUSY: 429, BROKER_ERROR: 502, NOT_ACTIONABLE: 400, NOT_CANCELLABLE: 409, PROVIDER_MISMATCH: 409 };

function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json({ status: 'ok', ...out });
      })
      .catch((err) => {
        if (err instanceof ServiceError || err instanceof OrderError || err.code) {
          const status = err.status || STATUS_BY_CODE[err.code] || 400;
          if (status < 500) {
            res.status(status).json({ status: 'error', code: err.code, message: err.message, ...(err.phrase ? { phrase: err.phrase } : {}) });
            return;
          }
        }
        next(err);
      });
  };
}

const mode = (req) => (String(req.query.mode || req.body?.mode || 'PAPER').toUpperCase() === 'LIVE' ? 'LIVE' : 'PAPER');

/**
 * All trading logic lives behind these endpoints. The frontend only renders
 * what the server decided and sends explicit user actions (start paper,
 * execute a signal, change capital, ...).
 */
function createMomentumRouter(app, { auth = siteAuth } = {}) {
  const { requireSiteUser, requireModule } = auth;
  const { momentum: m, research, jobs, store, marketData } = app;
  const router = express.Router();

  router.get('/health', (_req, res) => res.json({ status: 'ok', module: 'momentum-portfolio-manager' }));
  router.use(requireSiteUser);
  router.use(requireModule('momentum'));

  router.use(async (_req, _res, next) => {
    try {
      await m.ensureData();
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get('/status', wrap(async (req) => ({ ...(await m.status(req.user.id)), phrases: { live: ENABLE_LIVE_PHRASE, auto: ENABLE_AUTO_PHRASE } })));
  router.get('/desk', wrap((req) => desk.deskOverview(m, req.user.id)));
  router.post('/desk/paper', wrap((req) => desk.paperReplay(research, req.user.id, req.body || {})));
  router.post('/desk/scan', wrap((req) => desk.scanDesk(m, req.user.id, req.body || {})));
  router.get('/dashboard', wrap((req) => m.dashboard(req.user.id)));
  router.get('/screener', wrap((req) => m.screener(req.user.id, req.query)));
  router.get('/stocks/:symbol', wrap((req) => m.stockDetail(req.user.id, req.params.symbol)));
  router.get('/regime', wrap(() => m.regimeView()));

  router.get('/config', wrap((req) => m.configView(req.user.id)));
  router.put('/settings', wrap((req) => m.saveSettings(req.user.id, req.body || {})));
  router.put('/risk', wrap((req) => m.saveRisk(req.user.id, req.body || {})));
  router.get('/strategies', wrap((req) => ({ strategies: m.configView(req.user.id).strategies })));
  router.post('/strategies', wrap((req) => ({ strategy: m.saveStrategy(req.user.id, req.body || {}) })));
  router.delete('/strategies/:id', wrap((req) => ({ deleted: store.deleteStrategy(req.user.id, req.params.id) })));

  // ---- portfolios
  router.get('/portfolio', wrap((req) => m.portfolioView(req.user.id, mode(req))));
  router.post('/portfolio/paper', wrap((req) => ({ portfolio: m.initPaper(req.user.id, req.body?.capital, { reset: !!req.body?.reset }) })));
  router.put('/portfolio/auto-execute', wrap((req) => ({ portfolio: m.setAutoExecute(req.user.id, mode(req), !!req.body?.enabled, req.body?.phrase) })));
  router.post('/portfolio/capital', wrap((req) => m.changeCapital(req.user.id, mode(req), req.body?.amount, req.body?.note)));
  router.get('/performance', wrap((req) => m.performance(req.user.id, mode(req))));

  // ---- decisions & advice
  router.post('/advice', wrap((req) => m.advise(req.user.id, { capital: req.body?.capital, useExisting: !!req.body?.useExisting, mode: mode(req) })));
  router.get('/decisions', wrap((req) => {
    const p = m.portfolioOrThrow(req.user.id, mode(req));
    const { result } = m.decideNow({ userId: req.user.id, portfolio: p });
    return { persisted: false, ...m.compactResult(result) };
  }));
  router.post('/decisions/run', wrap(async (req) => {
    const md = mode(req);
    const r = m.runDecision({ userId: req.user.id, mode: md, kind: 'MANUAL', forceReview: !!req.body?.forceReview });
    const portfolio = store.getPortfolio(req.user.id, md);
    const exec = await m.autoExecuteIfEnabled(req.user.id, portfolio, r.runId);
    return { persisted: true, runId: r.runId, ...m.compactResult(r.result), signals: r.signals, execution: exec };
  }));
  router.get('/decisions/history', wrap((req) => ({ runs: store.listDecisionRuns(m.portfolioOrThrow(req.user.id, mode(req)).id, 60) })));
  router.get('/decisions/runs/:id', wrap((req) => {
    const run = store.getDecisionRunById(Number(req.params.id));
    const p = run && store.getPortfolioById(run.portfolioId);
    if (!run || String(p.userId) !== String(req.user.id)) throw new ServiceError('NOT_FOUND', 'Decision run not found', 404);
    return { run };
  }));

  // ---- signals & orders
  router.get('/signals', wrap((req) => ({ signals: store.listSignals({ userId: req.user.id, portfolioId: req.query.portfolioId ? Number(req.query.portfolioId) : null, status: req.query.status || null, symbol: req.query.symbol ? String(req.query.symbol).toUpperCase() : null, actionable: req.query.actionable === '1', limit: Math.min(500, Number(req.query.limit) || 200) }).map(({ detail, ...s }) => s) })));
  router.get('/signals/:id', wrap((req) => m.signalDetail(req.user.id, Number(req.params.id))));
  router.post('/signals/:id/execute', wrap(async (req) => {
    const r = await m.orders.executeSignal({ signalId: Number(req.params.id), userId: req.user.id });
    return { order: r.order, duplicate: !!r.duplicate, queued: !!r.queued, rejected: !!r.rejected, validation: r.validation || r.order.validation, message: r.message || null };
  }));
  router.post('/signals/execute', wrap(async (req) => m.executeSignals(req.user.id, (req.body?.ids || []).map(Number))));
  router.post('/signals/:id/skip', wrap((req) => {
    const s = store.getSignal(Number(req.params.id));
    if (!s || String(s.userId) !== String(req.user.id)) throw new ServiceError('NOT_FOUND', 'Signal not found', 404);
    if (s.status !== 'PENDING') throw new ServiceError('BAD_REQUEST', `Signal is ${s.status}`);
    store.updateSignal(s.id, { status: 'SKIPPED' });
    return { signal: store.getSignal(s.id) };
  }));
  router.get('/orders', wrap((req) => ({ orders: store.listOrders({ userId: req.user.id, portfolioId: req.query.portfolioId ? Number(req.query.portfolioId) : null, statuses: req.query.status ? String(req.query.status).split(',') : null, limit: 200 }) })));
  router.get('/orders/:id', wrap((req) => {
    const o = store.getOrder(Number(req.params.id));
    if (!o || String(o.userId) !== String(req.user.id)) throw new ServiceError('NOT_FOUND', 'Order not found', 404);
    return { order: o, events: store.listOrderEvents(o.id) };
  }));
  router.post('/orders/:id/cancel', wrap(async (req) => ({ order: await m.orders.cancel({ orderId: Number(req.params.id), userId: req.user.id }) })));
  router.post('/orders/reconcile', wrap(async () => ({ results: await m.orders.processOpenOrders() })));
  router.get('/trades', wrap((req) => ({ trades: store.listTrades(m.portfolioOrThrow(req.user.id, mode(req)).id, 500) })));

  // ---- research
  router.post('/backtests', wrap((req) => ({ backtest: research.runBacktest(req.user.id, req.body || {}) })));
  router.get('/backtests', wrap((req) => ({ backtests: store.listBacktests(req.user.id) })));
  router.get('/backtests/:id', wrap((req) => ({ backtest: research.getBacktest(req.user.id, Number(req.params.id)) })));
  router.post('/whatif', wrap((req) => research.whatIf(req.user.id, req.body || {})));
  router.post('/lab/compare', wrap((req) => research.compare(req.user.id, req.body || {})));
  router.post('/lab/optimize', wrap((req) => ({ run: research.startRun(req.user.id, 'OPTIMIZE', req.body || {}) })));
  router.post('/lab/walk-forward', wrap((req) => ({ run: research.startRun(req.user.id, 'WALK_FORWARD', req.body || {}) })));
  router.get('/lab/runs', wrap((req) => ({ runs: store.listRuns(req.user.id) })));
  router.get('/lab/runs/:id', wrap((req) => {
    const run = store.getRun(req.user.id, Number(req.params.id));
    if (!run) throw new ServiceError('NOT_FOUND', 'Run not found', 404);
    return { run };
  }));
  router.post('/lab/runs/:id/cancel', wrap((req) => research.cancelRun(req.user.id, Number(req.params.id))));
  router.post('/lab/runs/:id/apply', wrap((req) => ({ strategy: research.applyCandidate(req.user.id, Number(req.params.id), req.body?.name) })));

  // ---- AI narrator (explains stored decisions only)
  router.post('/ai/ask', wrap((req) => m.ask(req.user.id, mode(req), req.body?.question)));

  // ---- data & jobs
  router.post('/data/sync', wrap(async () => ({ sync: await marketData.sync() })));
  router.post('/data/reset', wrap(async (req) => {
    if (req.user.role !== 'owner') throw new ServiceError('FORBIDDEN', 'Only the owner can reset market data', 403);
    store.resetMarketData();
    marketData.invalidate();
    return { reset: true };
  }));
  router.get('/jobs', wrap(() => ({ jobs: store.listJobs(60) })));
  router.post('/jobs/:name/run', wrap(async (req) => {
    const fn = { daily: 'runDaily', weekly: 'runWeekly', monthly: 'runMonthly' }[req.params.name];
    if (!fn) throw new ServiceError('BAD_REQUEST', 'Unknown job');
    return { outcome: await jobs[fn]({ force: !!req.body?.force }) };
  }));

  // ---- broker (replaces the old /live/funds and /live/auth endpoints)
  router.get('/broker/status', wrap((req) => ({ broker: m.sessions.info(req.user.id), liveEnabled: !!m.config(req.user.id).settings.live.enabled, phrases: { live: ENABLE_LIVE_PHRASE, auto: ENABLE_AUTO_PHRASE } })));
  router.put('/broker/auth', wrap((req) => {
    const { apiKey, accessToken } = req.body || {};
    if (!apiKey || !accessToken) throw new ServiceError('BAD_REQUEST', 'apiKey and accessToken are required');
    m.sessions.save(req.user.id, apiKey, accessToken);
    return { broker: m.sessions.info(req.user.id) };
  }));
  router.delete('/broker/auth', wrap((req) => {
    m.sessions.clear(req.user.id);
    return { broker: m.sessions.info(req.user.id), live: m.disableLive(req.user.id) };
  }));
  router.get('/broker/funds', wrap(async (req) => {
    const authorization = req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || m.sessions.authorization(req.user.id);
    if (!authorization) throw new ServiceError('NO_BROKER', 'Kite session required - Get Token, then retry.');
    try {
      return { fetchedAt: new Date().toISOString(), ...(await fetchUserMargins(authorization)) };
    } catch (err) {
      throw new ServiceError('BROKER_ERROR', err.message || String(err), 400);
    }
  }));
  router.post('/live/enable', wrap(async (req) => m.enableLive(req.user.id, req.body?.phrase)));
  router.post('/live/disable', wrap((req) => m.disableLive(req.user.id)));
  router.post('/live/sync-funds', wrap((req) => m.syncLiveCash(req.user.id)));
  router.post('/live/import-holdings', wrap(async (req) => m.importLiveHoldings(req.user.id)));

  return router;
}

module.exports = { createMomentumRouter };
