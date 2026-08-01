/**
 * Manual daily P/L records — Mongo collection `daily_pnl`.
 * Additive. Does not touch Kite order APIs.
 */
const { getDb } = require('../live/live.mongo');

/** @type {Map<string, { date: string, amountRs: number, note: string, updatedAt: string }>} */
const memory = new Map();

function normalizeDate(date) {
  const d = String(date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const err = new Error('date must be YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  return d;
}

function normalizeAmount(amountRs) {
  const n = Number(amountRs);
  if (!Number.isFinite(n)) {
    const err = new Error('amountRs must be a number (₹)');
    err.status = 400;
    throw err;
  }
  return Math.round(n);
}

async function listRecords(limit = 120) {
  const db = getDb();
  if (!db) {
    return [...memory.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }
  return db
    .collection('daily_pnl')
    .find({})
    .sort({ date: -1 })
    .limit(Math.min(500, Math.max(1, limit)))
    .toArray();
}

async function upsertRecord({ date, amountRs, note }) {
  const row = {
    date: normalizeDate(date),
    amountRs: normalizeAmount(amountRs),
    note: String(note || '').trim().slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  const db = getDb();
  if (!db) {
    memory.set(row.date, row);
    return row;
  }
  await db.collection('daily_pnl').updateOne(
    { date: row.date },
    { $set: row, $setOnInsert: { createdAt: row.updatedAt } },
    { upsert: true },
  );
  return row;
}

async function removeRecord(date) {
  const d = normalizeDate(date);
  const db = getDb();
  if (!db) {
    memory.delete(d);
    return { ok: true, date: d };
  }
  await db.collection('daily_pnl').deleteOne({ date: d });
  return { ok: true, date: d };
}

async function summary() {
  const rows = await listRecords(500);
  const total = rows.reduce((s, r) => s + (Number(r.amountRs) || 0), 0);
  const green = rows.filter((r) => r.amountRs > 0).length;
  const red = rows.filter((r) => r.amountRs < 0).length;
  return {
    days: rows.length,
    totalRs: total,
    greenDays: green,
    redDays: red,
    flatDays: rows.length - green - red,
  };
}

module.exports = { listRecords, upsertRecord, removeRecord, summary };
