'use strict';

const { floorMinute } = require('./time');
const { fetchInstrumentsCsv, fetchHistoricalCandles, fetchQuoteLtp } = require('../services/kite-market');
const { resolveCrudeContract } = require('./universe');

/**
 * Live market adapter. Reads Kite quotes and one-minute history only.
 * This file does not import order placement.
 *
 * WebSocket is the primary path (Kite binary ticker, quote mode).
 * Historical minute candles are requested once per symbol per session to fill
 * gaps after a restart. REST quotes are not polled in a loop.
 */

function credentials() {
  const apiKey = process.env.KITE_API_KEY || '';
  const accessToken = process.env.KITE_ACCESS_TOKEN || '';
  if (!apiKey || !accessToken) return null;
  return { apiKey, accessToken, authorization: `token ${apiKey}:${accessToken}` };
}

/**
 * Droplet Node is 18/20 — `global.WebSocket` only exists on Node 22+.
 * Fall back to the `ws` package so the Kite ticker can open.
 */
function resolveWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    return require('ws');
  } catch {
    throw new Error('This Node runtime has no WebSocket client');
  }
}

function listen(ws, type, fn) {
  if (typeof ws.on === 'function') {
    ws.on(type, (data) => fn(data));
    return;
  }
  if (typeof ws.addEventListener === 'function') {
    ws.addEventListener(type, (ev) => fn(type === 'message' ? ev.data : ev));
  }
}

function parseTicks(buffer) {
  if (!buffer || buffer.length < 2) return [];
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const packets = buf.readInt16BE(0);
  let offset = 2;
  const ticks = [];
  for (let i = 0; i < packets; i += 1) {
    if (offset + 2 > buf.length) break;
    const len = buf.readInt16BE(offset);
    offset += 2;
    const packet = buf.subarray(offset, offset + len);
    offset += len;
    if (packet.length < 8) continue;
    const tick = {
      instrumentToken: packet.readInt32BE(0),
      price: packet.readInt32BE(4) / 100,
      volume: null,
    };
    if (packet.length >= 44) {
      tick.volume = packet.readInt32BE(16);
    }
    ticks.push(tick);
  }
  return ticks;
}

class CandleAggregator {
  constructor() {
    this.current = new Map();
  }

  onTick({ symbol, price, volume, time }) {
    const start = floorMinute(time).toISOString();
    const prev = this.current.get(symbol);
    const done = [];
    if (prev && prev.startTime !== start) {
      prev.complete = true;
      done.push(prev);
      this.current.delete(symbol);
    }
    const bar = this.current.get(symbol) || {
      symbol,
      interval: '1m',
      startTime: start,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      volumeCum: volume,
      complete: false,
    };
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    bar.close = price;
    if (volume != null && bar.volumeCum != null) bar.volume = Math.max(0, volume - bar.volumeCum);
    else if (volume != null && bar.volumeCum == null) bar.volumeCum = volume;
    this.current.set(symbol, bar);
    return done;
  }
}

class KiteFeed {
  constructor({ instruments = [], store = null, getAuthorization = null } = {}) {
    this.instruments = instruments;
    this.store = store;
    this.getAuthorization = getAuthorization;
    this.aggregator = new CandleAggregator();
    this.byToken = new Map();
    this.quotes = new Map();
    this.ws = null;
    this.connected = false;
    this.lastTickAt = null;
    this.lastError = null;
    this.backfilled = new Set();
    this.session = null;
    this.opening = null;
  }

  creds() {
    if (this.session) return this.session;
    return credentials();
  }

  /**
   * Reload a saved broker token after a process restart. Start today used
   * to keep the session only in RAM, so pm2 restart left the worker idle.
   */
  async restoreSession() {
    if (this.creds()) return this.creds();
    if (typeof this.getAuthorization !== 'function') return null;
    try {
      const header = await this.getAuthorization();
      if (header) this.adoptSession(header);
    } catch {
      return this.creds();
    }
    return this.creds();
  }

  /**
   * Keep a browser Kite session for this process. The token is not logged.
   * Header shape: `token apiKey:accessToken`.
   */
  adoptSession(authorization) {
    const text = String(authorization || '').trim();
    const match = text.match(/^token\s+([^:\s]+):(\S+)$/i);
    if (!match) {
      return { ok: false, message: 'Open Get Token first. Start today uses that Kite session and does not place a real order.' };
    }
    this.session = { apiKey: match[1], accessToken: match[2], authorization: `token ${match[1]}:${match[2]}` };
    this.lastError = null;
    return { ok: true };
  }

