'use strict';

const kiteMarket = require('../services/kite-market');
const { getIndex, listMembers, listIndices, BUCKETS, TRENDS } = require('./universe');
const { round, bucketForChange, trendFromDailies, breadth, trendCounts } = require('./trend');
const { PublicFeed } = require('./public-feed');

const QUOTES_TTL_MS = 25_000;
const DAILIES_TTL_MS = 30 * 60 * 1000;
const KITE_QUOTE_GAP_MS = 1100;
const KITE_HIST_GAP_MS = 400;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickQuote(map, kiteKey, symbol) {
  if (!map || typeof map !== 'object') return null;
  return map[kiteKey] || map[`NSE:${symbol}`] || map[`BSE:${symbol}`] || map[symbol] || null;
}

function quoteChange(q) {
  if (!q) {
    return { ltp: null, change: null, changePct: null, instrumentToken: 0, high52: null, low52: null };
  }
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
    high52: Number.isFinite(Number(q.high52)) ? Number(q.high52) : null,
    low52: Number.isFinite(Number(q.low52)) ? Number(q.low52) : null,
  };
}

class HeatmapService {
  constructor(opts = {}) {
    this.getAuthorization = opts.getAuthorization || (async () => null);
    this.fetchQuotes = opts.fetchQuotes || kiteMarket.fetchQuotes;
    this.fetchHistoricalCandles = opts.fetchHistoricalCandles || kiteMarket.fetchHistoricalCandles;
    this.publicFeed = opts.publicFeed || new PublicFeed({ chartGapMs: opts.warmGapMs });
    this.fetchPublicQuotes = opts.fetchPublicQuotes || ((index, members) => this.publicFeed.fetchQuotes(index, members));
    this.fetchPublicDailies = opts.fetchPublicDailies || ((yahoo) => this.publicFeed.fetchDailies(yahoo));
    this.now = opts.now || (() => Date.now());
    this.warmGapMs = Number.isFinite(opts.warmGapMs) ? opts.warmGapMs : 250;
    this.quotesCache = new Map();
    this.dailies = new Map();
    this.warming = new Map();
    this.lastError = null;
    this.lastSource = 'public';
    this._nextKiteQuote = 0;
    this._nextKiteHist = 0;
  }

  async snapshot(indexId) {
    const index = getIndex(indexId);
    const members = listMembers(index.id);
    const loaded = await this.loadQuotes(index, members);
    const quotes = loaded.quotes || {};
    const dailiesReady = this.dailiesReady(members);
    if (!dailiesReady) this.kickWarm(index, members, quotes);

    const indexQ = quoteChange(pickQuote(quotes, index.kiteKey, index.name));
    const companies = members.map((m) => this.rowFor(m, quotes));
    const warning = this.lastError
      ? `Market feed: ${this.lastError}`
      : dailiesReady
        ? null
        : 'Strong trends warm in the background from public daily candles.';

    return {
      public: true,
      indices: listIndices(),
      index: {
        id: index.id,
        name: index.name,
        ltp: round(indexQ.ltp, 2),
        change: round(indexQ.change, 2),
        changePct: round(indexQ.changePct, 2),
      },
      session: {
        ok: companies.some((c) => Number.isFinite(c.ltp)) || Number.isFinite(indexQ.ltp),
        dailiesReady,
        source: this.lastSource,
        message: loaded.message || undefined,
      },
      buckets: BUCKETS,
      trends: TRENDS,
      ...breadth(companies),
      trendCounts: trendCounts(companies),
      companies,
      warning,
      lastUpdatedAt: new Date(this.now()).toISOString(),
    };
  }

  async loadQuotes(index, members) {
    const cached = this.quotesCache.get(index.id);
    if (cached && this.now() - cached.at < QUOTES_TTL_MS) {
      this.lastSource = cached.source;
      this.lastError = null;
      return { quotes: cached.data };
    }

    try {
      const pub = await this.fetchPublicQuotes(index, members);
      const quotes = pub?.quotes || pub || {};
      const source = pub?.source || 'yahoo';
      if (quotes && Object.keys(quotes).length) {
        this.quotesCache.set(index.id, { at: this.now(), data: quotes, source });
        this.lastSource = source;
        this.lastError = null;
        return { quotes };
      }
    } catch (err) {
      this.lastError = err.message || String(err);
    }

    const kite = await this.loadKiteQuotes(index, members);
    if (kite) return kite;

    if (cached?.data) {
      this.lastSource = cached.source || 'cache';
      return { quotes: cached.data, message: this.lastError };
    }
    return { quotes: {}, message: this.lastError || 'No public quotes yet' };
  }

