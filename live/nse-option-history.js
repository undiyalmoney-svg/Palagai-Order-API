'use strict';
/**
 * NSE website FO history for expired (and listed) option end-of-day OHLC.
 *
 * Public page: https://www.nseindia.com/report-detail/fo_eq_security
 * API: GET /api/historicalOR/foCPV
 *
 * This is daily OHLC + volume + OI only. NSE does not publish expired-option
 * 1m/5m candles on this API.
 */
const axios = require('axios');
const https = require('https');
const http = require('http');

const NSE_ORIGIN = 'https://www.nseindia.com';
const FO_REPORT = `${NSE_ORIGIN}/report-detail/fo_eq_security`;
const FO_CPV = `${NSE_ORIGIN}/api/historicalOR/foCPV`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });
const ipv4HttpAgent = new http.Agent({ family: 4, keepAlive: true });

const client = axios.create({
  timeout: 45_000,
  validateStatus: () => true,
  maxRedirects: 5,
  httpsAgent: ipv4HttpsAgent,
  httpAgent: ipv4HttpAgent,
});

const INDEX_UNDERLYINGS = new Set([
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'MIDCPNIFTY',
  'NIFTYNXT50',
]);

const MONTH_NAME = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

const MONTH_CODE = {
  1: 'JAN',
  2: 'FEB',
  3: 'MAR',
  4: 'APR',
  5: 'MAY',
  6: 'JUN',
  7: 'JUL',
  8: 'AUG',
  9: 'SEP',
  O: 'OCT',
  N: 'NOV',
  D: 'DEC',
};

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

let session = { cookie: '', warmedAt: 0 };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function centuryYear(yy) {
  const y = Number(yy);
  if (!Number.isFinite(y)) return null;
  return y >= 80 ? 1900 + y : 2000 + y;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatNseExpiry(year, monthIndex, day) {
  return `${pad2(day)}-${MONTH_ABBR[monthIndex]}-${year}`;
}

function isoFromParts(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function monthlyExpiryCandidates(year, monthIndex, underlying) {
  const u = String(underlying || '').toUpperCase();
  let weekdays = [4, 2, 3, 1, 5];
  if (u === 'FINNIFTY') weekdays = [2, 4, 1, 3, 5];
  if (u === 'MIDCPNIFTY') weekdays = [1, 4, 2, 3, 5];
  const out = [];
  const seen = new Set();
  for (const wd of weekdays) {
    const d = lastWeekdayOfMonth(year, monthIndex, wd);
    const key = formatNseExpiry(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      nse: key,
      iso: isoFromParts(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    });
  }
  return out;
}

function parseNseOrIsoDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const year = Number(iso[1]);
    const monthIndex = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    return {
      iso: `${iso[1]}-${iso[2]}-${iso[3]}`,
      nse: formatNseExpiry(year, monthIndex, day),
      year,
    };
  }
  const nse = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (nse) {
    const day = Number(nse[1]);
    const monthIndex = MONTH_NAME[nse[2].toUpperCase()];
    const year = Number(nse[3]);
    if (monthIndex == null) return null;
    return {
      iso: isoFromParts(year, monthIndex, day),
      nse: formatNseExpiry(year, monthIndex, day),
      year,
    };
  }
  const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]);
    const monthIndex = Number(dmy[2]) - 1;
    const year = Number(dmy[3]);
    return {
      iso: isoFromParts(year, monthIndex, day),
      nse: formatNseExpiry(year, monthIndex, day),
      year,
    };
  }
  return null;
}

function isoFromNseTimestamp(raw) {
  const parsed = parseNseOrIsoDate(raw);
  return parsed ? `${parsed.iso}T15:30:00+0530` : String(raw || '');
}

