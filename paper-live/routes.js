'use strict';

const store = require('./store');
const worker = require('./worker');

function kiteHeader(req) {
  return req.headers['x-kite-authorization'] || req.headers['x-kite-authorisation'] || '';
}

function attachPaperLive(router) {
  router.get('/paper-live', (req, res) => {
    const header = kiteHeader(req);
    const state = store.load();
    state.userId = req.user?.id || state.userId;
    if (header && state.userId) worker.captureAuth(state.userId, header);
    store.save(state);
    res.json({ status: 'ok', paperLive: store.publicView(store.load()) });
  });

  router.put('/paper-live', (req, res) => {
    const header = kiteHeader(req);
    const body = req.body || {};
    const state = store.load();
    state.userId = req.user?.id || state.userId;
    if (typeof body.running === 'boolean') state.running = body.running;
    if (typeof body.live === 'boolean') state.live = body.live;
    if (body.books && typeof body.books === 'object') {
      state.books = { ...store.emptyBooks(), ...state.books, ...body.books };
    }
    if (body.session && typeof body.session === 'object' && Array.isArray(body.session.books)) {
      state.session = body.session;
    }
    if (header && state.userId) worker.captureAuth(state.userId, header);
    state.sessionOk = !!(header || state.sessionOk);
    state.lastError = null;
    state.lastMessage = state.live
      ? 'Live Kite armed on droplet — placing and watching with the tab closed'
      : state.running
        ? 'Paper watching on droplet — Live is off'
        : 'Paper Live idle on droplet';
    store.save(state);
    if (state.running || state.live) worker.kick();
    res.json({ status: 'ok', paperLive: store.publicView(store.load()) });
  });
}

module.exports = { attachPaperLive };
