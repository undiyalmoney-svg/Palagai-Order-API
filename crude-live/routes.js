'use strict';

const express = require('express');
const siteAuth = require('../auth/auth.middleware');
const store = require('./store');
const worker = require('./worker');
const { confirmOk } = require('./orders');
const { DNA, ENGINE_VERSION } = require('./dna');

function kiteHeader(req) {
  return req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
}

function createCrudeLiveRouter({ auth = siteAuth } = {}) {
  const { requireSiteUser, requireModule } = auth;
  const router = express.Router();
  const guard = [requireSiteUser, requireModule('crude')];

  router.get('/health', (_req, res) => {
    const state = store.load();
    res.json({
      status: 'ok',
      module: 'crude-live',
      liveOrders: state.enabled === true,
      engineVersion: ENGINE_VERSION,
      dna: DNA,
    });
  });

  router.get('/status', ...guard, async (req, res, next) => {
    try {
      const header = kiteHeader(req);
      if (header) {
        const state = store.load();
        state.userId = req.user?.id || state.userId;
        if (state.userId) worker.captureAuth(state.userId, header);
        await worker.refreshContract(header);
      }
      const state = store.load();
      res.json({
        status: 'ok',
        liveOrders: state.enabled === true,
        engineVersion: ENGINE_VERSION,
        dna: DNA,
        money: store.publicView(state),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/start', ...guard, async (req, res, next) => {
    try {
      if (!confirmOk(req.body)) {
        res.status(400).json({
          status: 'error',
          liveOrders: false,
          message: 'Tick the box to place real MCX MIS on Crude Mini. Auto SL-M and 23:10 flatten arm only after that.',
        });
        return;
      }
      const header = kiteHeader(req);
      if (!/^token\s+[^:\s]+:\S+/i.test(String(header))) {
        res.status(400).json({
          status: 'error',
          liveOrders: false,
          message: 'Connect Kite on Token first. Live money needs a live access token.',
        });
        return;
      }
      const state = store.load();
      state.enabled = true;
      state.userId = req.user?.id || state.userId;
      state.lastError = null;
      state.lastMessage =
        'Live Crude Mini armed. 1 lot CRUDEOILM FUT. Entries 09:00–23:00 IST. Next contract on expiry day. Not a guaranteed profit.';
      if (header && state.userId) worker.captureAuth(state.userId, header);
      state.sessionOk = true;
      store.save(state);
      worker.kick();
      res.json({
        status: 'ok',
        liveOrders: true,
        engineVersion: ENGINE_VERSION,
        dna: DNA,
        money: store.publicView(store.load()),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/stop', ...guard, async (req, res, next) => {
    try {
      const money = await worker.stopLive({
        authorization: kiteHeader(req) || undefined,
        userId: req.user?.id,
      });
      res.json({
        status: 'ok',
        liveOrders: false,
        engineVersion: ENGINE_VERSION,
        dna: DNA,
        money,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createCrudeLiveRouter };
