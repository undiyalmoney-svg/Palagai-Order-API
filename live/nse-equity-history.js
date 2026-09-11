'use strict';
/**
 * NSE cash equity daily OHLC + Nifty 100 constituent list.
 */
const axios = require('axios');
const https = require('https');
const {
  warmNseSession,
  nseGet,
  ddmmyyyy,
  addDaysIso,
  delay,
  parseNseOrIsoDate,
  NSE_ORIGIN,
} = require('./nse-option-history');

const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });
const EQUITY_API = `${NSE_ORIGIN}/api/historicalOR/cm/equity`;
const NIFTY100_CSV = 'https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv';

function mapEquityRow(row) {
  if (!row || typeof row !== 'object') return null;
  const parsed = parseNseOrIsoDate(row.CH_TIMESTAMP || row.mTIMESTAMP);
  const open = Number(row.CH_OPENING_PRICE);
  const high = Number(row.CH_TRADE_HIGH_PRICE);
  const low = Number(row.CH_TRADE_LOW_PRICE);
  const close = Number(row.CH_CLOSING_PRICE ?? row.CH_LAST_TRADED_PRICE);
  if (!parsed || ![open, high, low, close].every(Number.isFinite)) return null;
  return {
    date: parsed.iso,
    open,
    high,
    low,
    close,
    volume: Number(row.CH_TOT_TRADED_QTY) || 0,
  };
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

async function fetchNifty100Symbols() {
  const res = await axios.get(NIFTY100_CSV, {
    timeout: 30_000,
    validateStatus: () => true,
    httpsAgent: ipv4HttpsAgent,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/csv,*/*',
    },
  });
  if (res.status !== 200 || typeof res.data !== 'string' || !/Symbol/i.test(res.data)) {
    const err = new Error(`Nifty 100 list HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  const lines = res.data.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map((h) => h.trim());
  const si = header.findIndex((h) => /^symbol$/i.test(h));
  const col = si >= 0 ? si : 2;
  const symbols = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(',');
    const sym = String(parts[col] || '').trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    symbols.push(sym);
  }
  return symbols;
}

async function fetchEquityChunk(symbol, fromIso, toIso) {
  await warmNseSession();
  const url =
    `${EQUITY_API}?symbol=${encodeURIComponent(symbol)}` +
    `&series=${encodeURIComponent('["EQ"]')}` +
    `&from=${encodeURIComponent(ddmmyyyy(fromIso))}` +
    `&to=${encodeURIComponent(ddmmyyyy(toIso))}`;
  const res = await nseGet(url, {
    Referer: `${NSE_ORIGIN}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
    'X-Requested-With': 'XMLHttpRequest',
  });
  if (res.status !== 200) {
    const err = new Error(`NSE equity history HTTP ${res.status} (${symbol})`);
    err.status = 502;
    throw err;
  }
  const payload = res.data;
  if (typeof payload === 'string' && /<!DOCTYPE|<html/i.test(payload)) {
    const err = new Error(`NSE equity history HTML (${symbol})`);
    err.status = 502;
    throw err;
  }
  return extractRows(payload).map(mapEquityRow).filter(Boolean);
}

async function fetchEquityDaily(opts = {}) {
  const symbol = String(opts.symbol || '').trim().toUpperCase();
  const fromDate = String(opts.fromDate || '').slice(0, 10);
  const toDate = String(opts.toDate || '').slice(0, 10);
  if (!symbol) {
    const err = new Error('symbol required');
    err.status = 400;
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) {
    const err = new Error('fromDate and toDate (YYYY-MM-DD) required');
    err.status = 400;
    throw err;
  }
  const fetchChunk = opts.fetchChunk || fetchEquityChunk;
  const bars = [];
  const seen = new Set();
  let cursor = fromDate;
  while (cursor <= toDate) {
    const end = addDaysIso(cursor, 90) > toDate ? toDate : addDaysIso(cursor, 90);
    try {
      const chunk = await fetchChunk(symbol, cursor, end);
      for (const bar of chunk) {
        if (seen.has(bar.date)) continue;
        seen.add(bar.date);
        bars.push(bar);
      }
    } catch {
      /* skip a bad chunk; other windows may still fill */
    }
    cursor = addDaysIso(end, 1);
    if (cursor <= toDate) await delay(120);
  }
  bars.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { symbol, fromDate, toDate, source: 'nse', interval: 'day', historical: bars };
}

async function mapPool(items, width, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(width, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

module.exports = {
  fetchNifty100Symbols,
  fetchEquityDaily,
  mapEquityRow,
  mapPool,
};
