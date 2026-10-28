'use strict';

const express = require('express');
const siteAuth = require('../auth/auth.middleware');
const jobs = require('./jobs');
const { NIFTY_500 } = require('./universe');

function createOrbBacktestRouter({ auth = siteAuth } = {}) {
  const { requireSiteUser } = auth;
  const router = express.Router();
  const guard = [requireSiteUser];

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', module: 'orb-backtest', universe: NIFTY_500.length, liveOrders: false });
  });

  router.get('/universe', ...guard, (_req, res) => {
    res.json({ status: 'ok', index: 'NIFTY 500', count: NIFTY_500.length, symbols: NIFTY_500 });
  });

  router.post('/run', ...guard, (req, res) => {
    try {
      const job = jobs.startJob(req, req.body || {});
      res.status(202).json({ status: 'ok', ...job });
    } catch (err) {
      res.status(err.status || 500).json({
        status: 'error',
        message: err.message,
        jobId: err.jobId || null,
      });
    }
  });

  router.get('/jobs/:id', ...guard, (req, res) => {
    const job = jobs.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ status: 'error', message: 'Backtest job not found.' });
      return;
    }
    res.json({ status: 'ok', ...job });
  });

  return router;
}

module.exports = { createOrbBacktestRouter };
