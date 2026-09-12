'use strict';
/**
 * NSE charting 5-minute option OHLC (not Kite).
 *
 * Search: GET/POST https://charting.nseindia.com/v1/exchanges/symbolsDynamic
 * Bars:   GET/POST https://charting.nseindia.com/v1/charts/symbolHistoricalData
 */
const axios = require('axios');
const https = require('https');
const http = require('http');
const { delay } = require('./nse-option-history');

const CHARTING = 'https://charting.nseindia.com';
const SEARCH = `${CHARTING}/v1/exchanges/symbolsDynamic`;
const HIST = `${CHARTING}/v1/charts/symbolHistoricalData`;
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

const MONTH_CODE = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'O', 11: 'N', 12: 'D',
};
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

let session = { cookie: '', warmedAt: 0 };

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

function remember(res) {
  const sc = res.headers?.['set-cookie'];
  if (sc && sc.length) session.cookie = mergeCookies(session.cookie, sc);
}

function headers(extra = {}) {
  return {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: CHARTING,
    Referer: `${CHARTING}/`,
    ...(session.cookie ? { Cookie: session.cookie } : {}),
    ...extra,
  };
}

async function chartGet(url) {
  const res = await client.get(url, { headers: headers() });
  remember(res);
  return res;
}

async function chartPost(url, body) {
  const res = await client.post(url, body, {
    headers: headers({ 'Content-Type': 'application/json' }),
  });
  remember(res);
  return res;
}

async function warmCharting() {
  if (session.cookie && Date.now() - session.warmedAt < 8 * 60 * 1000) return;
  session.cookie = '';
  session.warmedAt = 0;
  const home = await chartGet(`${CHARTING}/`);
  if (home.status >= 400) {
    await chartGet('https://www.nseindia.com/');
  }
  session.warmedAt = Date.now();
  await delay(200);
}

function nseWeeklyOptionSymbol(root, expiryIso, strike, optionType) {
  const [y, mo, d] = String(expiryIso || '').slice(0, 10).split('-').map(Number);
  const k = String(optionType || '').toUpperCase() === 'CE' ? 'CE' : 'PE';
  const n = Math.round(Number(strike));
  if (!y || !mo || !d || !n) return '';
  const yy = String(y).slice(-2);
  const mc = MONTH_CODE[mo];
  const dd = String(d).padStart(2, '0');
  if (!mc) return '';
  return `${String(root || '').toUpperCase()}${yy}${mc}${dd}${n}${k}`;
}

function nseMonthlyOptionSymbol(root, expiryIso, strike, optionType) {
  const [y, mo, d] = String(expiryIso || '').slice(0, 10).split('-').map(Number);
  const k = String(optionType || '').toUpperCase() === 'CE' ? 'CE' : 'PE';
  const n = Math.round(Number(strike));
  if (!y || !mo || !n) return '';
  return `${String(root || '').toUpperCase()}${String(y).slice(-2)}${MONTH_ABBR[mo - 1]}${n}${k}`;
}

function nseOptIdxId(root, expiryIso, strike, optionType) {
  const [y, mo, d] = String(expiryIso || '').slice(0, 10).split('-');
  const k = String(optionType || '').toUpperCase() === 'CE' ? 'CE' : 'PE';
  const n = Math.round(Number(strike));
  if (!y || !mo || !d || !n) return '';
  return `OPTIDX${String(root || '').toUpperCase()}${d}-${mo}-${y}${k}${n}`;
}

function optionRootForBook(book) {
  return book?.key === 'banknifty' || book?.id === 'bank' ? 'BANKNIFTY' : 'NIFTY';
}

function istBarDate(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '';
  const epoch = t > 1e12 ? t : t * 1000;
  // Charting sends IST wall time as if it were UTC.
  const iso = new Date(epoch).toISOString();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!m) return '';
  const floored = Math.floor((Number(m[2]) * 60 + Number(m[3])) / 5) * 5;
  const hh = String(Math.floor(floored / 60)).padStart(2, '0');
  const mm = String(floored % 60).padStart(2, '0');
  return `${m[1]}T${hh}:${mm}:00+0530`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapChartBar(row) {
  if (Array.isArray(row)) {
    return mapChartBar({
      time: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5],
    });
  }
  if (!row || typeof row !== 'object') return null;
  const date = istBarDate(row.time ?? row.timestamp ?? row.t ?? row.datetime);
  const open = num(row.open ?? row.o);
  const high = num(row.high ?? row.h);
  const low = num(row.low ?? row.l);
  const close = num(row.close ?? row.c ?? row.ltp);
  if (!date || close == null || !(close > 0)) return null;
  return {
    date,
    open: open != null && open > 0 ? open : close,
    high: high != null && high > 0 ? high : close,
    low: low != null && low > 0 ? low : close,
    close,
    volume: num(row.volume ?? row.v) || 0,
  };
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.result)) return payload.result;
  if (payload && Array.isArray(payload.symbols)) return payload.symbols;
  return [];
}

