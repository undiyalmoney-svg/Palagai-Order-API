'use strict';

/**
 * Research paper books — the same four the Charts desk watches.
 * These are index / futures prices, not the 50 cash shares.
 */
const { sessionDate } = require('./time');

const UNIVERSE_DATE = '2026-10-13';

const INDEX_BOOKS = [
  {
    exchange: 'NSE',
    symbol: 'NIFTY 50',
    name: 'Nifty 50',
    sector: 'nifty',
    instrumentToken: 256265,
    tickSize: 0.05,
    lotSize: 1,
    book: true,
  },
  {
    exchange: 'NSE',
    symbol: 'NIFTY BANK',
    name: 'Bank Nifty',
    sector: 'bank',
    instrumentToken: 260105,
    tickSize: 0.05,
    lotSize: 1,
    book: true,
  },
  {
    exchange: 'BSE',
    symbol: 'SENSEX',
    name: 'Sensex',
    sector: 'sensex',
    instrumentToken: 265,
    tickSize: 0.05,
    lotSize: 1,
    book: true,
  },
  {
    exchange: 'MCX',
    symbol: 'CRUDEOILM',
    name: 'Crude oil',
    sector: 'crude',
    instrumentToken: 0,
    tickSize: 0.1,
    lotSize: 1,
    book: true,
  },
];

function indexBooks(date = UNIVERSE_DATE) {
  return INDEX_BOOKS.map((row) => ({
    ...row,
    universeDate: date,
    eligible: true,
  }));
}

function isIndexBook(symbol) {
  const s = String(symbol || '').toUpperCase();
  return s === 'NIFTY 50' || s === 'NIFTY BANK' || s === 'SENSEX' || s.includes('CRUDE');
}

function sessionWindow(symbol) {
  if (/CRUDE/i.test(String(symbol || ''))) {
    return { open: 9 * 60, cutoff: 23 * 60, square: 23 * 60 + 25 };
  }
  return { open: 9 * 60 + 15, cutoff: 15 * 60, square: 15 * 60 + 15 };
}

function latestSquareMin() {
  return INDEX_BOOKS.reduce((max, row) => Math.max(max, sessionWindow(row.symbol).square), 0);
}

function splitCsvLine(line) {
  if (!String(line).includes('"')) return String(line).split(',');
  const out = [];
  let cur = '';
  let quoted = false;
  const text = String(line);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Next MCX Crude oil mini future. Skips the contract that expires today. */
function resolveCrudeContract(csv, asOf = new Date()) {
  const today = sessionDate(asOf);
  const rows = [];
  for (const line of String(csv || '').split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;
    const symbol = String(cols[2] || '').toUpperCase();
    const type = String(cols[9] || '').toUpperCase();
    const exchange = String(cols[11] || '').toUpperCase();
    if (exchange !== 'MCX' || type !== 'FUT' || !symbol.startsWith('CRUDEOILM')) continue;
    const expiry = String(cols[5] || '').trim().slice(0, 10);
    rows.push({
      instrumentToken: Number(cols[0]) || 0,
      tradingSymbol: String(cols[2] || '').trim(),
      expiry,
      tickSize: Number(cols[7]) || 0.1,
      lotSize: Number(cols[8]) || 1,
    });
  }
  rows.sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
  const next = rows.find((row) => !row.expiry || row.expiry > today);
  return next || rows.find((row) => !row.expiry || row.expiry >= today) || rows[0] || null;
}

/** @deprecated stock scan list — kept so old tests/import paths do not break. */
function nifty50(date = UNIVERSE_DATE) {
  return indexBooks(date);
}

module.exports = {
  UNIVERSE_DATE,
  INDEX_BOOKS,
  indexBooks,
  isIndexBook,
  sessionWindow,
  latestSquareMin,
  resolveCrudeContract,
  nifty50,
};
