'use strict';
/**
 * NSE daily index OHLC (NIFTY 50, etc.) via historicalOR/indicesHistory.
 * Max 365 calendar days per call — we chunk.
 */
const {
  warmNseSession,
  nseGet,
  ddmmyyyy,
  addDaysIso,
  delay,
  parseNseOrIsoDate,
  NSE_ORIGIN,
} = require('./nse-option-history');

const INDEX_REPORT = `${NSE_ORIGIN}/reports-indices-historical-index-data`;
const INDEX_API = `${NSE_ORIGIN}/api/historicalOR/indicesHistory`;

function mapIndexRow(row) {
  if (!row || typeof row !== 'object') return null;
  const parsed = parseNseOrIsoDate(row.EOD_TIMESTAMP || row.TIMESTAMP);
  const open = Number(row.EOD_OPEN_INDEX_VAL);
  const high = Number(row.EOD_HIGH_INDEX_VAL);
  const low = Number(row.EOD_LOW_INDEX_VAL);
  const close = Number(row.EOD_CLOSE_INDEX_VAL);
  if (!parsed || ![open, high, low, close].every(Number.isFinite)) return null;
  return {
    date: parsed.iso,
    open,
    high,
    low,
    close,
    volume: Number(row.HIT_TRADED_QTY) || 0,
  };
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.data?.data)) return payload.data.data;
  return [];
}

async function fetchIndexChunk(indexType, fromIso, toIso) {
  await warmNseSession();
  const url =
    `${INDEX_API}?indexType=${encodeURIComponent(indexType)}` +
    `&from=${encodeURIComponent(ddmmyyyy(fromIso))}` +
    `&to=${encodeURIComponent(ddmmyyyy(toIso))}`;
  let res = await nseGet(url, {
    Referer: INDEX_REPORT,
    'X-Requested-With': 'XMLHttpRequest',
  });
  if (res.status === 401 || res.status === 403) {
    await nseGet(INDEX_REPORT, { Accept: 'text/html', Referer: `${NSE_ORIGIN}/` });
    await delay(300);
    res = await nseGet(url, {
      Referer: INDEX_REPORT,
      'X-Requested-With': 'XMLHttpRequest',
    });
  }
  if (res.status !== 200) {
    const err = new Error(`NSE indicesHistory HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  const payload = res.data;
  if (typeof payload === 'string' && /<!DOCTYPE|<html/i.test(payload)) {
    const err = new Error('NSE indicesHistory returned HTML (blocked)');
    err.status = 502;
    throw err;
  }
  if (payload && payload.error) {
    const err = new Error(payload.showMessage || 'NSE indicesHistory error');
    err.status = 400;
    throw err;
  }
  return extractRows(payload).map(mapIndexRow).filter(Boolean);
}

async function fetchIndexDaily(opts = {}) {
  const indexType = String(opts.indexType || 'NIFTY 50');
  const fromDate = String(opts.fromDate || '').slice(0, 10);
  const toDate = String(opts.toDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) {
    const err = new Error('fromDate and toDate (YYYY-MM-DD) required for index history');
    err.status = 400;
    throw err;
  }
  const fetchChunk = opts.fetchChunk || fetchIndexChunk;
  const bars = [];
  const seen = new Set();
  let cursor = fromDate;
  while (cursor <= toDate) {
    const end = addDaysIso(cursor, 90) > toDate ? toDate : addDaysIso(cursor, 90);
    const chunk = await fetchChunk(indexType, cursor, end);
    for (const bar of chunk) {
      if (seen.has(bar.date)) continue;
      seen.add(bar.date);
      bars.push(bar);
    }
    cursor = addDaysIso(end, 1);
    if (cursor <= toDate) await delay(200);
  }
  bars.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { indexType, fromDate, toDate, source: 'nse', interval: 'day', historical: bars };
}

module.exports = { fetchIndexDaily, mapIndexRow };