function parseOptionContract(tradingSymbol) {
  const raw = String(tradingSymbol || '')
    .trim()
    .toUpperCase()
    .replace(/^(NFO|BFO):/, '');
  const monthly =
    /^([A-Z]+)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+(?:\.\d+)?)(CE|PE)$/.exec(
      raw,
    );
  if (monthly) {
    const underlying = monthly[1];
    const year = centuryYear(monthly[2]);
    const monthIndex = MONTH_NAME[monthly[3]];
    const strike = Number(monthly[4]);
    const optionType = monthly[5];
    const candidates = monthlyExpiryCandidates(year, monthIndex, underlying);
    return {
      tradingSymbol: raw,
      underlying,
      instrumentType: INDEX_UNDERLYINGS.has(underlying) ? 'OPTIDX' : 'OPTSTK',
      optionType,
      strike,
      year,
      month: monthly[3],
      expiryStyle: 'monthly',
      expiryIso: candidates[0]?.iso || '',
      expiryNse: candidates[0]?.nse || '',
      expiryCandidates: candidates,
    };
  }
  const weekly = /^([A-Z]+)(\d{2})([1-9OND])(\d{2})(\d+(?:\.\d+)?)(CE|PE)$/.exec(raw);
  if (weekly) {
    const underlying = weekly[1];
    const year = centuryYear(weekly[2]);
    const monthAbbr = MONTH_CODE[weekly[3]];
    const monthIndex = MONTH_NAME[monthAbbr];
    const day = Number(weekly[4]);
    const strike = Number(weekly[5]);
    const optionType = weekly[6];
    return {
      tradingSymbol: raw,
      underlying,
      instrumentType: INDEX_UNDERLYINGS.has(underlying) ? 'OPTIDX' : 'OPTSTK',
      optionType,
      strike,
      year,
      month: monthAbbr,
      expiryStyle: 'weekly',
      expiryIso: isoFromParts(year, monthIndex, day),
      expiryNse: formatNseExpiry(year, monthIndex, day),
      expiryCandidates: [
        {
          nse: formatNseExpiry(year, monthIndex, day),
          iso: isoFromParts(year, monthIndex, day),
        },
      ],
    };
  }
  return null;
}

function isExpiredIso(iso, now = new Date()) {
  const day = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return day < today;
}

function ddmmyyyy(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

function addDaysIso(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function mapFoCpvRow(row) {
  if (!row || typeof row !== 'object') return null;
  const open = num(row.FH_OPENING_PRICE ?? row.OPEN ?? row.open);
  const high = num(row.FH_TRADE_HIGH_PRICE ?? row.HIGH ?? row.high);
  const low = num(row.FH_TRADE_LOW_PRICE ?? row.LOW ?? row.low);
  const close = num(row.FH_CLOSING_PRICE ?? row.CLOSE ?? row.close ?? row.FH_LAST_TRADED_PRICE);
  if (open == null && high == null && low == null && close == null) return null;
  return {
    date: isoFromNseTimestamp(row.FH_TIMESTAMP || row.TIMESTAMP || row.tradedDate),
    open,
    high,
    low,
    close,
    volume: num(row.FH_TOT_TRADED_QTY ?? row.VOLUME ?? row.volume) || 0,
    oi: num(row.FH_OPEN_INT ?? row.OI ?? row.oi) || 0,
  };
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.records)) return payload.records;
  if (payload && Array.isArray(payload.data?.data)) return payload.data.data;
  return [];
}

function mergeCookies(existing, setCookie) {
  const map = new Map();
  for (const part of String(existing || '').split(';')) {
    const bit = part.trim();
    if (!bit) continue;
    const i = bit.indexOf('=');
    if (i < 0) continue;
    map.set(bit.slice(0, i), bit.slice(i + 1));
  }
  for (const header of setCookie || []) {
    const pair = String(header).split(';')[0];
    const i = pair.indexOf('=');
    if (i < 0) continue;
    map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function rememberCookies(res) {
  const sc = res.headers?.['set-cookie'];
  if (sc && sc.length) session.cookie = mergeCookies(session.cookie, sc);
}

function nseHeaders(extraHeaders = {}) {
  return {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: extraHeaders.Accept || 'application/json, text/plain, */*',
    Connection: 'keep-alive',
    ...(session.cookie ? { Cookie: session.cookie } : {}),
    ...extraHeaders,
  };
}

async function nseGet(url, extraHeaders = {}) {
  const res = await client.get(url, { headers: nseHeaders(extraHeaders) });
  rememberCookies(res);
  return res;
}

async function warmNseSession() {
  if (session.cookie && Date.now() - session.warmedAt < 8 * 60 * 1000) return;
  session.cookie = '';
  session.warmedAt = 0;
  // Akamai often 403s the homepage; the FO report page is enough to mint cookies.
  const report = await nseGet(FO_REPORT, {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: `${NSE_ORIGIN}/`,
    'Upgrade-Insecure-Requests': '1',
  });
  if (report.status >= 400) {
    await nseGet(`${NSE_ORIGIN}/`, { Accept: 'text/html,application/xhtml+xml' });
    await delay(400);
    const retry = await nseGet(FO_REPORT, {
      Accept: 'text/html,application/xhtml+xml',
      Referer: `${NSE_ORIGIN}/`,
    });
    if (retry.status >= 400) {
      throw new Error(`NSE FO report HTTP ${retry.status}`);
    }
  }
  if (!session.cookie) {
    throw new Error('NSE did not set session cookies');
  }
  session.warmedAt = Date.now();
  await delay(300);
}

function foCpvUrl(params) {
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    instrumentType: params.instrumentType,
    symbol: params.symbol,
    year: String(params.year),
    expiryDate: params.expiryDate,
    optionType: params.optionType,
    strikePrice: String(params.strikePrice),
  });
  return `${FO_CPV}?${q.toString()}`;
}

