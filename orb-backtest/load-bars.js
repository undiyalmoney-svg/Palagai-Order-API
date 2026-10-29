'use strict';

const { NIFTY_500 } = require('./universe');
const { barsFromCandles, groupByDay } = require('./engine');
const kite = require('../services/kite-market');
const { getCachedBarsCovering, putCachedBars } = require('./store');

const CANDLE_BATCH = 10;

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

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

function needsFillDay(cached, fillDay) {
  if (!fillDay) return false;
  const bars = cached && cached[fillDay];
  return !Array.isArray(bars) || !bars.length;
}

async function loadUniverseBars({
  authorization,
  from,
  to,
  db,
  onProgress,
  shouldCancel,
  symbols = NIFTY_500,
  batchSize = CANDLE_BATCH,
  instrumentMap = null,
  fillDay = null,
  alwaysRefreshFillDay = false,
  fetchBars = null,
  paceMs = 350,
}) {
  const warnings = [];
  const wanted = (symbols || []).map((s) => String(s).toUpperCase());
  const symbolBars = {};
  const needFetch = [];
  const needToday = [];
  const gaps = [];
  let cacheHits = 0;
  const size = Math.max(1, Math.min(50, Math.floor(Number(batchSize) || CANDLE_BATCH)));
  const cacheBatches = Math.ceil(wanted.length / size) || 1;
  const fill = fillDay ? String(fillDay) : '';
  const fetchFn = typeof fetchBars === 'function' ? fetchBars : fetchSymbolBars;
  const pace = Math.max(0, Number(paceMs) || 0);

  for (let i = 0; i < wanted.length; i += 1) {
    if (shouldCancel && shouldCancel()) {
      throw Object.assign(new Error('Cancelled'), { status: 499 });
    }
    const symbol = wanted[i];
    if (onProgress) {
      onProgress({
        phase: 'candles',
        done: i,
        total: wanted.length,
        symbol,
        cacheHits,
        batch: Math.floor(i / size) + 1,
        batches: cacheBatches,
        batchSize: size,
      });
    }
    const cached = db ? getCachedBarsCovering(db, symbol, from, to) : null;
    if (cached && Object.keys(cached).length) {
      symbolBars[symbol] = cached;
      cacheHits += 1;
      if (fill && (alwaysRefreshFillDay || needsFillDay(cached, fill))) needToday.push(symbol);
    } else {
      needFetch.push(symbol);
    }
    if ((i + 1) % size === 0) await yieldEventLoop();
  }

  let missing = [];
  const todayOnly = needToday.filter((s) => !needFetch.includes(s));
  if (!needFetch.length && !todayOnly.length) {
    return {
      symbolBars,
      missing,
      gaps,
      warnings,
      resolved: cacheHits,
      requested: wanted.length,
      cacheHits,
      withBars: Object.keys(symbolBars).length,
    };
  }

  const tokenWanted = [...new Set([...needFetch, ...todayOnly])];
  const inst = instrumentMap instanceof Map ? instrumentMap : await resolveNseEq(authorization, tokenWanted);
  missing = tokenWanted.filter((s) => !inst.has(s));
  const resolved = needFetch.filter((s) => inst.has(s));
  if (!resolved.length && !cacheHits) {
    throw Object.assign(new Error('No Nifty 500 NSE EQ tokens were found in the Kite instrument dump.'), {
      status: 400,
    });
  }

  const fetchTotal = wanted.length;
  for (let i = 0; i < resolved.length; i += 1) {
    if (shouldCancel && shouldCancel()) {
      throw Object.assign(new Error('Cancelled'), { status: 499 });
    }
    const symbol = resolved[i];
    const done = cacheHits + i;
    if (onProgress) {
      onProgress({
        phase: 'candles',
        done,
        total: fetchTotal,
        symbol,
        cacheHits,
        batch: Math.floor(done / size) + 1,
        batches: Math.ceil(fetchTotal / size) || 1,
        batchSize: size,
      });
    }
    try {
      if (pace) await new Promise((r) => setTimeout(r, pace));
      const bars = await fetchFn(authorization, inst.get(symbol).instrumentToken, from, to);
      const days = Object.keys(bars);
      if (!days.length) {
        gaps.push(symbol);
      } else {
        symbolBars[symbol] = bars;
        if (db) putCachedBars(db, symbol, from, to, bars);
      }
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
    if ((i + 1) % size === 0) await yieldEventLoop();
  }

  if (fill && todayOnly.length) {
    const todayResolved = todayOnly.filter((s) => inst.has(s));
    missing = [...new Set([...missing, ...todayOnly.filter((s) => !inst.has(s))])];
    for (let i = 0; i < todayResolved.length; i += 1) {
      if (shouldCancel && shouldCancel()) {
        throw Object.assign(new Error('Cancelled'), { status: 499 });
      }
      const symbol = todayResolved[i];
      if (onProgress) {
        onProgress({
          phase: 'candles',
          done: cacheHits + resolved.length + i,
          total: fetchTotal,
          symbol,
          cacheHits,
          batch: Math.floor((cacheHits + i) / size) + 1,
          batches: Math.ceil(fetchTotal / size) || 1,
          batchSize: size,
        });
      }
      try {
        if (pace) await new Promise((r) => setTimeout(r, pace));
        const bars = await fetchFn(authorization, inst.get(symbol).instrumentToken, fill, fill);
        const days = Object.keys(bars);
        if (days.length) {
          symbolBars[symbol] = { ...(symbolBars[symbol] || {}), ...bars };
          if (db) putCachedBars(db, symbol, fill, fill, bars);
        }
      } catch (err) {
        const msg = String(err.message || err);
        if (/401|403|incorrect|token|session/i.test(msg)) {
          throw Object.assign(new Error('Kite session expired or was rejected. Refresh Token, then run again.'), {
            status: 401,
          });
        }
        warnings.push(`${symbol} today: ${msg}`);
      }
      if ((i + 1) % size === 0) await yieldEventLoop();
    }
  }

  return {
    symbolBars,
    missing,
    gaps,
    warnings,
    resolved: cacheHits + resolved.length,
    requested: wanted.length,
    cacheHits,
    withBars: Object.keys(symbolBars).length,
  };
}

module.exports = { loadUniverseBars, fetchSymbolBars, resolveNseEq, parseNseEqMap, needsFillDay };