  async loadKiteQuotes(index, members) {
    const authorization = await this.getAuthorization();
    if (!authorization) return null;
    const wait = Math.max(0, this._nextKiteQuote - this.now());
    this._nextKiteQuote = Math.max(this.now(), this._nextKiteQuote) + KITE_QUOTE_GAP_MS;
    if (wait) await delay(wait);
    try {
      const keys = [index.kiteKey, ...members.map((m) => m.kiteKey)];
      const quotes = await this.fetchQuotes(authorization, keys);
      this.quotesCache.set(index.id, { at: this.now(), data: quotes || {}, source: 'kite' });
      this.lastSource = 'kite';
      this.lastError = this.lastError
        ? `${this.lastError} · using Kite (1 quote call / ${KITE_QUOTE_GAP_MS}ms)`
        : null;
      return { quotes: quotes || {} };
    } catch (err) {
      this.lastError = this.lastError || err.message || String(err);
      return null;
    }
  }

  rowFor(member, quotes) {
    const q = quoteChange(pickQuote(quotes, member.kiteKey, member.symbol));
    const daily = this.dailies.get(member.symbol);
    const trend = trendFromDailies(daily?.candles, q.ltp);
    const high52 = trend.high52 ?? q.high52;
    const low52 = trend.low52 ?? q.low52;
    return {
      symbol: member.symbol,
      name: member.name,
      sector: member.sector,
      mcapRank: member.mcapRank,
      ltp: round(q.ltp, 2),
      change: round(q.change, 2),
      changePct: round(q.changePct, 2),
      high52: round(high52, 2),
      low52: round(low52, 2),
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

  kickWarm(index, members, quotes) {
    const key = index.id;
    if (this.warming.get(key)) return this.warming.get(key);
    const job = this.warmDailies(index, members, quotes).finally(() => {
      this.warming.delete(key);
    });
    this.warming.set(key, job);
    return job;
  }

  async warmDailies(index, members, quotes) {
    const authorization = await this.getAuthorization();
    for (const m of members) {
      const cached = this.dailies.get(m.symbol);
      if (cached && this.now() - cached.at < DAILIES_TTL_MS && cached.candles?.length >= 50) continue;
      let candles = null;
      try {
        const pub = await this.fetchPublicDailies(m.yahoo || `${m.symbol}.NS`);
        candles = pub?.candles || null;
        if (pub?.quote) {
          const q = pickQuote(quotes, m.kiteKey, m.symbol);
          if (q && pub.quote.high52 != null) {
            q.high52 = pub.quote.high52;
            q.low52 = pub.quote.low52;
          }
        }
      } catch {
        candles = null;
      }
      if ((!candles || candles.length < 50) && authorization) {
        const q = quoteChange(pickQuote(quotes, m.kiteKey, m.symbol));
        const token = q.instrumentToken || 0;
        if (token) {
          const wait = Math.max(0, this._nextKiteHist - this.now());
          this._nextKiteHist = Math.max(this.now(), this._nextKiteHist) + KITE_HIST_GAP_MS;
          if (wait) await delay(wait);
          try {
            const to = new Date(this.now());
            const from = new Date(this.now());
            from.setUTCDate(from.getUTCDate() - 400);
            candles = await this.fetchHistoricalCandles(
              authorization,
              token,
              from.toISOString().slice(0, 10),
              to.toISOString().slice(0, 10),
              'day',
            );
          } catch {
            candles = candles || [];
          }
        }
      }
      this.dailies.set(m.symbol, { at: this.now(), candles: candles || [] });
      if (this.warmGapMs && !authorization) await delay(0);
    }
  }
}

module.exports = {
  HeatmapService,
  pickQuote,
  quoteChange,
  QUOTES_TTL_MS,
  DAILIES_TTL_MS,
  KITE_QUOTE_GAP_MS,
  KITE_HIST_GAP_MS,
};
