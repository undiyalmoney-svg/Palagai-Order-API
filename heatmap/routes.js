'use strict';

const express = require('express');

function createHeatmapRouter(service) {
  const router = express.Router();
  const hits = new Map();

  function limit(req, res, next) {
    const key = String(req.ip || req.headers['x-forwarded-for'] || 'anon');
    const now = Date.now();
    const prev = hits.get(key) || 0;
    if (now - prev < 400) {
      res.status(429).json({ status: 'error', message: 'Slow down' });
      return;
    }
    hits.set(key, now);
    if (hits.size > 2000) {
      for (const [k, at] of hits) {
        if (now - at > 60_000) hits.delete(k);
      }
    }
    next();
  }

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', module: 'heatmap', public: true });
  });

  router.get('/', limit, async (req, res, next) => {
    try {
      const out = await service.snapshot();
      res.setHeader('Cache-Control', 'public, max-age=15');
      res.json({ status: 'ok', ...out });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createHeatmapRouter };
