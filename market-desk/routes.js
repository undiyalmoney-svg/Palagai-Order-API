'use strict';

const express = require('express');
const siteAuth = require('../auth/auth.middleware');

function createMarketDeskRouter(service, { auth = siteAuth } = {}) {
  const { requireSiteUser, requireModule } = auth;
  const router = express.Router();
  const guard = [requireSiteUser, requireModule('auto')];

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', module: 'market-desk', public: false });
  });

  router.get('/', ...guard, async (req, res, next) => {
    try {
      const header = req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
      const out = await service.snapshot({
        userId: req.user?.id,
        authorization: header,
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
      const header = req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
      const out = await service.candles({
        userId: req.user?.id,
        authorization: header,
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
      const header = req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
      const out = await service.backtest({
        userId: req.user?.id,
        authorization: header,
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
