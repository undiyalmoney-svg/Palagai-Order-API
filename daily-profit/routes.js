'use strict';

const express = require('express');
const siteAuth = require('../auth/auth.middleware');
const jobs = require('./jobs');
const { generateCandidates } = require('./candidates');
const { NIFTY_500 } = require('../orb-backtest/universe');
const { ENGINE_VERSION } = require('./simulate');

function createDailyProfitRouter({ auth = siteAuth } = {}) {
  const { requireSiteUser } = auth;
  const router = express.Router();
  const guard = [requireSiteUser];

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      module: 'daily-profit',
      engineVersion: ENGINE_VERSION,
      universe: NIFTY_500.length,
      liveOrders: false,
    });
  });

  router.get('/space', ...guard, (_req, res) => {
    const candidates = generateCandidates({ capital: 10000, budget: 20 });
    res.json({
      status: 'ok',
      liveOrders: false,
      count: candidates.length,
      families: [...new Set(candidates.map((c) => c.family))],
      candidates: candidates.map((c) => ({
        id: c.id,
        name: c.name,
        family: c.family,
        isBaseline: !!c.isBaseline,
        rules: c.rules,
      })),
    });
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

  router.get('/', ...guard, (_req, res) => {
    res.json({ status: 'ok', liveOrders: false, experiments: jobs.listJobs() });
  });

  router.get('/jobs/:id', ...guard, (req, res) => {
    const job = jobs.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ status: 'error', message: 'Daily profit job not found.' });
      return;
    }
    res.json({ status: 'ok', ...job });
  });

  router.get('/jobs/:id/candidates/:cid', ...guard, (req, res) => {
    const detail = jobs.getCandidateDetail(req.params.id, req.params.cid);
    if (!detail) {
      res.status(404).json({ status: 'error', message: 'Candidate not found on this experiment.' });
      return;
    }
    res.json({ status: 'ok', ...detail });
  });

  return router;
}

module.exports = { createDailyProfitRouter };
