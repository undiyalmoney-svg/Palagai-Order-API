'use strict';

const { NIFTY_500 } = require('./universe');
const { barsFromCandles, groupByDay } = require('./engine');
const kite = require('../services/kite-market');
const { getCachedBars, putCachedBars } = require('./store');

function parseNseEqMap(csv, symbols) {
  const want = new Set((symbols || []).map((s) => String(s).toUpperCase()));
  const map = new Map();
  for (const line of String(csv || '').split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 12) continue;
    const exchange = (cols[11] || '').trim().toUpperCase();
    const itype = (cols[9] || '').trim().toUpperCase();
    if (exchange !== 'NSE' || itype !== 'EQ') continue;
    const sym = (cols[2] || '').trim().toUpperCase();
    if (want.size && !want.has(sym)) continue;
    const token = Number(cols[0]) || 0;
    if (!token) continue;
    map.set(sym, {
      instrumentToken: token,
      tradingSymbol: (cols[2] || '').trim(),
      exchange: 'NSE',
      instrumentType: 'EQ',
    });
  }
  return map;
}

async function resolveNseEq(authorization, symbols) {
  const csv = await kite.fetchInstrumentsCsv(authorization, 'NSE');
  return parseNseEqMap(csv, symbols);
}

async function fetchSymbolBars(authorization, token, from, to) {
  const candles = await kite.fetchHistoricalInterval(authorization, token, from, to, '5minute', {
    chunkGapMs: 350,
  });
  return groupByDay(barsFromCandles(candles));
}

async function loadUniverseBars({
  authorization,
  from,
  to,
  db,
  onProgress,
  shouldCancel,
  symbols = NIFTY_500,
}) {
  const warnings = [];
  const inst = await resolveNseEq(authorization, symbols);
  const missing = symbols.filter((s) => !inst.has(s));
  const resolved = symbols.filter((s) => inst.has(s));
  if (!resolved.length) {
    throw Object.assign(new Error('No Nifty 500 NSE EQ tokens were found in the Kite instrument dump.'), {
      status: 400,
    });
  }
  const symbolBars = {};
  const gaps = [];
  let cacheHits = 0;
  for (let i = 0; i < resolved.length; i += 1) {
    if (shouldCancel && shouldCancel()) {
      throw Object.assign(new Error('Cancelled'), { status: 499 });
    }
    const symbol = resolved[i];
    if (onProgress) onProgress({ phase: 'candles', done: i, total: resolved.length, symbol, cacheHits });
    const cached = db ? getCachedBars(db, symbol, from, to) : null;
    if (cached && Object.keys(cached).length) {
      symbolBars[symbol] = cached;
      cacheHits += 1;
      continue;
    }
    try {
      if (i) await new Promise((r) => setTimeout(r, 350));
      const bars = await fetchSymbolBars(authorization, inst.get(symbol).instrumentToken, from, to);
      const days = Object.keys(bars);
      if (!days.length) {
        gaps.push(symbol);
        continue;
      }
      symbolBars[symbol] = bars;
      if (db) putCachedBars(db, symbol, from, to, bars);
    } catch (err) {
      const msg = String(err.message || err);
      if (/401|403|incorrect|token|session/i.test(msg)) {
        throw Object.assign(new Error('Kite session expired or was rejected. Refresh Token, then run again.'), {
          status: 401,
        });
      }
      if (/429|too many/i.test(msg)) {
        warnings.push(`Rate limited on ${symbol}; waiting and continuing.`);
        await new Promise((r) => setTimeout(r, 2000));
        i -= 1;
        continue;
      }
      gaps.push(symbol);
      warnings.push(`${symbol}: ${msg}`);
    }
  }
  return {
    symbolBars,
    missing,
    gaps,
    warnings,
    resolved: resolved.length,
    requested: symbols.length,
    cacheHits,
    withBars: Object.keys(symbolBars).length,
  };
}

module.exports = { loadUniverseBars, fetchSymbolBars, resolveNseEq, parseNseEqMap };
