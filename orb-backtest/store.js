'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_PATH =
  process.env.ORB_DISCOVERY_DB || path.join(__dirname, '..', 'data', 'orb-backtest', 'discovery.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bar_cache (
  cache_key TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  from_day TEXT NOT NULL,
  to_day TEXT NOT NULL,
  bars_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bar_cache_symbol ON bar_cache(symbol, from_day, to_day);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  progress_json TEXT,
  coverage_json TEXT,
  result_json TEXT,
  error TEXT,
  engine_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function openDatabase(file = DEFAULT_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

let shared = null;

function getDb(file) {
  if (file) return openDatabase(file);
  if (!shared) shared = openDatabase();
  return shared;
}

function closeDb() {
  if (shared) {
    shared.close();
    shared = null;
  }
}

function barsKey(symbol, from, to) {
  return `${String(symbol).toUpperCase()}|${from}|${to}`;
}

function sliceBars(barsByDay, from, to) {
  const sliced = {};
  for (const [day, list] of Object.entries(barsByDay || {})) {
    if (day >= from && day <= to) sliced[day] = list;
  }
  return Object.keys(sliced).length ? sliced : null;
}

function getCachedBars(db, symbol, from, to) {
  const row = db.prepare('SELECT bars_json FROM bar_cache WHERE cache_key = ?').get(barsKey(symbol, from, to));
  if (!row) return null;
  try {
    return JSON.parse(row.bars_json);
  } catch {
    return null;
  }
}

/** Reuse a wider cached pull (discovery often stores 60-day chunks). */
function getCachedBarsCovering(db, symbol, from, to) {
  const exact = getCachedBars(db, symbol, from, to);
  if (exact) return exact;
  const rows = db
    .prepare(
      `SELECT from_day, to_day, bars_json FROM bar_cache
       WHERE symbol = ? AND from_day <= ? AND to_day >= ?
       ORDER BY from_day DESC`,
    )
    .all(String(symbol).toUpperCase(), from, to);
  for (const row of rows) {
    try {
      const sliced = sliceBars(JSON.parse(row.bars_json), from, to);
      if (sliced) return sliced;
    } catch {
      /* try next covering row */
    }
  }
  return null;
}

function putCachedBars(db, symbol, from, to, barsByDay) {
  db.prepare(
    `INSERT INTO bar_cache(cache_key, symbol, from_day, to_day, bars_json, fetched_at)
     VALUES (@cache_key, @symbol, @from_day, @to_day, @bars_json, @fetched_at)
     ON CONFLICT(cache_key) DO UPDATE SET bars_json=excluded.bars_json, fetched_at=excluded.fetched_at`,
  ).run({
    cache_key: barsKey(symbol, from, to),
    symbol: String(symbol).toUpperCase(),
    from_day: from,
    to_day: to,
    bars_json: JSON.stringify(barsByDay),
    fetched_at: new Date().toISOString(),
  });
}

function saveExperiment(db, exp) {
  db.prepare(
    `INSERT INTO experiments(id, status, input_json, progress_json, coverage_json, result_json, error, engine_version, created_at, updated_at)
     VALUES (@id, @status, @input_json, @progress_json, @coverage_json, @result_json, @error, @engine_version, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       status=excluded.status,
       progress_json=excluded.progress_json,
       coverage_json=excluded.coverage_json,
       result_json=excluded.result_json,
       error=excluded.error,
       updated_at=excluded.updated_at`,
  ).run({
    id: exp.id,
    status: exp.status,
    input_json: JSON.stringify(exp.input || {}),
    progress_json: JSON.stringify(exp.progress || null),
    coverage_json: JSON.stringify(exp.coverage || null),
    result_json: exp.result ? JSON.stringify(exp.result) : null,
    error: exp.error || null,
    engine_version: exp.engineVersion || null,
    created_at: exp.createdAt,
    updated_at: exp.updatedAt,
  });
}

function loadExperiment(db, id) {
  const row = db.prepare('SELECT * FROM experiments WHERE id = ?').get(String(id || ''));
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    input: JSON.parse(row.input_json || '{}'),
    progress: row.progress_json ? JSON.parse(row.progress_json) : null,
    coverage: row.coverage_json ? JSON.parse(row.coverage_json) : null,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.error,
    engineVersion: row.engine_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    simulated: true,
    liveOrders: false,
  };
}

function listExperiments(db, limit = 20) {
  return db
    .prepare('SELECT id, status, input_json, engine_version, created_at, updated_at, error FROM experiments ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map((row) => ({
      id: row.id,
      status: row.status,
      input: JSON.parse(row.input_json || '{}'),
      engineVersion: row.engine_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error,
      simulated: true,
      liveOrders: false,
    }));
}

module.exports = {
  DEFAULT_PATH,
  openDatabase,
  getDb,
  closeDb,
  barsKey,
  getCachedBars,
  getCachedBarsCovering,
  sliceBars,
  putCachedBars,
  saveExperiment,
  loadExperiment,
  listExperiments,
};
