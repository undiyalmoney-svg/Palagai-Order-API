'use strict';

const fs = require('fs');
const path = require('path');

function pickDir() {
  const want = process.env.RECORDER_DIR || '/var/lib/palagai-recorder';
  try {
    fs.mkdirSync(want, { recursive: true });
    fs.accessSync(want, fs.constants.W_OK);
    return want;
  } catch {
    const fallback = path.join(__dirname, '..', 'data', 'market-recorder');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const dir = pickDir();

module.exports = {
  RECORDER_VERSION: '1.1.0',
  SCHEMA_VERSION: 2,
  dir,
  dbFile: process.env.RECORDER_DB || path.join(dir, 'recorder.sqlite'),
  rawDir: path.join(dir, 'raw'),
  summaryDir: path.join(dir, 'summaries'),
  logFile: path.join(dir, 'recorder.log'),
  errorFile: path.join(dir, 'errors.ndjson'),
  heartbeatFile: path.join(dir, 'heartbeat.json'),
  kiteBase: (process.env.KITE_API_BASE_URL || 'https://api.kite.trade').replace(/\/$/, ''),
  // Overall loop window (IST minutes from midnight); each underlying also has its own session below.
  windowStartMin: 9 * 60,
  windowEndMin: 23 * 60 + 40,
  tickOffsetSec: 3,
  strikesEachSide: 3,
  // Futures traded to 15:40 in 2026 and MCX crude to 23:30 (23:55 in US summer time), so sessions are padded and the
  // daily summary derives the real session from data. MCX lot_size in Kite is 1 exchange lot; `multiplier` is barrels per lot.
  groups: {
    NIFTY: { exchange: 'NFO', name: 'NIFTY', spot: 'NSE:NIFTY 50', spotToken: 256265, step: 50, session: [545, 945], openMin: 556, orMin: 570, expiryMin: 15 * 60 + 30, priceModel: 'spot', multiplier: 1 },
    BANKNIFTY: { exchange: 'NFO', name: 'BANKNIFTY', spot: 'NSE:NIFTY BANK', spotToken: 260105, step: 100, session: [545, 945], openMin: 556, orMin: 570, expiryMin: 15 * 60 + 30, priceModel: 'spot', multiplier: 1 },
    SENSEX: { exchange: 'BFO', name: 'SENSEX', spot: 'BSE:SENSEX', spotToken: 265, step: 100, session: [545, 945], openMin: 556, orMin: 570, expiryMin: 15 * 60 + 30, priceModel: 'spot', multiplier: 1 },
    CRUDEOILM: { exchange: 'MCX', name: 'CRUDEOILM', spot: null, spotToken: null, step: 50, session: [540, 1420], openMin: 541, orMin: 555, expiryMin: 23 * 60 + 30, priceModel: 'black76', multiplier: 10 },
  },
  indices: {
    NIFTY: { spot: 'NSE:NIFTY 50', spotToken: 256265, step: 50, name: 'NIFTY' },
    BANKNIFTY: { spot: 'NSE:NIFTY BANK', spotToken: 260105, step: 100, name: 'BANKNIFTY' },
  },
  vix: { key: 'NSE:INDIA VIX', token: 264969 },
  staleSeconds: 120,
  minFreeDiskMb: 500,
};
