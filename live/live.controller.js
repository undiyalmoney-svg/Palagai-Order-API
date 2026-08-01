const store = require('./live.store');

async function health(_req, res) {
  res.json({
    status: 'ok',
    service: 'palagai-live-control',
    note: 'Multi-user Server Live — does not alter /api/kite order routes',
  });
}

function userId(req) {
  return req.user?.id || 'anonymous';
}

async function status(req, res) {
  res.json(store.statusFor(userId(req)));
}

async function events(req, res) {
  const s = store.statusFor(userId(req));
  res.json({ events: s.events || [] });
}

async function start(req, res) {
  const out = await store.start(userId(req), req.body || {});
  res.json(out);
}

async function stop(req, res) {
  const out = await store.stop(userId(req));
  res.json(out);
}

async function putAuth(req, res) {
  const out = await store.putAuth(userId(req), req.body || {});
  res.json(out);
}

module.exports = { health, status, events, start, stop, putAuth };
