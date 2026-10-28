'use strict';

const express = require('express');
const siteAuth = require('../auth/auth.middleware');
const jobs = require('./jobs');
const discoverJobs = require('./discover/jobs');
const { NIFTY_500 } = require('./universe');
const { generateCandidates } = require('./discover/candidates');

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

  router.get('/discover/space', ...guard, (_req, res) => {
    const candidates = generateCandidates({ capital: 40000, budget: 24 });
    res.json({
      status: 'ok',
      liveOrders: false,
      count: candidates.length,
      baselineId: candidates.find((c) => c.isBaseline)?.id,
      candidates: candidates.map((c) => ({
        id: c.id,
        name: c.name,
        family: c.family,
        isBaseline: c.isBaseline,
        experimental: c.experimental,
        rules: c.rules,
      })),
    });
  });

  router.post('/discover', ...guard, (req, res) => {
    try {
      const job = discoverJobs.startDiscoverJob(req, req.body || {});
      res.status(202).json({ status: 'ok', ...job });
    } catch (err) {
      res.status(err.status || 500).json({
        status: 'error',
        message: err.message,
        jobId: err.jobId || null,
      });
    }
  });

  router.get('/discover', ...guard, (_req, res) => {
    res.json({ status: 'ok', liveOrders: false, experiments: discoverJobs.listDiscoverJobs() });
  });

  router.get('/discover/:id', ...guard, (req, res) => {
    const job = discoverJobs.getDiscoverJob(req.params.id);
    if (!job) {
      res.status(404).json({ status: 'error', message: 'Discovery job not found.' });
      return;
    }
    res.json({ status: 'ok', ...job });
  });

  router.get('/discover/:id/candidates/:cid', ...guard, (req, res) => {
    const detail = discoverJobs.getCandidateDetail(req.params.id, req.params.cid);
    if (!detail) {
      res.status(404).json({ status: 'error', message: 'Candidate not found on this experiment.' });
      return;
    }
    res.json({ status: 'ok', ...detail });
  });

  return router;
}

module.exports = { createOrbBacktestRouter };
