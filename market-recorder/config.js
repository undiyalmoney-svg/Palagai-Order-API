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
  RECORDER_VERSION: '1.0.0',
  SCHEMA_VERSION: 1,
  dir,
  dbFile: process.env.RECORDER_DB || path.join(dir, 'recorder.sqlite'),
  rawDir: path.join(dir, 'raw'),
  summaryDir: path.join(dir, 'summaries'),
  logFile: path.join(dir, 'recorder.log'),
  errorFile: path.join(dir, 'errors.ndjson'),
  heartbeatFile: path.join(dir, 'heartbeat.json'),
  kiteBase: (process.env.KITE_API_BASE_URL || 'https://api.kite.trade').replace(/\/$/, ''),
  // Session window in IST minutes-from-midnight. Futures traded until 15:40 in 2026, so the
  // window is deliberately wider than 09:15-15:30; the summary derives the real session from data.
  windowStartMin: 9 * 60 + 5,
  windowEndMin: 15 * 60 + 45,
  tickOffsetSec: 3,
  strikesEachSide: 3,
  indices: {
    NIFTY: { spot: 'NSE:NIFTY 50', spotToken: 256265, step: 50, name: 'NIFTY' },
    BANKNIFTY: { spot: 'NSE:NIFTY BANK', spotToken: 260105, step: 100, name: 'BANKNIFTY' },
  },
  vix: { key: 'NSE:INDIA VIX', token: 264969 },
  staleSeconds: 120,
  minFreeDiskMb: 500,
};
