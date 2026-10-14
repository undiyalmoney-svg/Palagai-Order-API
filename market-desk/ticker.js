'use strict';

const { parseTicks, resolveWebSocket } = require('../research/feed');

function listen(ws, type, fn) {
  if (typeof ws.on === 'function') {
    ws.on(type, (data) => fn(data));
    return;
  }
  if (typeof ws.addEventListener === 'function') {
    ws.addEventListener(type, (ev) => fn(type === 'message' ? ev.data : ev));
  }
}

function parseAuth(authorization) {
  const text = String(authorization || '').trim();
  const match = text.match(/^token\s+([^:\s]+):(\S+)$/i);
  if (!match) return null;
  return { apiKey: match[1], accessToken: match[2], authorization: `token ${match[1]}:${match[2]}` };
}

/**
 * Per-user Kite ticker. Quote mode only. Restores subscriptions after a drop.
 * Never logs the access token.
 */
class DeskTicker {
  constructor({ WebSocketImpl } = {}) {
    this.WebSocket = WebSocketImpl;
    this.ws = null;
    this.connected = false;
    this.lastTickAt = null;
    this.lastError = null;
    this.opening = null;
    this.reconnectTimer = null;
    this.tokens = [];
    this.byToken = new Map();
    this.quotes = new Map();
    this.creds = null;
    this.reconnectMs = 2_000;
    this.wantOpen = false;
    this.onTick = null;
  }

  adopt(authorization) {
    const creds = parseAuth(authorization);
    if (!creds) {
      this.lastError = 'Kite session is missing. Open Get Token.';
      return false;
    }
    this.creds = creds;
    this.lastError = null;
    return true;
  }

  setInstruments(rows) {
    this.byToken = new Map();
    this.tokens = [];
    for (const row of rows || []) {
      const token = Number(row.instrumentToken || row.instrument_token) || 0;
      if (!token) continue;
      const symbol = row.symbol || row.kiteKey;
      this.byToken.set(token, { symbol, kiteKey: row.kiteKey || symbol, token });
      this.tokens.push(token);
    }
  }

  status() {
    const stale = !this.lastTickAt || Date.now() - new Date(this.lastTickAt).getTime() > 15_000;
    return {
      connected: this.connected,
      stale,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      subscribed: this.tokens.length,
    };
  }

  async ensure() {
    if (!this.creds || !this.tokens.length) return false;
    this.wantOpen = true;
    if (this.ws && this.connected) {
      this.subscribe();
      return true;
    }
    await this.open();
    return this.connected;
  }

  subscribe() {
    if (!this.ws || !this.connected || !this.tokens.length) return;
    try {
      this.ws.send(JSON.stringify({ a: 'subscribe', v: this.tokens }));
      this.ws.send(JSON.stringify({ a: 'mode', v: ['quote', this.tokens] }));
    } catch {
      this.drop('Kite WebSocket send failed');
    }
  }

  open() {
    if (this.opening) return this.opening;
    if (!this.creds) return Promise.resolve();
    const WebSocketImpl = this.WebSocket || resolveWebSocket();
    const url = `wss://ws.kite.trade?api_key=${encodeURIComponent(this.creds.apiKey)}&access_token=${encodeURIComponent(this.creds.accessToken)}`;
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
        this.drop('Kite WebSocket did not open');
        resolve();
      }, 8_000);
      if (typeof timer.unref === 'function') timer.unref();
      listen(ws, 'open', () => {
        if (this.ws !== ws) return;
        clearTimeout(timer);
        this.connected = true;
        this.lastError = null;
        this.opening = null;
        this.subscribe();
        resolve();
      });
      listen(ws, 'message', (data) => {
        if (typeof data === 'string') return;
        const ticks = parseTicks(Buffer.from(data));
        const at = new Date().toISOString();
        for (const tick of ticks) {
          const inst = this.byToken.get(tick.instrumentToken);
          if (!inst) continue;
          this.lastTickAt = at;
          const quote = { price: tick.price, at, volume: tick.volume, instrumentToken: tick.instrumentToken };
          this.quotes.set(inst.symbol, quote);
          this.quotes.set(inst.kiteKey, quote);
          if (typeof this.onTick === 'function') this.onTick(inst, quote);
        }
      });
      listen(ws, 'close', () => {
        clearTimeout(timer);
        this.connected = false;
        if (this.ws === ws) this.ws = null;
        this.lastError = 'Kite WebSocket closed';
        this.opening = null;
        this.scheduleReconnect();
        resolve();
      });
      listen(ws, 'error', () => {
        clearTimeout(timer);
        this.drop('Kite WebSocket error');
        resolve();
      });
    });
    return this.opening;
  }

  scheduleReconnect() {
    if (!this.wantOpen || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantOpen) this.open().catch(() => {});
    }, this.reconnectMs);
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
  }

  drop(message) {
    const ws = this.ws;
    this.connected = false;
    this.ws = null;
    this.opening = null;
    if (message) this.lastError = message;
    if (!ws) {
      this.scheduleReconnect();
      return;
    }
    try {
      if (typeof ws.terminate === 'function') ws.terminate();
      else if (typeof ws.close === 'function') ws.close();
    } catch {
      // already closed
    }
    this.scheduleReconnect();
  }

  stop() {
    this.wantOpen = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (!ws) return;
    try {
      if (typeof ws.terminate === 'function') ws.terminate();
      else if (typeof ws.close === 'function') ws.close();
    } catch {
      // ignore
    }
  }
}

module.exports = { DeskTicker, parseAuth, parseTicks };
