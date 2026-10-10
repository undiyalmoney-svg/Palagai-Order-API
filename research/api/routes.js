'use strict';

const express = require('express');
const siteAuth = require('../../auth/auth.middleware');
const { ServiceError } = require('../service');

function createResearchRouter(service, { auth = siteAuth } = {}) {
  const { requireSiteUser, requireModule } = auth;
  const router = express.Router();
  const guard = [requireSiteUser, requireModule('research')];
  const hits = new Map();

  function limit(req, res, next) {
    const key = `${req.user?.id || 'anon'}:${req.path}`;
    const now = Date.now();
    const prev = hits.get(key) || 0;
    if (now - prev < 500) {
      res.status(429).json({ status: 'error', message: 'Slow down' });
      return;
    }
    hits.set(key, now);
    next();
  }

  function wrap(fn) {
    return (req, res, next) => {
      Promise.resolve()
        .then(() => fn(req))
        .then((out) => {
          if (!res.headersSent) res.json({ status: 'ok', ...out });
        })
        .catch((err) => {
          if (err instanceof ServiceError || err.status) {
            res.status(err.status || 400).json({ status: 'error', code: err.code || 'BAD_REQUEST', message: err.message });
            return;
          }
          next(err);
        });
    };
  }

  function range(req) {
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new ServiceError('BAD_DATE', 'from must be YYYY-MM-DD');
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ServiceError('BAD_DATE', 'to must be YYYY-MM-DD');
    if (from && to && from > to) throw new ServiceError('BAD_DATE', 'from is after to');
    return {
      from,
      to,
      strategyId: req.query.strategyId || undefined,
      symbol: req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined,
      direction: req.query.direction ? String(req.query.direction).toUpperCase() : undefined,
      status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
      page: req.query.page,
      limit: req.query.limit,
    };
  }

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', module: 'intraday-research', paperOnly: true });
  });

  router.get('/status', ...guard, wrap(async () => service.status()));
  router.get('/readiness', ...guard, wrap(async () => service.readiness()));
  router.post('/start', ...guard, limit, wrap(async (req) => ({ experiment: await service.start(req.body || {}) })));
  router.post('/stop', ...guard, limit, wrap(async () => ({ experiment: await service.stop() })));
  router.put('/config', ...guard, limit, wrap(async (req) => ({ experiment: await service.configure(req.body || {}) })));
  router.get('/strategies', ...guard, wrap(async () => ({ strategies: await service.strategies() })));
  router.post('/strategies/:strategyId/enable', ...guard, limit, wrap(async (req) => ({ strategy: await service.setEnabled(req.params.strategyId, true, req.body?.version) })));
  router.post('/strategies/:strategyId/disable', ...guard, limit, wrap(async (req) => ({ strategy: await service.setEnabled(req.params.strategyId, false, req.body?.version) })));
  router.get('/candidates', ...guard, wrap(async (req) => ({ candidates: await service.candidates(range(req)) })));
  router.get('/positions', ...guard, wrap(async () => ({ positions: await service.positions() })));
  router.get('/trades', ...guard, wrap(async (req) => service.trades(range(req))));
  router.get('/summary', ...guard, wrap(async (req) => service.summary(range(req))));
  router.get('/weekly', ...guard, wrap(async (req) => ({ weeks: await service.weekly(range(req)) })));
  router.get('/events', ...guard, wrap(async () => ({ events: await service.events() })));
  router.post('/optimization/run', ...guard, limit, wrap(async (req) => service.optimize(req.body?.strategyId)));

  router.get('/export.csv', ...guard, async (req, res, next) => {
    try {
      const csv = await service.exportCsv(range(req));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="research-trades.csv"');
      res.send(csv);
    } catch (err) {
      if (err.status) {
        res.status(err.status).json({ status: 'error', code: err.code, message: err.message });
        return;
      }
      next(err);
    }
  });

  router.get('/export.xlsx', ...guard, async (req, res, next) => {
    try {
      const buf = await service.exportXlsx(range(req));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="research-trades.xlsx"');
      res.send(buf);
    } catch (err) {
      if (err.status) {
        res.status(err.status).json({ status: 'error', code: err.code, message: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}

module.exports = { createResearchRouter };
