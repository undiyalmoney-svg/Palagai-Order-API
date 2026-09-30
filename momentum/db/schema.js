'use strict';

/**
 * SQLite schema for the Momentum Portfolio Manager.
 * Global tables (stocks, prices, quotes, regimes, jobs) are shared; everything
 * a user owns carries user_id.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS stocks (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'NSE',
  is_benchmark INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS historical_prices (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (symbol, date)
);
CREATE INDEX IF NOT EXISTS idx_prices_date ON historical_prices (date);

CREATE TABLE IF NOT EXISTS live_quotes (
  symbol TEXT PRIMARY KEY,
  last REAL NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  prev_close REAL,
  volume REAL,
  ts TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS indicators (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  params_key TEXT NOT NULL,
  score REAL,
  rank INTEGER,
  data_json TEXT NOT NULL,
  PRIMARY KEY (symbol, date, params_key)
);

CREATE TABLE IF NOT EXISTS strategies (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  params_json TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  is_preset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS strategy_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS backtests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT,
  strategy_id TEXT,
  params_json TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  config_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL,
  metrics_json TEXT,
  equity_json TEXT,
  extra_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backtest_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  action TEXT,
  qty INTEGER NOT NULL,
  price REAL NOT NULL,
  value REAL NOT NULL,
  cost REAL NOT NULL,
  pnl REAL,
  pnl_pct REAL,
  holding_days INTEGER,
  trigger_name TEXT,
  reason TEXT,
  regime TEXT,
  FOREIGN KEY (backtest_id) REFERENCES backtests(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bt_trades ON backtest_trades (backtest_id, seq);

CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  name TEXT NOT NULL,
  initial_capital REAL NOT NULL,
  cash REAL NOT NULL,
  peak_equity REAL NOT NULL,
  auto_execute INTEGER NOT NULL DEFAULT 0,
  strategy_id TEXT NOT NULL,
  params_json TEXT,
  last_review_date TEXT,
  prev_regime TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, mode)
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  qty INTEGER NOT NULL,
  avg_price REAL NOT NULL,
  entry_date TEXT NOT NULL,
  initial_stop REAL,
  stop_price REAL,
  peak_close REAL,
  partials_json TEXT,
  realized_pnl REAL NOT NULL DEFAULT 0,
  buy_costs REAL NOT NULL DEFAULT 0,
  invested_total REAL NOT NULL DEFAULT 0,
  entry_signal_id INTEGER,
  updated_at TEXT NOT NULL,
  UNIQUE (portfolio_id, symbol)
);

CREATE TABLE IF NOT EXISTS decision_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  portfolio_id INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  kind TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  regime TEXT,
  answer TEXT,
  summary_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (portfolio_id, as_of, kind)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  portfolio_id INTEGER NOT NULL,
  run_id INTEGER,
  as_of TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  timing TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  price_ref REAL,
  allocation_value REAL,
  reason TEXT,
  trigger_name TEXT,
  strategy TEXT,
  score REAL,
  confidence REAL,
  status TEXT NOT NULL,
  decision_key TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  order_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (portfolio_id, decision_key)
);
CREATE INDEX IF NOT EXISTS idx_signals_user ON signals (user_id, as_of);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  portfolio_id INTEGER NOT NULL,
  signal_id INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty INTEGER NOT NULL,
  order_type TEXT NOT NULL,
  limit_price REAL,
  price_ref REAL,
  status TEXT NOT NULL,
  filled_qty INTEGER NOT NULL DEFAULT 0,
  applied_qty INTEGER NOT NULL DEFAULT 0,
  avg_fill_price REAL,
  broker TEXT NOT NULL,
  broker_order_id TEXT,
  variety TEXT,
  reason TEXT,
  error TEXT,
  validation_json TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_pf ON orders (portfolio_id, status);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  status TEXT NOT NULL,
  filled_qty INTEGER,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  portfolio_id INTEGER NOT NULL,
  order_id INTEGER,
  signal_id INTEGER,
  fill_key TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  ts TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price REAL NOT NULL,
  value REAL NOT NULL,
  cost REAL NOT NULL,
  pnl REAL,
  pnl_pct REAL,
  holding_days INTEGER,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_trades_pf ON trades (portfolio_id, date);

CREATE TABLE IF NOT EXISTS capital_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  portfolio_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  ts TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS risk_settings (
  user_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_regimes (
  date TEXT PRIMARY KEY,
  regime TEXT NOT NULL,
  score REAL NOT NULL,
  metrics_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equity_snapshots (
  portfolio_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  equity REAL NOT NULL,
  cash REAL NOT NULL,
  invested REAL NOT NULL,
  PRIMARY KEY (portfolio_id, date)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result_json TEXT,
  error TEXT,
  UNIQUE (job, period_key)
);

CREATE TABLE IF NOT EXISTS broker_sessions (
  user_id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const TABLES = [
  'stocks',
  'historical_prices',
  'live_quotes',
  'indicators',
  'strategies',
  'strategy_runs',
  'backtests',
  'backtest_trades',
  'portfolios',
  'positions',
  'signals',
  'orders',
  'trades',
  'capital_events',
  'risk_settings',
  'market_regimes',
];

module.exports = { SCHEMA, TABLES };
