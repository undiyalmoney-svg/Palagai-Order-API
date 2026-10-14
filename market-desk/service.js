'use strict';

const { listNifty50 } = require('../heatmap/universe');
const { CRUDE, deskIndices } = require('./universe');
const { resolveCrudeContract } = require('../research/universe');
const { round } = require('../research/indicators');
const { DEFAULTS, normalizeSettings } = require('./settings');
const { KiteMarketProvider } = require('./provider');
const { DeskTicker } = require('./ticker');
const { demoSnapshot } = require('./demo');
const { evaluate } = require('./backtest');
const {
  deskSessionStatus,
  formatIst,
  analyzeTimeframe,
  combineScore,
  detectBreakout,
  setupFrom,
  isAuthError,
  splitForming,
} = require('./engine');

const CRUDE_TTL_MS = 6 * 60 * 60 * 1000;

const HIST_TTL = {
  '5minute': 4 * 60_000,
  '15minute': 8 * 60_000,
  '60minute': 12 * 60_000,
  day: 30 * 60_000,
};

const HIST_LOOKBACK_DAYS = {
  '5minute': 10,
  '15minute': 20,
  '60minute': 60,
  day: 400,
};

const STALE_MS = 20_000;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickQuote(map, kiteKey, symbol) {
  if (!map || typeof map !== 'object') return null;
  return (
    map[kiteKey] ||
    map[`NSE:${symbol}`] ||
    map[`BSE:${symbol}`] ||
    map[`MCX:${symbol}`] ||
    map[symbol] ||
    null
  );
}

function quoteChange(q) {
  if (!q) return { ltp: null, change: null, changePct: null, instrumentToken: 0, volume: null };
  const ltp = Number(q.last_price ?? q.lastPrice ?? q.price);
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
    volume: Number.isFinite(Number(q.volume)) ? Number(q.volume) : null,
    at: q.at || null,
  };
}

