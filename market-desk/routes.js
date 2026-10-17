'use strict';

const express = require('express');
const siteAuth = require('../auth/auth.middleware');
const { deskAuthorization } = require('./desk-auth');

function createMarketDeskRouter(service, { auth = siteAuth } = {}) {
  const { requireSiteUser, requireCharts } = auth;
  const router = express.Router();
  const guard = [requireSiteUser, requireCharts];

  function kiteFor(req) {
    return deskAuthorization(req, service.getSessionAuthorization);
  }

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', module: 'market-desk', public: false });
  });

  router.get('/', ...guard, async (req, res, next) => {
    try {
      const out = await service.snapshot({
        userId: req.user?.id,
        authorization: await kiteFor(req),
        settings: req.query,
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ status: 'ok', ...out });
    } catch (err) {
      next(err);
    }
  });

  router.get('/candles', ...guard, async (req, res, next) => {
    try {
      const out = await service.candles({
        userId: req.user?.id,
        authorization: await kiteFor(req),
        symbol: req.query.symbol,
        interval: req.query.interval,
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ status: 'ok', ...out });
    } catch (err) {
      next(err);
    }
  });

  router.get('/backtest', ...guard, async (req, res, next) => {
    try {
      const out = await service.backtest({
        userId: req.user?.id,
        authorization: await kiteFor(req),
        symbol: req.query.symbol,
        interval: req.query.interval,
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ status: 'ok', ...out });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createMarketDeskRouter };
