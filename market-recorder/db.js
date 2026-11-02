'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS instruments (
  token INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL,
  underlying TEXT NOT NULL,
  kind TEXT NOT NULL,            -- FUT | CE | PE | SPOT | VIX
  expiry TEXT,
  strike REAL,
  lot_size INTEGER,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

-- One row per instrument per minute. Never updated after insert.
CREATE TABLE IF NOT EXISTS quotes (
  token INTEGER NOT NULL,
  minute_key TEXT NOT NULL,      -- IST 'YYYY-MM-DD HH:MM' of the fetch (the decision-time bucket)
  fetch_ts TEXT NOT NULL,        -- IST, ms precision, when the response was received
  exch_ts TEXT,                  -- exchange quote timestamp as published by Kite
  ltt TEXT,                      -- last_trade_time as published by Kite
  stale_s REAL,                  -- fetch_ts - exch_ts in seconds
  ltt_changed INTEGER,           -- 1 if last_trade_time moved since the previous stored row, 0 if not, NULL if unknown
  ltp REAL, open REAL, high REAL, low REAL, prev_close REAL,
  volume INTEGER, vol_delta INTEGER,
  oi INTEGER, oi_delta INTEGER, oi_day_high INTEGER, oi_day_low INTEGER,
  buy_qty INTEGER, sell_qty INTEGER, avg_price REAL, net_change REAL,
  bid1 REAL, bid1_qty INTEGER, bid1_orders INTEGER, ask1 REAL, ask1_qty INTEGER, ask1_orders INTEGER,
  bid5_qty INTEGER, ask5_qty INTEGER,
  rel_strike INTEGER,            -- -3..+3 relative to the ATM chosen from spot at this minute
  atm_ref REAL,                  -- spot used to pick ATM (look-ahead guard: known at fetch time)
  spot_ref REAL,                 -- spot used for IV
  iv_calc REAL,                  -- derived IV on spot_ref (Black-Scholes) or the matching future (Black-76); NULL when not reliable
  delta REAL, gamma REAL, theta_day REAL, vega_1pct REAL,   -- derived from iv_calc
  lower_circuit REAL, upper_circuit REAL,   -- exchange price band; a future sitting on a limit has no usable book
  PRIMARY KEY (token, minute_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS quotes_minute ON quotes (minute_key);

-- One row per minute attempt, including failures. This is the completeness ledger.
CREATE TABLE IF NOT EXISTS minutes (
  minute_key TEXT PRIMARY KEY,
  fetch_ts TEXT NOT NULL,
  status TEXT NOT NULL,          -- OK | PARTIAL | NO_AUTH | AUTH_FAILED | HTTP_ERROR | NO_SPOT | SKIPPED_LATE
  n_requested INTEGER,
  n_recorded INTEGER,
  latency_ms INTEGER,
  spot_stale_s REAL,
  duplicates_ignored INTEGER DEFAULT 0,
  error TEXT,
  groups TEXT                    -- underlyings in session for this minute
);

CREATE TABLE IF NOT EXISTS day_context (
  trade_date TEXT NOT NULL,
  underlying TEXT NOT NULL,
  prev_high REAL, prev_low REAL, prev_close REAL,
  open REAL, gap REAL,
  or_high REAL, or_low REAL, or_asof TEXT,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, underlying)
);

-- Kite historical bars (futures with OI). Source-labelled, kept apart from live quotes.
CREATE TABLE IF NOT EXISTS hist_bars (
  token INTEGER NOT NULL,
  interval TEXT NOT NULL,
  ts TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL, volume INTEGER, oi INTEGER,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (token, interval, ts)
) WITHOUT ROWID;
`;

const ADDED = {
  quotes: [['delta', 'REAL'], ['gamma', 'REAL'], ['theta_day', 'REAL'], ['vega_1pct', 'REAL'], ['lower_circuit', 'REAL'], ['upper_circuit', 'REAL']],
  minutes: [['groups', 'TEXT']],
};

/** Schema upgrades are additive only: existing rows are never touched. */
function migrate(db) {
  for (const [table, cols] of Object.entries(ADDED)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of cols) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { open, SCHEMA };
