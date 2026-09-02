/**
 * Kite market-data helpers for Server Live (additive).
 * Does not change /api/kite order controllers.
 */
const axios = require('axios');
const https = require('https');
const http = require('http');
const { config } = require('../config/env');

// Force IPv4: the droplet's IPv6 egress to api.kite.trade is broken, and Node's
// dual-stack (happy-eyeballs) can stall on the dead AAAA route (ETIMEDOUT).
const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });
const ipv4HttpAgent = new http.Agent({ family: 4, keepAlive: true });

const client = axios.create({
  baseURL: config.kiteApiBaseUrl || 'https://api.kite.trade',
  timeout: 45_000,
  validateStatus: () => true,
  httpsAgent: ipv4HttpsAgent,
  httpAgent: ipv4HttpAgent,
});

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * GET with retry for transient failures (connect timeouts / resets / 5xx / 429).
 * READ endpoints only — order placement is never retried (double-order risk).
 * Auth (401/403) and other 4xx are returned immediately (no retry).
 */
async function getWithRetry(url, opts, label = 'kite', retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await client.get(url, opts);
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`${label} HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastErr = err;
      const code = String(err.code || '');
      // EPIPE belongs here: a pooled keep-alive socket that the server closed
      // between requests fails the NEXT write with EPIPE, not ECONNRESET. Long
      // chunked history pulls (5-min candles need ~23 requests per symbol) hit
      // this reliably once Kite recycles the connection — it is transient by
      // definition, since the retry opens a fresh socket.
      const transient =
        /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EAI_AGAIN|ENETUNREACH|ENOTFOUND|EPIPE/.test(
          code,
        ) || /timeout/i.test(err.message || '');
      if (!transient) throw err;
    }
    if (attempt < retries) await delay(500 * attempt);
  }
  throw lastErr;
}

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
    // Keep desk rows only (memory on 512MB droplet) — Nifty 50 + Bank Nifty.
    // Other NIFTY-prefixed indices (FINNIFTY / MIDCPNIFTY / NIFTYNXT) are NOT
    // traded and must not leak into ATM resolution.
    let keep = false;
    const isBank = sym.startsWith('BANKNIFTY') || name === 'BANKNIFTY';
    const excluded =
      sym.startsWith('FINNIFTY') ||
      name === 'FINNIFTY' ||
      sym.startsWith('MIDCPNIFTY') ||
      name === 'MIDCPNIFTY' ||
      sym.startsWith('NIFTYNXT');
    if (exchange === 'NFO' && (itype === 'CE' || itype === 'PE' || itype === 'FUT')) {
      if (!excluded && (isBank || sym.startsWith('NIFTY') || name === 'NIFTY' || name === 'NIFTY 50')) {
        keep = true;
      }
    } else if (exchange === 'NSE' && (itype === 'EQ' || itype === 'INDEX')) {
      if (sym === 'NIFTY 50' || name === 'NIFTY 50' || sym === 'NIFTY BANK' || name === 'NIFTY BANK') {
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
  const res = await getWithRetry(
    '/instruments',
    {
      headers: headers(authorization),
      responseType: 'text',
      transformResponse: [(d) => d],
    },
    'instruments',
  );
  if (res.status >= 400) {
    throw new Error(`instruments HTTP ${res.status}`);
  }
  return parseInstrumentsCsv(res.data);
}

/** interval: 'minute' | '5minute' | '60minute' | 'day' etc (Kite Connect intervals). */
async function fetchHistoricalCandles(authorization, instrumentToken, fromDate, toDate, interval = '5minute') {
  const res = await getWithRetry(
    `/instruments/historical/${instrumentToken}/${interval}`,
    {
      headers: headers(authorization),
      params: { from: fromDate, to: toDate },
    },
    'historical',
  );
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

async function fetchHistorical5m(authorization, instrumentToken, fromDate, toDate) {
  return fetchHistoricalCandles(authorization, instrumentToken, fromDate, toDate, '5minute');
}

async function fetchQuotes(authorization, keys) {
  if (!keys.length) return {};
  const res = await getWithRetry(
    '/quote',
    {
      headers: headers(authorization),
      params: { i: keys },
      paramsSerializer: (params) =>
        (params.i || []).map((k) => `i=${encodeURIComponent(k)}`).join('&'),
    },
    'quote',
  );
  if (res.status >= 400 || res.data?.status === 'error') {
    throw new Error(res.data?.message || `quote HTTP ${res.status}`);
  }
  return res.data?.data || {};
}

module.exports = {
  fetchInstruments,
  fetchHistorical5m,
  fetchHistoricalCandles,
  fetchQuotes,
  parseInstrumentsCsv,
};
