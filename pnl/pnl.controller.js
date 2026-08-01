const store = require('./pnl.store');

async function list(req, res) {
  const limit = Number(req.query.limit) || 120;
  const [records, summary] = await Promise.all([store.listRecords(limit), store.summary()]);
  res.json({ records, summary });
}

async function upsert(req, res) {
  const row = await store.upsertRecord(req.body || {});
  res.json({ ok: true, record: row });
}

async function remove(req, res) {
  const out = await store.removeRecord(req.params.date);
  res.json(out);
}

module.exports = { list, upsert, remove };