function pickSearchHit(rows, want) {
  const list = extractList(rows);
  const u = String(want || '').toUpperCase();
  const isOpt = (r) => /option/i.test(String(r?.type || r?.symbolType || ''));
  const sym = (r) => String(r?.symbol || r?.tradingSymbol || '').toUpperCase();
  return list.find((r) => sym(r) === u && isOpt(r))
    || list.find((r) => sym(r) === u)
    || list.find(isOpt)
    || null;
}

async function searchOptionSymbol(query, deps = {}) {
  const get = deps.chartGet || chartGet;
  const post = deps.chartPost || chartPost;
  const warm = deps.warmCharting || warmCharting;
  await warm();
  const url = `${SEARCH}?symbol=${encodeURIComponent(query)}&segment=FO`;
  let res = await get(url);
  let hit = pickSearchHit(res.data, query);
  if (!hit) {
    res = await post(SEARCH, { symbol: query, segment: 'FO' });
    hit = pickSearchHit(res.data, query);
  }
  return hit;
}

function unixIst(isoDay, hm) {
  // Same naive-IST epoch the charting API stores on each bar.
  return Math.floor(Date.parse(`${isoDay}T${hm}Z`) / 1000);
}

async function fetchChartBars(hit, fromDate, toDate, deps = {}) {
  const get = deps.chartGet || chartGet;
  const post = deps.chartPost || chartPost;
  const token = String(hit.scripcode || hit.token || hit.scripCode || '');
  const symbol = String(hit.symbol || hit.tradingSymbol || '');
  const symbolType = String(hit.type || hit.symbolType || 'Options');
  if (!token || !symbol) return [];
  const fromSec = unixIst(fromDate, '09:00:00');
  const toSec = unixIst(toDate, '15:35:00');
  const qs =
    `${HIST}?fromDate=${fromSec}&toDate=${toSec}` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&token=${encodeURIComponent(token)}` +
    `&symbolType=${encodeURIComponent(symbolType)}` +
    `&chartType=I&timeInterval=5`;
  let res = await get(qs);
  let rows = extractList(res.data);
  if (!rows.length) {
    res = await post(HIST, {
      token,
      fromDate: fromSec,
      toDate: toSec,
      symbol,
      symbolType,
      chartType: 'I',
      timeInterval: 5,
    });
    rows = extractList(res.data);
  }
  const bars = rows.map(mapChartBar).filter(Boolean);
  bars.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return bars;
}

async function fetchOption5m(opts = {}, deps = {}) {
  const fromDate = String(opts.fromDate || '').slice(0, 10);
  const toDate = String(opts.toDate || fromDate).slice(0, 10);
  const wanted = [...new Set(
    [opts.tradingSymbol, ...(opts.symbols || [])]
      .map((s) => String(s || '').toUpperCase())
      .filter(Boolean),
  )];
  if (!wanted.length || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return [];
  const cache = opts.session;
  const cacheKey = `${wanted.join(',')}|${fromDate}|${toDate}`;
  if (cache?._nse5m instanceof Map && cache._nse5m.has(cacheKey)) return cache._nse5m.get(cacheKey);
  const search = deps.searchOptionSymbol || searchOptionSymbol;
  let bars = [];
  let used = wanted[0];
  for (const tradingSymbol of wanted) {
    const hit = await search(tradingSymbol, deps);
    if (!hit) continue;
    bars = await fetchChartBars(hit, fromDate, toDate, deps);
    if (bars.length) {
      used = tradingSymbol;
      break;
    }
  }
  if (cache) {
    if (!(cache._nse5m instanceof Map)) cache._nse5m = new Map();
    cache._nse5m.set(cacheKey, bars);
    cache._nse5mSymbol = used;
  }
  return bars;
}

function resetChartingSessionForTests() {
  session = { cookie: '', warmedAt: 0 };
}

module.exports = {
  nseWeeklyOptionSymbol,
  nseMonthlyOptionSymbol,
  nseOptIdxId,
  optionRootForBook,
  mapChartBar,
  pickSearchHit,
  searchOptionSymbol,
  fetchOption5m,
  fetchChartBars,
  resetChartingSessionForTests,
  CHARTING,
};
