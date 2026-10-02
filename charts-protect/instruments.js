/**
 * Charts Protect instrument list — NFO Nifty/Bank options + MCX CRUDEOILM.
 * The shared kite-market parser drops MCX to save RAM; Protect needs Crude.
 */
'use strict';

const { fetchInstrumentsCsv } = require('../services/kite-market');

const CACHE_MS = 30 * 60 * 1000;
let cache = { at: 0, rows: [] };

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function keepRow(exchange, itype, sym, name) {
  const excluded =
    sym.startsWith('FINNIFTY') ||
    name === 'FINNIFTY' ||
    sym.startsWith('MIDCPNIFTY') ||
    name === 'MIDCPNIFTY' ||
    sym.startsWith('NIFTYNXT');
  if (exchange === 'NFO' && (itype === 'CE' || itype === 'PE' || itype === 'FUT')) {
    const isBank = sym.startsWith('BANKNIFTY') || name === 'BANKNIFTY';
    if (!excluded && (isBank || sym.startsWith('NIFTY') || name === 'NIFTY' || name === 'NIFTY 50')) {
      return true;
    }
  }
  if (exchange === 'MCX' && (itype === 'CE' || itype === 'PE' || itype === 'FUT')) {
    return sym.startsWith('CRUDEOILM');
  }
  if (exchange === 'NSE' && (itype === 'EQ' || itype === 'INDEX')) {
    return sym === 'NIFTY 50' || name === 'NIFTY 50' || sym === 'NIFTY BANK' || name === 'NIFTY BANK';
  }
  return false;
}

function parseChartInstrumentsCsv(csv) {
  const lines = String(csv || '').split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    const exchange = (cols[11] || '').trim().toUpperCase();
    const itype = (cols[9] || '').trim().toUpperCase();
    const sym = (cols[2] || '').trim().toUpperCase();
    const name = (cols[3] || '').trim().toUpperCase();
    if (!keepRow(exchange, itype, sym, name)) continue;
    out.push({
      instrumentToken: Number(cols[0]) || 0,
      exchangeToken: Number(cols[1]) || 0,
      tradingSymbol: (cols[2] || '').trim(),
      name: (cols[3] || '').trim(),
      lastPrice: Number(cols[4]) || 0,
      expiry: (cols[5] || '').trim(),
      strike: Number(cols[6]) || 0,
      tickSize: Number(cols[7]) || 0.05,
      lotSize: Number(cols[8]) || 1,
      instrumentType: itype,
      segment: (cols[10] || '').trim(),
      exchange,
    });
  }
  return out;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function expiryTime(instrument) {
  if (!instrument.expiry) return Number.MAX_SAFE_INTEGER;
  const time = new Date(instrument.expiry).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function resolveCrudeOilMiniFutures(instruments, asOf = new Date()) {
  const today = startOfDay(asOf);
  const pool = instruments
    .filter(
      (item) =>
        item.exchange === 'MCX' &&
        item.instrumentType === 'FUT' &&
        String(item.tradingSymbol || '')
          .toUpperCase()
          .startsWith('CRUDEOILM'),
    )
    .sort((left, right) => expiryTime(left) - expiryTime(right));
  const next = pool.find((item) => !item.expiry || startOfDay(new Date(item.expiry)) > today);
  if (next) return next;
  return pool.find((item) => !item.expiry || startOfDay(new Date(item.expiry)) >= today) || null;
}

async function loadChartInstruments(authorization, now = Date.now()) {
  if (cache.rows.length && now - cache.at < CACHE_MS) return cache.rows;
  const [nfo, mcx] = await Promise.all([
    fetchInstrumentsCsv(authorization, 'NFO'),
    fetchInstrumentsCsv(authorization, 'MCX'),
  ]);
  const rows = [...parseChartInstrumentsCsv(nfo), ...parseChartInstrumentsCsv(mcx)];
  cache = { at: now, rows };
  return rows;
}

function clearInstrumentCache() {
  cache = { at: 0, rows: [] };
}

const INDEX_TOKENS = {
  nifty: { token: 256265, symbol: 'NIFTY 50', exchange: 'NSE', quoteKey: 'NSE:NIFTY 50' },
  bank: { token: 260105, symbol: 'NIFTY BANK', exchange: 'NSE', quoteKey: 'NSE:NIFTY BANK' },
};

function resolveBookUnderlying(book, instruments, asOf) {
  if (book === 'nifty' || book === 'bank') return INDEX_TOKENS[book];
  const fut = resolveCrudeOilMiniFutures(instruments, asOf);
  if (!fut) return null;
  return {
    token: fut.instrumentToken,
    symbol: fut.tradingSymbol,
    exchange: 'MCX',
    quoteKey: `MCX:${fut.tradingSymbol}`,
  };
}

module.exports = {
  CACHE_MS,
  parseChartInstrumentsCsv,
  keepRow,
  resolveCrudeOilMiniFutures,
  loadChartInstruments,
  clearInstrumentCache,
  INDEX_TOKENS,
  resolveBookUnderlying,
};
