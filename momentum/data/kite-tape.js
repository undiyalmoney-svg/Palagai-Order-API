'use strict';

const { openDatabase } = require('../db/database');
const { Store } = require('../db/store');
const { panelFromStore } = require('./panel');
const { BENCHMARK, LARGE_CAP, BOOK_ETFS } = require('./universe');

const KITE_SCAN = new Set([...LARGE_CAP, ...BOOK_ETFS].map((u) => u.symbol));
const { addDays } = require('../utils/dates');

/**
 * Live NSE daily bars, stored apart from the synthetic sqlite.
 * Mixing Kite rows into historical_prices trips PROVIDER_MISMATCH and would
 * poison the mock tape, so paper/live ranks read this file instead.
 */
class KiteTape {
  constructor({ dbPath, clock = () => new Date() }) {
    this.db = openDatabase(dbPath);
    this.store = new Store(this.db, { clock });
    this.clock = clock;
    this.panelCache = null;
    this.syncing = null;
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }

  hasData() {
    return this.store.priceStats().rows > 0;
  }

  stats() {
    return this.store.priceStats();
  }

  invalidate() {
    this.panelCache = null;
  }

  loadPanel() {
    const stats = this.store.priceStats();
    const key = `${stats.rows}|${stats.last}`;
    if (this.panelCache && this.panelCache.key === key) return this.panelCache.panel;
    const panel = panelFromStore(this.store, BENCHMARK.symbol, { keep: KITE_SCAN });
    this.panelCache = { key, panel };
    return panel;
  }

  async ensure({ provider, from, to, concurrency = 3 }) {
    if (this.syncing) return this.syncing;
    this.syncing = this.doEnsure(provider, from, to, concurrency).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  async doEnsure(provider, from, to, concurrency) {
    const instruments = await provider.listInstruments();
    const bench = provider.benchmarkSymbol();
    this.store.upsertStocks([
      ...instruments.map((i) => ({ symbol: i.symbol, name: i.name, sector: i.sector })),
      { symbol: bench, name: BENCHMARK.name, sector: 'INDEX', benchmark: true },
    ]);
    const symbols = [bench, ...instruments.map((i) => i.symbol)];
    let newRows = 0;
    const failures = [];
    const fetched = [];
    await mapPool(symbols, concurrency, async (symbol) => {
      const last = this.store.lastPriceDate(symbol);
      const start = last ? addDays(last, 1) : from;
      if (start > to) return;
      try {
        const rows = await provider.fetchDaily(symbol, start, to);
        if (rows?.length) {
          newRows += this.store.upsertPrices(symbol, rows, 'kite');
          fetched.push(symbol);
        }
      } catch (err) {
        failures.push({ symbol, error: err.message });
      }
    });
    if (newRows) this.invalidate();
    let quotes = 0;
    try {
      const q = await provider.fetchQuotes(symbols, this.clock());
      if (q && Object.keys(q).length) {
        this.store.upsertQuotes(q);
        quotes = Object.keys(q).length;
      }
    } catch (err) {
      failures.push({ symbol: '*quotes*', error: err.message });
    }
    const stats = this.store.priceStats();
    if (!stats.rows) {
      const err = new Error(
        failures[0]?.error || 'Kite returned no daily bars. Update Get Token and retry paper.',
      );
      err.code = 'NO_KITE_TAPE';
      throw err;
    }
    return { provider: 'kite', newRows, quotes, failures, fetched: fetched.length, ...stats };
  }
}

async function mapPool(items, limit, fn) {
  const n = Math.max(1, Number(limit) || 1);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

module.exports = { KiteTape };