  status() {
    const creds = this.creds();
    return {
      configured: Boolean(creds),
      connected: this.connected,
      stale: !this.lastTickAt || Date.now() - new Date(this.lastTickAt).getTime() > 15_000,
      lastTickAt: this.lastTickAt,
      mode: this.connected ? 'live' : 'waiting',
      message: creds
        ? (this.connected ? 'Kite WebSocket is connected' : (this.lastError || 'Kite session is loaded. Waiting for the WebSocket.'))
        : 'Open Get Token, then press Start today. The server keeps that session after a restart. No prices are invented.',
    };
  }

  async pull(now = new Date()) {
    const creds = this.creds();
    if (!creds) return { ok: false, message: 'Kite credentials are not configured' };
    try {
      await this.ensureTokens(creds.authorization);
      await this.ensureSocket(creds);
      if (!this.connected) return { ok: false, message: this.lastError || 'Kite WebSocket is not connected' };
      let symbols = this.quotedSymbols();
      if (!symbols.length) {
        await this.pullRestQuotes(creds, now);
        symbols = this.quotedSymbols();
      }
      if (!symbols.length) return { ok: false, message: 'No fresh ticks yet. New entries stay blocked.' };
      return { ok: true, symbols, at: now.toISOString() };
    } catch (err) {
      this.connected = false;
      this.lastError = err.message;
      return { ok: false, message: err.message };
    }
  }

  async prepare(now = new Date()) {
    const creds = this.creds();
    if (!creds) return { ok: false, message: 'Kite session is missing' };
    await this.ensureTokens(creds.authorization, true);
    const tokens = this.instruments.filter((i) => i.instrumentToken).length;
    try {
      await this.ensureSocket(creds);
    } catch (err) {
      this.lastError = err.message;
    }
    const warmed = [];
    for (const inst of this.instruments.filter((i) => i.instrumentToken).slice(0, 5)) {
      try {
        const rows = await this.backfill(inst.symbol, inst.instrumentToken, new Date(now.getTime() - 5 * 24 * 3600 * 1000), now);
        if (this.store) {
          for (const bar of rows) await this.store.upsertCandle(bar);
        }
        warmed.push(inst.symbol);
      } catch (err) {
        this.lastError = err.message;
      }
    }
    return {
      ok: tokens > 0,
      tokens,
      universe: this.instruments.length,
      warmed,
      socket: this.connected ? 'connected' : 'connecting',
      message: tokens ? 'Index-book tokens are ready. Crude oil uses the front-month mini future.' : 'No index-book tokens matched the scan list.',
    };
  }

  async backfillNext(now = new Date()) {
    const creds = this.creds();
    if (!creds) return [];
    const inst = this.instruments.find((i) => i.instrumentToken && !this.backfilled.has(i.symbol));
    if (!inst) return [];
    const rows = await this.backfill(inst.symbol, inst.instrumentToken, new Date(now.getTime() - 5 * 24 * 3600 * 1000), now);
    if (this.store) {
      for (const bar of rows) await this.store.upsertCandle(bar);
    }
    return rows;
  }

  async ensureTokens(authorization, force = false, asOf = new Date()) {
    for (const inst of this.instruments) {
      const hasToken = Number(inst.instrumentToken) > 0;
      const crude = inst.exchange === 'MCX' || /CRUDE/i.test(inst.symbol);
      if (hasToken && !(crude && force)) continue;
      if (!crude) continue;
      const csv = await this.loadCsv(authorization, 'MCX');
      const hit = resolveCrudeContract(csv, asOf);
      if (!hit || !hit.instrumentToken) continue;
      inst.instrumentToken = hit.instrumentToken;
      inst.contractSymbol = hit.tradingSymbol;
      inst.tickSize = Number(hit.tickSize) || inst.tickSize;
      if (this.store) await this.store.upsertInstrument(inst);
    }
    this.indexTokens();
  }

  async loadCsv(authorization, exchange) {
    return fetchInstrumentsCsv(authorization, exchange);
  }

  quotedSymbols() {
    const symbols = [];
    for (const inst of this.instruments) {
      if (!inst.instrumentToken) continue;
      const quote = this.quotes.get(inst.symbol);
      if (!quote) continue;
      symbols.push({ symbol: inst.symbol, sector: inst.sector, quote, candles: [] });
    }
    return symbols;
  }

  quoteKey(inst) {
    return `${inst.exchange || 'NSE'}:${inst.contractSymbol || inst.symbol}`;
  }

