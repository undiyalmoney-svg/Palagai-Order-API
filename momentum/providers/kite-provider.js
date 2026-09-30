'use strict';

const { UNIVERSE, BENCHMARK } = require('../data/universe');
const { lastCompletedTradingDate, marketStatus } = require('../utils/dates');

/**
 * Real market data through Kite Connect (needs a valid user session).
 * `api` is injectable so tests never touch the network.
 */
class KiteProvider {
  constructor({ getAuthorization, api = require('../../services/kite-market'), now = () => new Date() }) {
    this.id = 'kite';
    this.label = 'Kite Connect (live market data)';
    this.isSimulated = false;
    this.getAuthorization = getAuthorization;
    this.api = api;
    this.nowFn = now;
    this.tokens = null;
  }

  async authorization() {
    const a = await this.getAuthorization();
    if (!a) throw new Error('Kite session required - use Get Token in Settings, then retry.');
    return a;
  }

  async status() {
    let ready = false;
    let note = 'Kite session missing';
    try {
      ready = !!(await this.getAuthorization());
      if (ready) note = 'Kite session present';
    } catch (err) {
      note = err.message;
    }
    return { id: this.id, label: this.label, simulated: false, ready, note };
  }

  async listInstruments() {
    return UNIVERSE.map((u) => ({ symbol: u.symbol, name: u.name, sector: u.sector }));
  }

  benchmarkSymbol() {
    return BENCHMARK.symbol;
  }

  lastDate() {
    return lastCompletedTradingDate(this.nowFn());
  }

  async resolveTokens() {
    if (this.tokens) return this.tokens;
    const auth = await this.authorization();
    const csv = await this.api.fetchInstrumentsCsv(auth, 'NSE');
    const map = new Map();
    for (const line of String(csv).split(/\r?\n/).slice(1)) {
      const cols = line.split(',');
      if (cols.length < 3) continue;
      map.set(cols[2].trim().toUpperCase(), Number(cols[0]));
    }
    map.set(BENCHMARK.symbol, BENCHMARK.kiteToken);
    this.tokens = map;
    return map;
  }

  async fetchDaily(symbol, from, to) {
    const auth = await this.authorization();
    const tokens = await this.resolveTokens();
    const token = tokens.get(symbol);
    if (!token) throw new Error(`No Kite instrument token for ${symbol}`);
    const bars = await this.api.fetchHistoricalInterval(auth, token, from, to, 'day');
    return bars.map((b) => ({ date: String(b.date).slice(0, 10), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  }

  async fetchQuotes(symbols) {
    const auth = await this.authorization();
    const keys = symbols.map((s) => (s === BENCHMARK.symbol ? BENCHMARK.kiteKey : `NSE:${s}`));
    const raw = await this.api.fetchQuotes(auth, keys);
    const out = {};
    const ts = this.nowFn().toISOString();
    for (const s of symbols) {
      const key = s === BENCHMARK.symbol ? BENCHMARK.kiteKey : `NSE:${s}`;
      const q = raw[key];
      if (!q) continue;
      out[s] = {
        symbol: s,
        last: q.last_price,
        open: q.ohlc?.open,
        high: q.ohlc?.high,
        low: q.ohlc?.low,
        prevClose: q.ohlc?.close,
        volume: q.volume,
        ts,
        simulated: false,
      };
    }
    return out;
  }

  marketStatus() {
    return marketStatus(this.nowFn());
  }
}

module.exports = { KiteProvider };
