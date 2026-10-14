'use strict';

const kiteMarket = require('../services/kite-market');
const { INDEX, listNifty50, BUCKETS, TRENDS } = require('./universe');
const { round, bucketForChange, trendFromDailies, breadth, trendCounts } = require('./trend');

const QUOTES_TTL_MS = 25_000;
const DAILIES_TTL_MS = 30 * 60 * 1000;
const WARM_GAP_MS = 150;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function istDayOffset(days) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '01';
  const d = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pickQuote(map, kiteKey, symbol) {
  if (!map || typeof map !== 'object') return null;
  return map[kiteKey] || map[`NSE:${symbol}`] || map[symbol] || null;
}

function quoteChange(q) {
  if (!q) return { ltp: null, change: null, changePct: null, instrumentToken: 0 };
  const ltp = Number(q.last_price ?? q.lastPrice);
  const prev = Number(q.ohlc?.close);
  const net = Number(q.net_change ?? q.netChange);
  const change = Number.isFinite(prev) && Number.isFinite(ltp) ? ltp - prev : Number.isFinite(net) ? net : null;
  const changePct =
    Number.isFinite(change) && Number.isFinite(prev) && prev !== 0
      ? (change / prev) * 100
      : Number.isFinite(change) && Number.isFinite(ltp) && ltp - change !== 0
        ? (change / (ltp - change)) * 100
        : null;
  return {
    ltp: Number.isFinite(ltp) ? ltp : null,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    instrumentToken: Number(q.instrument_token ?? q.instrumentToken) || 0,
  };
}

class HeatmapService {
  constructor(opts = {}) {
    this.getAuthorization = opts.getAuthorization || (async () => null);
    this.fetchQuotes = opts.fetchQuotes || kiteMarket.fetchQuotes;
    this.fetchHistoricalCandles = opts.fetchHistoricalCandles || kiteMarket.fetchHistoricalCandles;
    this.now = opts.now || (() => Date.now());
    this.warmGapMs = Number.isFinite(opts.warmGapMs) ? opts.warmGapMs : WARM_GAP_MS;
    this.quotesCache = null;
    this.dailies = new Map();
    this.warming = null;
    this.lastError = null;
  }

  async snapshot() {
    const members = listNifty50();
    const authorization = await this.getAuthorization();
    if (!authorization) {
      return this.emptySnapshot(members, 'Heatmap waits for the desk Kite session. Quotes appear once the desk is connected.');
    }
    let quotes = this.quotesCache?.data;
    const quotesFresh = this.quotesCache && this.now() - this.quotesCache.at < QUOTES_TTL_MS;
    if (!quotesFresh) {
      try {
        const keys = [INDEX.kiteKey, ...members.map((m) => m.kiteKey)];
        quotes = await this.fetchQuotes(authorization, keys);
        this.quotesCache = { at: this.now(), data: quotes || {} };
        this.lastError = null;
      } catch (err) {
        this.lastError = err.message || String(err);
        quotes = this.quotesCache?.data || {};
      }
    }
    const dailiesReady = this.dailiesReady(members);
    if (!dailiesReady) this.kickWarm(authorization, members, quotes || {});

    const indexQ = quoteChange(pickQuote(quotes, INDEX.kiteKey, INDEX.name));
    const companies = members.map((m) => this.rowFor(m, quotes || {}));
    const warning = this.lastError
      ? `Market feed: ${this.lastError}`
      : dailiesReady
        ? null
        : 'Strong trends warm in the background from daily candles.';

    return {
      public: true,
      index: {
        id: INDEX.id,
        name: INDEX.name,
        ltp: round(indexQ.ltp, 2),
        change: round(indexQ.change, 2),
        changePct: round(indexQ.changePct, 2),
      },
      session: { ok: true, dailiesReady },
      buckets: BUCKETS,
      trends: TRENDS,
      ...breadth(companies),
      trendCounts: trendCounts(companies),
      companies,
      warning,
      lastUpdatedAt: new Date(this.now()).toISOString(),
    };
  }

  rowFor(member, quotes) {
    const q = quoteChange(pickQuote(quotes, member.kiteKey, member.symbol));
    const daily = this.dailies.get(member.symbol);
    const trend = trendFromDailies(daily?.candles, q.ltp);
    return {
      symbol: member.symbol,
      name: member.name,
      sector: member.sector,
      mcapRank: member.mcapRank,
      ltp: round(q.ltp, 2),
      change: round(q.change, 2),
      changePct: round(q.changePct, 2),
      high52: trend.high52,
      low52: trend.low52,
      ema20: trend.ema20,
      ema50: trend.ema50,
      adx: trend.adx,
      trend: trend.trend,
      trendLabel: trend.trendLabel,
      score: trend.score,
      bucket: bucketForChange(q.changePct),
    };
  }

  dailiesReady(members) {
    const ttl = DAILIES_TTL_MS;
    const now = this.now();
    let ready = 0;
    for (const m of members) {
      const row = this.dailies.get(m.symbol);
      if (row && now - row.at < ttl && Array.isArray(row.candles) && row.candles.length >= 50) ready += 1;
    }
    return members.length > 0 && ready >= Math.ceil(members.length * 0.8);
  }

  kickWarm(authorization, members, quotes) {
    if (this.warming) return this.warming;
    this.warming = this.warmDailies(authorization, members, quotes).finally(() => {
      this.warming = null;
    });
    return this.warming;
  }

  async warmDailies(authorization, members, quotes) {
    const from = istDayOffset(-400);
    const to = istDayOffset(0);
    for (const m of members) {
      const cached = this.dailies.get(m.symbol);
      if (cached && this.now() - cached.at < DAILIES_TTL_MS && cached.candles?.length >= 50) continue;
      const q = quoteChange(pickQuote(quotes, m.kiteKey, m.symbol));
      const token = q.instrumentToken || 0;
      if (!token) continue;
      try {
        const candles = await this.fetchHistoricalCandles(authorization, token, from, to, 'day');
        this.dailies.set(m.symbol, { at: this.now(), candles: candles || [] });
      } catch {
        if (!cached) this.dailies.set(m.symbol, { at: this.now(), candles: [] });
      }
      if (this.warmGapMs) await delay(this.warmGapMs);
    }
  }

  emptySnapshot(members, message) {
    const companies = members.map((m) => ({
      symbol: m.symbol,
      name: m.name,
      sector: m.sector,
      mcapRank: m.mcapRank,
      ltp: null,
      change: null,
      changePct: null,
      high52: null,
      low52: null,
      ema20: null,
      ema50: null,
      adx: null,
      trend: 'reading',
      trendLabel: 'Reading',
      score: 0,
      bucket: '1-to--1',
    }));
    return {
      public: true,
      index: { id: INDEX.id, name: INDEX.name, ltp: null, change: null, changePct: null },
      session: { ok: false, dailiesReady: false, message },
      buckets: BUCKETS,
      trends: TRENDS,
      advances: 0,
      declines: 0,
      unchanged: 0,
      trendCounts: trendCounts(companies),
      companies,
      warning: message,
      lastUpdatedAt: new Date(this.now()).toISOString(),
    };
  }
}

module.exports = { HeatmapService, pickQuote, quoteChange, QUOTES_TTL_MS, DAILIES_TTL_MS };