function isoDaysAgo(nowMs, days) {
  const d = new Date(nowMs);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoToday(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

class MarketDeskService {
  constructor(opts = {}) {
    this.provider = opts.provider || new KiteMarketProvider(opts);
    this.getSessionAuthorization = opts.getSessionAuthorization || (async () => null);
    this.now = opts.now || (() => Date.now());
    this.WebSocketImpl = opts.WebSocketImpl || null;
    this.quoteTtlMs = Number.isFinite(opts.quoteTtlMs) ? opts.quoteTtlMs : 2_000;
    this.histGapMs = Number.isFinite(opts.histGapMs) ? opts.histGapMs : 350;
    this.quoteCache = new Map();
    this.histCache = new Map();
    this.tickers = new Map();
    this.warming = new Map();
    this.alertSeen = new Map();
    this._histChain = Promise.resolve();
    this.crudeInst = { ...CRUDE };
    this.crudeAt = 0;
  }

  async resolveAuth(userId, header) {
    const fromHeader = String(header || '').trim();
    if (/^token\s+[^:\s]+:\S+/i.test(fromHeader)) return fromHeader;
    if (!userId) return null;
    try {
      return (await this.getSessionAuthorization(userId)) || null;
    } catch {
      return null;
    }
  }

  universe() {
    return { indices: deskIndices(this.crudeInst), stocks: listNifty50() };
  }

  bookKind(row) {
    return row?.exchange === 'MCX' || row?.id === 'CRUDEOILM' ? 'crude' : 'cash';
  }

  async refreshCrude(authorization) {
    const nowMs = this.now();
    if (this.crudeInst.kiteToken && nowMs - this.crudeAt < CRUDE_TTL_MS) return this.crudeInst;
    try {
      const csv = await this.provider.instrumentsCsv(authorization, 'MCX');
      const hit = resolveCrudeContract(csv, new Date(nowMs));
      if (hit?.instrumentToken && hit.tradingSymbol) {
        this.crudeInst = {
          ...CRUDE,
          kiteKey: `MCX:${hit.tradingSymbol}`,
          kiteToken: Number(hit.instrumentToken) || 0,
          contract: hit.tradingSymbol,
        };
        this.crudeAt = nowMs;
      }
    } catch {
      // Card still renders; quotes/history stay WAIT until the dump lands.
    }
    return this.crudeInst;
  }

  async snapshot({ userId, authorization, settings: raw } = {}) {
    const settings = normalizeSettings(raw || DEFAULTS);
    const nowMs = this.now();
    const now = new Date(nowMs);
    const auth = await this.resolveAuth(userId, authorization);
    if (!auth) {
      return demoSnapshot(now, settings);
    }

    await this.refreshCrude(auth);

    let quotes;
    let quoteError = null;
    try {
      quotes = await this.loadQuotes(userId, auth);
    } catch (err) {
      if (isAuthError(err)) {
        return {
          ...demoSnapshot(now, settings),
          demo: false,
          needsReauth: true,
          warning: 'Kite session expired. Open Get Token to reconnect.',
          session: {
            ...deskSessionStatus(now),
            istNow: formatIst(now),
            lastUpdateAt: now.toISOString(),
            lastTickAt: null,
            lastConfirmedCandleAt: null,
            connection: 'disconnected',
            freshness: 'missing',
            timeframe: '15minute',
            message: 'Kite session expired. Open Get Token to reconnect.',
          },
        };
      }
      quoteError = err.message || String(err);
      quotes = this.quoteCache.get(userId)?.data || {};
    }

    const { indices, stocks } = this.universe();
    this.kickTicker(userId, auth, quotes, indices, stocks);
    this.kickWarm(userId, auth, quotes, indices, stocks);

    const ticker = this.tickers.get(userId);
    const tickStatus = ticker ? ticker.status() : { connected: false, stale: true, lastTickAt: null };

    const indexCards = indices.map((idx) => this.buildIndex(idx, quotes, settings, now));
    const tiles = stocks.map((m) => this.buildStock(m, quotes, settings, now));
    const breadth = this.buildBreadth(indexCards[0], tiles);
    const setups = [];
    const alerts = [];
    for (const card of indexCards) {
      if (card.setup) setups.push(card.setup);
      alerts.push(...(card.alerts || []));
    }
    for (const row of tiles) {
      if (row.setup) setups.push(row.setup);
      alerts.push(...(row.alerts || []));
    }

    const lastCandle = [...indexCards, ...tiles]
      .map((r) => r.lastCandleAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    const lastTickAt = tickStatus.lastTickAt || this.quoteCache.get(userId)?.atIso || null;
    const sess = deskSessionStatus(now);
    const tickAge = lastTickAt ? nowMs - new Date(lastTickAt).getTime() : Infinity;
    const freshness = !lastTickAt && !indexCards.some((c) => Number.isFinite(c.ltp))
      ? 'missing'
      : sess.open && tickAge > STALE_MS
        ? 'stale'
        : 'fresh';
    const connection = tickStatus.connected ? 'live' : quoteError ? 'disconnected' : 'polling';

    if (freshness === 'stale' || connection === 'disconnected') {
      alerts.push({
        type: 'stale',
        provisional: true,
        symbol: 'DESK',
        message: quoteError || 'Market data is stale or disconnected.',
      });
    }

    const holiday =
      sess.open &&
      lastCandle &&
      lastCandle.slice(0, 10) !== sess.day &&
      !indexCards.some((c) => Number.isFinite(c.changePct));

    return {
      private: true,
      demo: false,
      needsReauth: false,
      settings,
      session: {
        ...sess,
        status: holiday ? 'holiday' : sess.status,
        label: holiday ? 'Holiday / no session' : sess.label,
        istNow: formatIst(now),
        lastUpdateAt: now.toISOString(),
        lastTickAt,
        lastConfirmedCandleAt: lastCandle || null,
        connection,
        freshness,
        timeframe: '15minute',
        message: quoteError || tickStatus.lastError || (freshness === 'stale' ? 'Last tick is stale.' : null),
      },
      indices: indexCards.map(stripInternal),
      stocks: tiles.map(stripInternal),
      breadth,
      setups: setups.filter(Boolean).slice(0, 12),
      alerts: this.dedupeAlerts(userId, alerts, settings),
      warning: quoteError || null,
    };
  }

  async candles({ userId, authorization, symbol, interval }) {
    const auth = await this.resolveAuth(userId, authorization);
    if (!auth) {
      return { demo: true, candles: [], message: 'DEMO MODE — connect Kite for historical candles.' };
    }
    const iv = ['5minute', '15minute', '60minute', 'day'].includes(interval) ? interval : '15minute';
    await this.refreshCrude(auth);
    const inst = this.findInstrument(symbol);
    if (!inst) return { candles: [], message: 'Unknown symbol' };
    const quotes = this.quoteCache.get(userId)?.data || {};
    const token = this.tokenFor(inst, quotes);
    if (!token) return { candles: [], message: 'Instrument token is not loaded yet. Wait for a quote refresh.' };
    try {
      const rows = await this.history(auth, token, iv);
      const settings = normalizeSettings(DEFAULTS);
      const now = new Date(this.now());
      const kind = this.bookKind(inst);
      const tf = analyzeTimeframe(rows, iv, settings, now, kind);
      const br = detectBreakout(rows, iv, settings, now, kind);
      return {
        demo: false,
        symbol: inst.symbol || inst.id,
        interval: iv,
        candles: rows,
        overlay: {
          emaFast: tf.emaFast,
          emaSlow: tf.emaSlow,
          vwap: tf.vwap,
          adx: tf.adx,
          support: br.support,
          resistance: br.resistance,
          pivots: tf.pivots || [],
          breakout: br,
          lastCandleAt: tf.lastCandleAt,
          forming: tf.forming,
        },
      };
    } catch (err) {
      if (isAuthError(err)) {
        return { candles: [], needsReauth: true, message: 'Kite session expired. Open Get Token.' };
      }
      return { candles: [], message: err.message || 'Historical data is unavailable.' };
    }
  }

  async backtest({ userId, authorization, symbol, interval }) {
    const pack = await this.candles({ userId, authorization, symbol, interval: interval || '15minute' });
    if (!pack.candles?.length) return { ...pack, result: null };
    const iv = pack.interval || '15minute';
    const result = evaluate({ [iv]: pack.candles });
    return { symbol: pack.symbol, interval: iv, result };
  }

  findInstrument(symbol) {
    const want = String(symbol || '').toUpperCase().replace(/[\s-]/g, '');
    const desks = this.universe().indices;
    const idx = desks.find(
      (i) => i.id === want || String(i.name || '').replace(/\s/g, '').toUpperCase() === want || String(i.contract || '').replace(/[\s-]/g, '').toUpperCase() === want,
    );
    if (idx) return { ...idx, symbol: idx.id, kind: 'index' };
    const aliases = {
      NIFTY: 'NIFTY50',
      NIFTY50: 'NIFTY50',
      BANKNIFTY: 'BANKNIFTY',
      SENSEX: 'SENSEX',
      CRUDE: 'CRUDEOILM',
      CRUDEOIL: 'CRUDEOILM',
      CRUDEOILM: 'CRUDEOILM',
      CRUDEOILMINI: 'CRUDEOILM',
    };
    const mapped = aliases[want];
    if (mapped) {
      const hit = desks.find((i) => i.id === mapped);
      if (hit) return { ...hit, symbol: hit.id, kind: 'index' };
    }
    return listNifty50().find((s) => s.symbol === String(symbol || '').toUpperCase()) || null;
  }

  tokenFor(inst, quotes) {
    if (inst.kiteToken) return Number(inst.kiteToken) || 0;
    const q = pickQuote(quotes, inst.kiteKey, inst.symbol);
    return quoteChange(q).instrumentToken;
  }

  buildIndex(idx, quotes, settings, now) {
    const q = quoteChange(pickQuote(quotes, idx.kiteKey, idx.id) || pickQuote(quotes, idx.kiteKey, idx.name));
    return this.decorate(
      {
        id: idx.id,
        name: idx.name,
        symbol: idx.id,
        kiteKey: idx.kiteKey,
        exchange: idx.exchange || (idx.id === 'CRUDEOILM' ? 'MCX' : 'NSE'),
        sector: idx.id === 'CRUDEOILM' ? 'CRUDE' : 'INDEX',
        ltp: round(q.ltp, idx.id === 'CRUDEOILM' ? 1 : 2),
        change: round(q.change, idx.id === 'CRUDEOILM' ? 1 : 2),
        changePct: round(q.changePct, 2),
        instrumentToken: q.instrumentToken || idx.kiteToken,
        contract: idx.contract || null,
      },
      settings,
      now,
    );
  }

  buildStock(member, quotes, settings, now) {
    const q = quoteChange(pickQuote(quotes, member.kiteKey, member.symbol));
    return this.decorate(
      {
        id: member.symbol,
        name: member.name,
        symbol: member.symbol,
        kiteKey: member.kiteKey,
        sector: member.sector,
        ltp: round(q.ltp, 2),
        change: round(q.change, 2),
        changePct: round(q.changePct, 2),
        instrumentToken: q.instrumentToken,
      },
      settings,
      now,
    );
  }

  histKey(token, interval) {
    return `${token}:${interval}`;
  }

  candlesFor(token, interval) {
    if (!token) return [];
    return this.histCache.get(this.histKey(token, interval))?.candles || [];
  }

  decorate(row, settings, now) {
    const token = row.instrumentToken;
    const kind = this.bookKind(row);
    const c15 = this.candlesFor(token, '15minute');
    const c60 = this.candlesFor(token, '60minute');
    const cDay = this.candlesFor(token, 'day');
    const tf15 = c15.length ? analyzeTimeframe(c15, '15minute', settings, now, kind) : { missing: true, trend: 'insufficient' };
    const tf60 = c60.length ? analyzeTimeframe(c60, '60minute', settings, now, kind) : { missing: true, trend: 'insufficient' };
    const tfDay = cDay.length ? analyzeTimeframe(cDay, 'day', settings, now, kind) : { missing: true, trend: 'insufficient' };
    const combined = combineScore(tf15, tf60, tfDay, settings);
    const br15 = c15.length
      ? detectBreakout(c15, '15minute', settings, now, kind)
      : { status: 'insufficient', direction: null, interval: '15minute' };
    const br60 = c60.length
      ? detectBreakout(c60, '60minute', settings, now, kind)
      : { status: 'insufficient', direction: null, interval: '60minute' };
    const agree =
      br15.direction &&
      br15.direction === br60.direction &&
      (br15.status === 'confirmed' || br15.status === 'potential') &&
      (br60.status === 'confirmed' || br60.status === 'potential');
    const conflict =
      br15.direction && br60.direction && br15.direction !== br60.direction && br15.status !== 'none' && br60.status !== 'none';
    const last15 = splitForming(c15, '15minute', now, kind);
    const ema20 = tfDay.emaFast ?? tf15.emaFast;
    const ema50 = tfDay.emaSlow ?? tf15.emaSlow;
    const close = row.ltp ?? tf15.close;
    const setup = setupFrom(row, br15, br60, combined);
    const alerts = alertsFor(row.symbol, br15, br60, combined);
    return {
      ...row,
      bias: combined.bias,
      biasLabel: combined.label,
      confirmed: combined.confirmed,
      score: combined.score,
      strength: tf15.strength || tf60.strength || 'insufficient',
      strengthLabel: tf15.strengthLabel || 'Insufficient data',
      parts: combined.parts,
      agreement: combined.agreement,
      m15Trend: combined.m15Trend,
      h1Trend: combined.h1Trend,
      dayTrend: combined.dayTrend,
      breakout15: publicBreakout(br15),
      breakout60: publicBreakout(br60),
      breakoutAgree: Boolean(agree),
      breakoutConflict: Boolean(conflict),
      aboveEma20: Number.isFinite(close) && Number.isFinite(ema20) ? close > ema20 : null,
      aboveEma50: Number.isFinite(close) && Number.isFinite(ema50) ? close > ema50 : null,
      lastCandleAt: last15.completed.at(-1)?.date || tf15.lastCandleAt || null,
      lastFormingAt: last15.forming?.date || null,
      setup,
      alerts,
    };
  }

  buildBreadth(niftyCard, tiles) {
    let advances = 0;
    let declines = 0;
    let unchanged = 0;
    let above20 = 0;
    let above50 = 0;
    let have20 = 0;
    let have50 = 0;
    const sectors = new Map();
    for (const t of tiles) {
      if (!Number.isFinite(t.changePct)) continue;
      if (t.changePct > 0.05) advances += 1;
      else if (t.changePct < -0.05) declines += 1;
      else unchanged += 1;
      if (t.aboveEma20 != null) {
        have20 += 1;
        if (t.aboveEma20) above20 += 1;
      }
      if (t.aboveEma50 != null) {
        have50 += 1;
        if (t.aboveEma50) above50 += 1;
      }
      const sec = t.sector || 'OTHER';
      const bucket = sectors.get(sec) || { sector: sec, n: 0, sum: 0 };
      bucket.n += 1;
      bucket.sum += t.changePct;
      sectors.set(sec, bucket);
    }
    const ranked = [...tiles].filter((t) => Number.isFinite(t.changePct)).sort((a, b) => b.changePct - a.changePct);
    const adRatio = declines === 0 ? null : Math.round((advances / declines) * 100) / 100;
    const indexUp = Number.isFinite(niftyCard?.changePct) && niftyCard.changePct > 0.15;
    const indexDown = Number.isFinite(niftyCard?.changePct) && niftyCard.changePct < -0.15;
    let divergence = null;
    if (indexUp && declines > advances) divergence = 'Index up while most Nifty 50 stocks are declining';
    if (indexDown && advances > declines) divergence = 'Index down while most Nifty 50 stocks are advancing';
    return {
      advances,
      declines,
      unchanged,
      adRatio,
      adRatioLabel: declines === 0 ? (advances > 0 ? '∞' : 'n/a') : String(adRatio),
      pctAboveEma20: have20 ? Math.round((above20 / have20) * 1000) / 10 : null,
      pctAboveEma50: have50 ? Math.round((above50 / have50) * 1000) / 10 : null,
      strongest: ranked.slice(0, 3).map((s) => ({ symbol: s.symbol, changePct: s.changePct })),
      weakest: ranked.slice(-3).reverse().map((s) => ({ symbol: s.symbol, changePct: s.changePct })),
      sectors: [...sectors.values()]
        .map((s) => ({ sector: s.sector, avgChangePct: Math.round((s.sum / s.n) * 100) / 100, n: s.n }))
        .sort((a, b) => b.avgChangePct - a.avgChangePct),
      divergence,
      universe: 'NIFTY50',
    };
  }

  async loadQuotes(userId, authorization) {
    const cached = this.quoteCache.get(userId);
    const nowMs = this.now();
    if (cached && nowMs - cached.at < this.quoteTtlMs) return cached.data;
    const { indices, stocks } = this.universe();
    const keys = [...indices.map((i) => i.kiteKey), ...stocks.map((s) => s.kiteKey)];
    const data = await this.provider.quotes(authorization, keys);
    const ticker = this.tickers.get(userId);
    if (ticker) {
      for (const [k, q] of ticker.quotes) {
        const price = Number(q.price);
        if (!Number.isFinite(price)) continue;
        const row = data[k] || {};
        data[k] = { ...row, last_price: price, volume: q.volume ?? row.volume };
      }
    }
    this.quoteCache.set(userId, { at: nowMs, atIso: new Date(nowMs).toISOString(), data: data || {} });
    return data || {};
  }

  kickTicker(userId, authorization, quotes, indices, stocks) {
    let ticker = this.tickers.get(userId);
    if (!ticker) {
      ticker = new DeskTicker({ WebSocketImpl: this.WebSocketImpl });
      ticker.onTick = (inst, quote) => {
        const cache = this.quoteCache.get(userId);
        if (!cache?.data) return;
        const row = cache.data[inst.kiteKey] || cache.data[inst.symbol] || {};
        const next = { ...row, last_price: quote.price, volume: quote.volume ?? row.volume };
        cache.data[inst.kiteKey] = next;
        cache.atIso = quote.at;
      };
      this.tickers.set(userId, ticker);
    }
    ticker.adopt(authorization);
    const rows = [];
    for (const idx of indices) {
      rows.push({ symbol: idx.id, kiteKey: idx.kiteKey, instrumentToken: idx.kiteToken });
    }
    for (const s of stocks) {
      const q = pickQuote(quotes, s.kiteKey, s.symbol);
      const token = quoteChange(q).instrumentToken;
      if (token) rows.push({ symbol: s.symbol, kiteKey: s.kiteKey, instrumentToken: token });
    }
    ticker.setInstruments(rows);
    const sess = deskSessionStatus(new Date(this.now()));
    if (sess.open) ticker.ensure().catch(() => {});
    else ticker.stop();
  }

  kickWarm(userId, authorization, quotes, indices, stocks) {
    const key = userId;
    if (this.warming.get(key)) return this.warming.get(key);
    const job = this.warmHistory(userId, authorization, quotes, indices, stocks).finally(() => {
      this.warming.delete(key);
    });
    this.warming.set(key, job);
    return job;
  }

  async warmHistory(userId, authorization, quotes, indices, stocks) {
    const want = [
      ...indices.map((i) => ({ token: i.kiteToken, symbol: i.id })),
      ...stocks.map((s) => ({
        token: this.tokenFor(s, quotes),
        symbol: s.symbol,
      })),
    ];
    const intervals = ['15minute', '60minute', 'day'];
    for (const row of want) {
      if (!row.token) continue;
      for (const iv of intervals) {
        const cached = this.histCache.get(this.histKey(row.token, iv));
        const ttl = HIST_TTL[iv];
        if (cached && this.now() - cached.at < ttl && cached.candles?.length) continue;
        try {
          await this.history(authorization, row.token, iv);
        } catch {
          // keep going; snapshot will show insufficient data
        }
      }
    }
  }

  history(authorization, token, interval) {
    const key = this.histKey(token, interval);
    const cached = this.histCache.get(key);
    const ttl = HIST_TTL[interval] || 8 * 60_000;
    if (cached && this.now() - cached.at < ttl && cached.candles?.length) {
      return Promise.resolve(cached.candles);
    }
    const run = () => this.provider.history(
      authorization,
      token,
      isoDaysAgo(this.now(), HIST_LOOKBACK_DAYS[interval] || 20),
      isoToday(this.now()),
      interval,
    ).then((candles) => {
      const rows = Array.isArray(candles) ? candles : [];
      this.histCache.set(key, { at: this.now(), candles: rows });
      return rows;
    });
    const queued = this._histChain.then(run, run);
    this._histChain = queued.then(
      () => delay(this.histGapMs),
      () => delay(this.histGapMs),
    );
    return queued;
  }

  dedupeAlerts(userId, alerts, settings) {
    const seen = this.alertSeen.get(userId) || new Map();
    const out = [];
    const nowMs = this.now();
    for (const a of alerts) {
      if (!a) continue;
      const key = `${a.symbol}:${a.type}:${a.closeTime || a.status || ''}`;
      const prev = seen.get(key);
      if (prev && nowMs - prev < settings.alertCooldownMs) continue;
      seen.set(key, nowMs);
      out.push(a);
    }
    this.alertSeen.set(userId, seen);
    return out;
  }
}

function publicBreakout(br) {
  if (!br) return { status: 'insufficient', direction: null };
  return {
    status: br.status,
    direction: br.direction,
    level: br.level,
    close: br.close,
    closeTime: br.closeTime,
    support: br.support,
    resistance: br.resistance,
    volumeOk: br.volumeOk,
    interval: br.interval,
    forming: br.forming,
  };
}

function alertsFor(symbol, br15, br60, combined) {
  const out = [];
  const push = (type, br, provisional) => {
    out.push({
      type,
      symbol,
      provisional,
      direction: br.direction,
      status: br.status,
      closeTime: br.closeTime,
      message: `${symbol} ${provisional ? 'potential' : 'confirmed'} ${br.direction || ''} ${br.interval}`.trim(),
    });
  };
  if (br15.status === 'potential') push('breakout-15-candidate', br15, true);
  if (br15.status === 'confirmed') push('breakout-15-confirmed', br15, false);
  if (br60.status === 'potential') push('breakout-60-candidate', br60, true);
  if (br60.status === 'confirmed') push('breakout-60-confirmed', br60, false);
  if (br15.status === 'failed' || br60.status === 'failed') {
    out.push({ type: 'breakout-failed', symbol, provisional: false, message: `${symbol} breakout failed` });
  }
  if (combined.agreement === 'aligned-bull' || combined.agreement === 'aligned-bear') {
    out.push({ type: 'trend-agreement', symbol, provisional: false, message: `${symbol} ${combined.agreement}` });
  }
  if (combined.agreement === 'conflict') {
    out.push({ type: 'trend-reversal', symbol, provisional: true, message: `${symbol} timeframe conflict` });
  }
  return out;
}

function stripInternal(row) {
  const { alerts, setup, kiteKey, instrumentToken, ...rest } = row;
  return { ...rest, setup: setup || null };
}

module.exports = {
  MarketDeskService,
  pickQuote,
  quoteChange,
};
