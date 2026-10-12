'use strict';

const express = require('express');
const siteAuth = require('../auth/auth.middleware');
const store = require('./store');
const worker = require('./worker');
const { publicRules } = require('./rules');

function createSlBuddyRouter({ auth = siteAuth } = {}) {
  const { requireSiteUser, requireModule } = auth;
  const router = express.Router();
  const guard = [requireSiteUser, requireModule('auto')];

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', module: 'sl-buddy' });
  });

  router.get('/', ...guard, async (req, res, next) => {
    try {
      const header = req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
      const { state, snapshot } = await worker.tick({
        userId: req.user?.id,
        authorization: header || undefined,
        place: false,
        force: true,
      });
      res.json({
        status: 'ok',
        buddy: store.publicView(state, snapshot),
        rules: publicRules(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.put('/', ...guard, async (req, res, next) => {
    try {
      const enabled = req.body?.enabled === true;
      const header = req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
      const state = store.load();
      state.enabled = enabled;
      state.userId = req.user?.id || state.userId;
      state.lastError = null;
      if (header && state.userId) worker.captureAuth(state.userId, header);
      state.sessionOk = enabled;
      state.lastMessage = enabled
        ? 'Watching your orders — SL Buddy will rest matching-qty stops'
        : 'SL Buddy stopped. Existing SL orders stay at Kite.';
      store.save(state);
      const { state: next, snapshot } = await worker.tick({
        userId: state.userId,
        authorization: header || undefined,
        place: enabled,
        force: true,
      });
      res.json({
        status: 'ok',
        buddy: store.publicView(next, snapshot),
        rules: publicRules(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createSlBuddyRouter };