async function fetchFoCpvOnce(params) {
  await warmNseSession();
  const url = foCpvUrl(params);
  let res = await nseGet(url, {
    Referer: FO_REPORT,
    'X-Requested-With': 'XMLHttpRequest',
  });
  if (res.status === 401 || res.status === 403) {
    session.cookie = '';
    session.warmedAt = 0;
    await warmNseSession();
    res = await nseGet(url, {
      Referer: FO_REPORT,
      'X-Requested-With': 'XMLHttpRequest',
    });
  }
  if (res.status !== 200) {
    const err = new Error(`NSE foCPV HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  const payload = res.data;
  if (typeof payload === 'string' && /<!DOCTYPE|<html/i.test(payload)) {
    const err = new Error('NSE foCPV returned HTML (blocked)');
    err.status = 502;
    throw err;
  }
  return extractRows(payload).map(mapFoCpvRow).filter(Boolean);
}

async function fetchFoCpvRange(params, fromIso, toIso) {
  const bars = [];
  const seen = new Set();
  let cursor = fromIso;
  while (cursor <= toIso) {
    const end = addDaysIso(cursor, 364) > toIso ? toIso : addDaysIso(cursor, 364);
    const chunk = await fetchFoCpvOnce({
      ...params,
      from: ddmmyyyy(cursor),
      to: ddmmyyyy(end),
    });
    for (const bar of chunk) {
      const k = bar.date;
      if (seen.has(k)) continue;
      seen.add(k);
      bars.push(bar);
    }
    cursor = addDaysIso(end, 1);
    if (cursor <= toIso) await delay(200);
  }
  bars.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return bars;
}

/**
 * Daily OHLC for one NSE F&O option contract (works for expired series).
 */
async function fetchExpiredOptionDayCandles(opts = {}, deps = {}) {
  const parsed = opts.parsed || parseOptionContract(opts.tradingSymbol);
  if (!parsed) {
    const err = new Error(`Cannot parse option symbol ${opts.tradingSymbol || ''}`);
    err.status = 400;
    throw err;
  }
  const fromDate = String(opts.fromDate || '').slice(0, 10);
  const toDate = String(opts.toDate || fromDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) {
    const err = new Error('fromDate and toDate (YYYY-MM-DD) required for NSE history');
    err.status = 400;
    throw err;
  }
  const override = parseNseOrIsoDate(opts.expiryDate || opts.expiry);
  const candidates = override
    ? [{ nse: override.nse, iso: override.iso }]
    : parsed.expiryCandidates;
  const fetchRange = deps.fetchFoCpvRange || fetchFoCpvRange;
  let lastError = null;
  for (const cand of candidates) {
    try {
      const historical = await fetchRange(
        {
          instrumentType: parsed.instrumentType,
          symbol: parsed.underlying,
          year: override?.year || parsed.year,
          expiryDate: cand.nse,
          optionType: parsed.optionType,
          strikePrice: parsed.strike,
        },
        fromDate,
        toDate,
      );
      if (historical.length) {
        return {
          source: 'nse',
          interval: 'day',
          note: 'NSE expired/listed option history is end-of-day OHLC (foCPV), not intraday.',
          parsed: { ...parsed, expiryIso: cand.iso, expiryNse: cand.nse },
          historical,
        };
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return {
    source: 'nse',
    interval: 'day',
    note: 'NSE expired/listed option history is end-of-day OHLC (foCPV), not intraday.',
    parsed,
    historical: [],
  };
}

function resetNseSessionForTests() {
  session = { cookie: '', warmedAt: 0 };
}

module.exports = {
  parseOptionContract,
  parseNseOrIsoDate,
  mapFoCpvRow,
  monthlyExpiryCandidates,
  isExpiredIso,
  fetchExpiredOptionDayCandles,
  fetchFoCpvRange,
  resetNseSessionForTests,
  INDEX_UNDERLYINGS,
  warmNseSession,
  nseGet,
  ddmmyyyy,
  addDaysIso,
  delay,
  NSE_ORIGIN,
};
