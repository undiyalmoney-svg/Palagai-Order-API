'use strict';

const { floorMinute } = require('./time');
const { fetchInstrumentsCsv, findInstrumentInCsv, fetchHistoricalCandles } = require('../services/kite-market');

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
  constructor({ instruments = [], store = null } = {}) {
    this.instruments = instruments;
    this.store = store;
    this.aggregator = new CandleAggregator();
    this.byToken = new Map();
    this.quotes = new Map();
    this.ws = null;
    this.connected = false;
    this.lastTickAt = null;
    this.lastError = null;
    this.backfilled = new Set();
    this.session = null;
  }

  creds() {
    if (this.session) return this.session;
    return credentials();
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
        : 'Open Get Token, then press Start today. No prices are invented.',
    };
  }

  async pull(now = new Date()) {
    const creds = this.creds();
    if (!creds) return { ok: false, message: 'Kite credentials are not configured' };
    try {
      await this.ensureTokens(creds.authorization);
      await this.ensureSocket(creds);
      if (!this.connected) return { ok: false, message: this.lastError || 'Kite WebSocket is not connected' };
      const symbols = [];
      for (const inst of this.instruments) {
        if (!inst.instrumentToken) continue;
        const quote = this.quotes.get(inst.symbol);
        if (!quote) continue;
        symbols.push({ symbol: inst.symbol, sector: inst.sector, quote, candles: [] });
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
      message: tokens ? 'Cash-equity tokens refreshed. The rest of the book warms up through the day.' : 'No NSE equity tokens matched the scan list.',
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

  async ensureTokens(authorization, force = false) {
    if (!force && this.instruments.some((i) => i.instrumentToken)) {
      this.indexTokens();
      return;
    }
    const csv = await fetchInstrumentsCsv(authorization, 'NSE');
    for (const inst of this.instruments) {
      const row = findInstrumentInCsv(csv, { tradingSymbol: inst.symbol });
      if (!row || row.exchange !== 'NSE' || row.instrumentType !== 'EQ') continue;
      inst.instrumentToken = row.instrumentToken;
      inst.tickSize = Number(row.tickSize) || inst.tickSize;
      inst.lotSize = Number(row.lotSize) || 1;
      if (this.store) await this.store.upsertInstrument(inst);
    }
    this.indexTokens();
  }

  indexTokens() {
    this.byToken = new Map(this.instruments.filter((i) => i.instrumentToken).map((i) => [Number(i.instrumentToken), i]));
  }

  async ensureSocket(creds) {
    if (this.ws && this.connected) return;
    if (this.ws) return;
    const tokens = this.instruments.map((i) => Number(i.instrumentToken)).filter(Boolean);
    if (!tokens.length) throw new Error('Instrument tokens are not loaded');
    const WebSocketImpl = global.WebSocket;
    if (!WebSocketImpl) throw new Error('This Node runtime has no WebSocket client');
    const url = `wss://ws.kite.trade?api_key=${encodeURIComponent(creds.apiKey)}&access_token=${encodeURIComponent(creds.accessToken)}`;
    const ws = new WebSocketImpl(url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      this.connected = true;
      this.lastError = null;
      ws.send(JSON.stringify({ a: 'subscribe', v: tokens }));
      ws.send(JSON.stringify({ a: 'mode', v: ['quote', tokens] }));
    });
    ws.addEventListener('message', (ev) => {
      const data = ev.data;
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
    ws.addEventListener('close', () => {
      this.connected = false;
      this.ws = null;
      this.lastError = 'Kite WebSocket closed';
    });
    ws.addEventListener('error', () => {
      this.connected = false;
      this.lastError = 'Kite WebSocket error';
    });
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

module.exports = { KiteFeed, parseTicks, CandleAggregator, credentials };
