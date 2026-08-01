/**
 * Kite market-data helpers for Server Live (additive).
 * Does not change /api/kite order controllers.
 */
const axios = require('axios');
const { config } = require('../config/env');

const client = axios.create({
  baseURL: config.kiteApiBaseUrl || 'https://api.kite.trade',
  timeout: 45_000,
  validateStatus: () => true,
});

function headers(authorization) {
  return {
    'X-Kite-Version': '3',
    Authorization: authorization,
  };
}

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

function parseInstrumentsCsv(csv) {
  const lines = String(csv || '').split(/\r?\n/);
  if (lines.length < 2) return [];
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
    // Keep desk-relevant rows only (memory on 512MB droplet).
    let keep = false;
    if (exchange === 'NFO' && (itype === 'CE' || itype === 'PE' || itype === 'FUT')) {
      if (sym.startsWith('BANKNIFTY') || name === 'BANKNIFTY' || sym.startsWith('NIFTY') || name === 'NIFTY') {
        keep = true;
      }
    } else if (exchange === 'MCX') {
      if (sym.startsWith('CRUDEOIL') || name.includes('CRUDE')) keep = true;
    } else if (exchange === 'NSE' && (itype === 'EQ' || itype === 'INDEX')) {
      if (sym === 'NIFTY 50' || sym === 'NIFTY BANK' || name === 'NIFTY 50' || name === 'NIFTY BANK') {
        keep = true;
      }
    }
    if (!keep) continue;
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

async function fetchInstruments(authorization) {
  const res = await client.get('/instruments', {
    headers: headers(authorization),
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  if (res.status >= 400) {
    throw new Error(`instruments HTTP ${res.status}`);
  }
  return parseInstrumentsCsv(res.data);
}

async function fetchHistorical5m(authorization, instrumentToken, fromDate, toDate) {
  const res = await client.get(`/instruments/historical/${instrumentToken}/5minute`, {
    headers: headers(authorization),
    params: { from: fromDate, to: toDate },
  });
  if (res.status >= 400 || res.data?.status === 'error') {
    throw new Error(
      res.data?.message || `historical HTTP ${res.status} token=${instrumentToken}`,
    );
  }
  const rows = res.data?.data?.candles || [];
  return rows.map((r) => ({
    date: String(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]) || 0,
  }));
}

async function fetchQuotes(authorization, keys) {
  if (!keys.length) return {};
  const res = await client.get('/quote', {
    headers: headers(authorization),
    params: { i: keys },
    paramsSerializer: (params) =>
      (params.i || []).map((k) => `i=${encodeURIComponent(k)}`).join('&'),
  });
  if (res.status >= 400 || res.data?.status === 'error') {
    throw new Error(res.data?.message || `quote HTTP ${res.status}`);
  }
  return res.data?.data || {};
}

module.exports = {
  fetchInstruments,
  fetchHistorical5m,
  fetchQuotes,
  parseInstrumentsCsv,
};
