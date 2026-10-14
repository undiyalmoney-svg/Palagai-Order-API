'use strict';

/**
 * Public market feed for the heatmap (no Kite token, any egress IP).
 *
 * Yahoo Finance spark/chart is the stock tape. Groww index OHLC is the
 * Nifty / Bank Nifty / Sensex header. Kite stays a last-resort fallback
 * in service.js and is rate-limited there.
 */

const https = require('https');
const http = require('http');
const axios = require('axios');

const ipv4HttpsAgent = new https.Agent({ family: 4, keepAlive: true });
const ipv4HttpAgent = new http.Agent({ family: 4, keepAlive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const client = axios.create({
  timeout: 20_000,
  validateStatus: () => true,
  httpsAgent: ipv4HttpsAgent,
  httpAgent: ipv4HttpAgent,
  headers: {
    'User-Agent': UA,
    Accept: 'application/json,text/plain,*/*',
  },
});

const SPARK_URL = 'https://query1.finance.yahoo.com/v7/finance/spark';
const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SPARK_BATCH = 20;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toQuote({ ltp, change, changePct, prev, high52, low52, instrumentToken }) {
  return {
    last_price: ltp,
    net_change: change,
    ohlc: { close: prev },
    high52: high52 ?? null,
    low52: low52 ?? null,
    instrument_token: instrumentToken || 0,
  };
}

function fromPricePct(ltp, changePct, prevHint) {
  const px = num(ltp);
  const pct = num(changePct);
  let prev = num(prevHint);
  if (!Number.isFinite(prev) && Number.isFinite(px) && Number.isFinite(pct) && pct !== -100) {
    prev = px / (1 + pct / 100);
  }
  const change = Number.isFinite(px) && Number.isFinite(prev) ? px - prev : null;
  const outPct =
    Number.isFinite(pct)
      ? pct
      : Number.isFinite(change) && Number.isFinite(prev) && prev !== 0
        ? (change / prev) * 100
        : null;
  return { ltp: px, change, changePct: outPct, prev };
}

function parseSparkResult(row) {
  const symbol = row?.symbol;
  const resp = (row?.response || [])[0] || {};
  const meta = resp.meta || {};
  const closes = ((resp.indicators?.quote || [])[0]?.close || []).filter((v) => v != null);
  const ltp = num(meta.regularMarketPrice) ?? num(closes.at(-1));
  const pct = num(meta.regularMarketChangePercent);
  const prevHint = closes.length >= 2 ? num(closes.at(-2)) : num(meta.chartPreviousClose);
  const pack = fromPricePct(ltp, pct, prevHint);
  return {
    symbol,
    quote: toQuote({
      ...pack,
      high52: num(meta.fiftyTwoWeekHigh),
      low52: num(meta.fiftyTwoWeekLow),
    }),
  };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function encodeQuery(params) {
  return Object.entries(params || {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
    .join('&');
}

async function defaultGetJson(url, params) {
  const res = await client.get(url, {
    params,
    paramsSerializer: encodeQuery,
  });
  if (res.status >= 400) {
    throw new Error(`public feed HTTP ${res.status} ${url}`);
  }
  return res.data;
}

function parseGrowwIndex(data) {
  if (!data || typeof data !== 'object') return null;
  const ltp = num(data.value ?? data.ltp ?? data.indexIndicativePrice);
  const prev = num(data.close);
  const pack = fromPricePct(ltp, data.dayChangePerc, prev);
  if (!Number.isFinite(pack.ltp)) return null;
  if (Number.isFinite(data.dayChange) && !Number.isFinite(pack.change)) pack.change = num(data.dayChange);
  return toQuote({
    ...pack,
    high52: num(data.yearHighPrice ?? data.yearHigh),
    low52: num(data.yearLowPrice ?? data.yearLow),
  });
}

function parseYahooChart(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) return { quote: null, candles: [] };
  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const q = (result.indicators?.quote || [])[0] || {};
  const candles = [];
  for (let i = 0; i < ts.length; i += 1) {
    const close = num(q.close?.[i]);
    if (!Number.isFinite(close)) continue;
    candles.push({
      date: new Date(ts[i] * 1000).toISOString(),
      open: num(q.open?.[i]) ?? close,
      high: num(q.high?.[i]) ?? close,
      low: num(q.low?.[i]) ?? close,
      close,
      volume: num(q.volume?.[i]) || 0,
    });
  }
  const pack = fromPricePct(
    meta.regularMarketPrice ?? candles.at(-1)?.close,
    meta.regularMarketChangePercent,
    candles.length >= 2 ? candles[candles.length - 2].close : meta.chartPreviousClose,
  );
  return {
    quote: toQuote({
      ...pack,
      high52: num(meta.fiftyTwoWeekHigh),
      low52: num(meta.fiftyTwoWeekLow),
    }),
    candles,
  };
}

class PublicFeed {
  constructor(opts = {}) {
    this.getJson = opts.getJson || defaultGetJson;
    this.chartGapMs = Number.isFinite(opts.chartGapMs) ? opts.chartGapMs : 250;
    this._nextChart = 0;
  }

  async fetchIndexGroww(index) {
    if (!index?.growwUrl) return null;
    const data = await this.getJson(index.growwUrl);
    return parseGrowwIndex(data);
  }

  async fetchSpark(symbols) {
    const map = {};
    if (!symbols.length) return map;
    for (const batch of chunk(symbols, SPARK_BATCH)) {
      try {
        const data = await this.getJson(SPARK_URL, {
          symbols: batch.join(','),
          range: '5d',
          interval: '1d',
        });
        const rows = data?.spark?.result || [];
        for (const row of rows) {
          const parsed = parseSparkResult(row);
          if (parsed.symbol) map[parsed.symbol] = parsed.quote;
        }
      } catch {
        // One Yahoo batch failing must not drop the rest of the index.
      }
    }
    return map;
  }

  async fetchQuotes(index, members) {
    const yahooSymbols = [index.yahoo, ...members.map((m) => m.yahoo || `${m.symbol}.NS`)];
    let spark = {};
    let sparkErr = null;
    try {
      spark = await this.fetchSpark(yahooSymbols);
    } catch (err) {
      sparkErr = err.message || String(err);
    }

    let groww = null;
    try {
      groww = await this.fetchIndexGroww(index);
    } catch {
      groww = null;
    }

    const quotes = {};
    const indexQuote = groww || spark[index.yahoo] || null;
    if (indexQuote) quotes[index.kiteKey] = indexQuote;
    if (spark[index.yahoo] && !quotes[index.kiteKey]) quotes[index.kiteKey] = spark[index.yahoo];

    for (const m of members) {
      const y = m.yahoo || `${m.symbol}.NS`;
      if (spark[y]) quotes[m.kiteKey] = spark[y];
    }

    const filled = Object.keys(quotes).length;
    if (!filled) {
      throw new Error(sparkErr || 'Public Yahoo/Groww feed returned no quotes');
    }
    return {
      quotes,
      source: groww ? 'groww+yahoo' : 'yahoo',
    };
  }

  async fetchDailies(yahooSymbol) {
    const now = Date.now();
    const wait = Math.max(0, this._nextChart - now);
    this._nextChart = Math.max(now, this._nextChart) + this.chartGapMs;
    if (wait) await delay(wait);
    const data = await this.getJson(`${CHART_URL}/${encodeURIComponent(yahooSymbol)}`, {
      interval: '1d',
      range: '1y',
    });
    return parseYahooChart(data);
  }
}

module.exports = {
  PublicFeed,
  parseSparkResult,
  parseGrowwIndex,
  parseYahooChart,
  fromPricePct,
  encodeQuery,
  SPARK_BATCH,
};
