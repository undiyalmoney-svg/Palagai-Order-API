const store = require('./live.store');

async function health(_req, res) {
  res.json({
    status: 'ok',
    service: 'palagai-live-control',
    note: 'Additive Server Live API — does not alter /api/kite order routes',
  });
}

async function status(_req, res) {
  res.json(store.statusPayload());
}

async function events(_req, res) {
  const s = store.statusPayload();
  res.json({ events: s.events || [] });
}

async function start(req, res) {
  const out = await store.start(req.body || {});
  res.json(out);
}

async function stop(_req, res) {
  const out = await store.stop();
  res.json(out);
}

async function putAuth(req, res) {
  const out = await store.putAuth(req.body || {});
  res.json(out);
}

module.exports = { health, status, events, start, stop, putAuth };