  async pullRestQuotes(creds, now = new Date()) {
    const keys = this.instruments.filter((i) => i.instrumentToken).map((i) => this.quoteKey(i));
    if (!keys.length) return;
    try {
      const data = await this.loadQuotes(creds.authorization, keys);
      const at = now.toISOString();
      for (const inst of this.instruments) {
        const row = data[this.quoteKey(inst)] || data[inst.symbol];
        const price = Number(row && row.last_price);
        if (!(price > 0)) continue;
        this.lastTickAt = at;
        this.quotes.set(inst.symbol, { price, at, volume: Number(row.volume) || null });
      }
    } catch (err) {
      this.lastError = err.message;
    }
  }

  async loadQuotes(authorization, keys) {
    return fetchQuoteLtp(authorization, keys);
  }

  indexTokens() {
    this.byToken = new Map(this.instruments.filter((i) => i.instrumentToken).map((i) => [Number(i.instrumentToken), i]));
  }

  async ensureSocket(creds) {
    if (this.ws && this.connected) return;
    if (this.opening) return this.opening;
    if (this.ws && !this.connected) this.dropSocket('Kite WebSocket did not open');
    this.indexTokens();
    const tokens = this.instruments.map((i) => Number(i.instrumentToken)).filter(Boolean);
    if (!tokens.length) throw new Error('Instrument tokens are not loaded');
    const WebSocketImpl = this.WebSocket || resolveWebSocket();
    const url = `wss://ws.kite.trade?api_key=${encodeURIComponent(creds.apiKey)}&access_token=${encodeURIComponent(creds.accessToken)}`;
    let ws;
    try {
      ws = new WebSocketImpl(url, { family: 4 });
    } catch {
      ws = new WebSocketImpl(url);
    }
    this.ws = ws;
    if ('binaryType' in ws) ws.binaryType = 'arraybuffer';
    this.opening = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.connected) return;
        this.dropSocket('Kite WebSocket did not open');
        resolve();
      }, 8000);
      if (typeof timer.unref === 'function') timer.unref();
      listen(ws, 'open', () => {
        if (this.ws !== ws) return;
        clearTimeout(timer);
        this.connected = true;
        this.lastError = null;
        this.opening = null;
        try {
          ws.send(JSON.stringify({ a: 'subscribe', v: tokens }));
          ws.send(JSON.stringify({ a: 'mode', v: ['quote', tokens] }));
        } catch {
          this.dropSocket('Kite WebSocket error');
        }
        resolve();
      });
      listen(ws, 'message', (data) => {
        if (typeof data === 'string') return;
        const ticks = parseTicks(Buffer.from(data));
        const now = new Date();
        for (const tick of ticks) {
          const inst = this.byToken.get(tick.instrumentToken);
          if (!inst) continue;
          this.lastTickAt = now.toISOString();
          this.quotes.set(inst.symbol, { price: tick.price, at: this.lastTickAt, volume: tick.volume });
          const done = this.aggregator.onTick({ symbol: inst.symbol, price: tick.price, volume: tick.volume, time: now });
          if (this.store) {
            for (const bar of done) this.store.upsertCandle(bar).catch(() => {});
          }
        }
      });
      listen(ws, 'close', () => {
        clearTimeout(timer);
        this.connected = false;
        if (this.ws === ws) this.ws = null;
        this.lastError = 'Kite WebSocket closed';
        this.opening = null;
        resolve();
      });
      listen(ws, 'error', () => {
        clearTimeout(timer);
        this.dropSocket('Kite WebSocket error');
        resolve();
      });
    });
    return this.opening;
  }

  dropSocket(message) {
    const ws = this.ws;
    this.connected = false;
    this.ws = null;
    this.opening = null;
    if (message) this.lastError = message;
    if (!ws) return;
    try {
      if (typeof ws.terminate === 'function') ws.terminate();
      else if (typeof ws.close === 'function') ws.close();
    } catch {
      // already closed
    }
  }

  /** One-shot historical backfill. Not a polling loop. */
  async backfill(symbol, token, from, to) {
    const creds = this.creds();
    if (!creds || this.backfilled.has(symbol)) return [];
    this.backfilled.add(symbol);
    const rows = await fetchHistoricalCandles(creds.authorization, token, from, to, 'minute');
    return rows.map((r) => ({
      symbol,
      interval: '1m',
      startTime: new Date(r.date).toISOString(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      complete: true,
    }));
  }
}

module.exports = { KiteFeed, parseTicks, CandleAggregator, credentials, resolveWebSocket };
