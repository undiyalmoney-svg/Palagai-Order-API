'use strict';

const store = require('./store');
const worker = require('./worker');
const { phraseOk, PHRASE } = require('./orders');

function kiteHeader(req) {
  return req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
}

function attachLiveMoneyRoutes(router, guard) {
  router.get('/live-today/status', ...guard, (req, res) => {
    const state = store.load();
    res.json({
      status: 'ok',
      liveOrders: state.enabled === true,
      money: store.publicView(state),
      phrase: PHRASE,
    });
  });

  router.post('/live-today/start', ...guard, async (req, res, next) => {
    try {
      if (!phraseOk(req.body?.phrase)) {
        res.status(400).json({
          status: 'error',
          liveOrders: false,
          message: `Type ${PHRASE} to place real NSE MIS orders. Auto SL-M and auto 1R / 15:15 exits are armed only after that.`,
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
      state.doneToday = false;
      state.userId = req.user?.id || state.userId;
      state.lastError = null;
      state.lastMessage =
        'Live money armed. Scanning every Nifty 500 closed 5-minute bar from 09:45 to 14:30 — not a 09:50 one-shot.';
      if (header && state.userId) worker.captureAuth(state.userId, header);
      state.sessionOk = true;
      store.save(state);
      worker.kick();
      res.json({
        status: 'ok',
        liveOrders: true,
        money: store.publicView(state),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/live-today/stop', ...guard, async (req, res, next) => {
    try {
      const money = await worker.stopLive({
        authorization: kiteHeader(req) || undefined,
        userId: req.user?.id,
      });
      res.json({
        status: 'ok',
        liveOrders: false,
        money,
      });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { attachLiveMoneyRoutes };
