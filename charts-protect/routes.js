'use strict';

const express = require('express');
const store = require('./store');
const { chartProtectiveLevels, bookFromInstrument } = require('./levels');
const worker = require('./worker');

function attachChartsProtect(router) {
  router.get('/charts-protect', (req, res) => {
    const state = store.load();
    res.json({ status: 'ok', protect: store.publicView(state) });
  });

  router.put('/charts-protect', (req, res) => {
    const enabled = req.body?.enabled === true;
    const state = store.load();
    state.enabled = enabled;
    state.userId = req.user?.id || state.userId;
    state.sessionOk = enabled;
    state.lastMessage = enabled
      ? 'Protect armed on droplet — placing and watching exits'
      : 'Protect disarmed — open fills still watched until flat';
    state.lastError = null;
    store.save(state);
    if (enabled) worker.kick();
    res.json({ status: 'ok', protect: store.publicView(store.load()) });
  });

  router.post('/charts-protect/fill', (req, res) => {
    const body = req.body || {};
    const instrument = String(body.instrument || '').trim();
    const qty = Math.floor(Number(body.qty) || 0);
    const entry = Number(body.entry);
    if (!instrument || !(qty > 0) || !(entry > 0)) {
      res.status(400).json({ status: 'error', message: 'instrument, qty and entry are required' });
      return;
    }
    const levels = chartProtectiveLevels(entry) || {};
    let state = store.load();
    state.userId = req.user?.id || state.userId;
    state = store.upsertFill(state, {
      instrument,
      exchange: body.exchange || null,
      book: body.book || bookFromInstrument(instrument),
      qty,
      entry,
      stop: Number(body.stop) || levels.stop,
      target: Number(body.target) || levels.target,
    });
    state.lastMessage = `Watching ${instrument}`;
    store.save(state);
    res.json({ status: 'ok', protect: store.publicView(state) });
  });
}

module.exports = { attachChartsProtect };
