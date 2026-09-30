'use strict';

const { MarketPanel } = require('../data/panel');
const { BENCHMARK } = require('../data/universe');
const { addDays } = require('../utils/dates');
const { HISTORY_START } = require('../data/synthetic-provider');

function buildPanel(store) {
  const stocks = new Map(store.listStocks().map((s) => [s.symbol, s]));
  const rows = store.allPriceRows();
  const bySymbol = new Map();
  for (const r of rows) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push(r);
  }
  const benchRows = bySymbol.get(BENCHMARK.symbol) || [];
  const dates = benchRows.map((r) => r.date);
  if (!dates.length) throw new Error('No market data loaded yet - run a data sync first');
  const series = [];
  for (const [symbol, list] of bySymbol) {
    const meta = stocks.get(symbol) || { name: symbol, sector: 'OTHER' };
    series.push({ symbol, name: meta.name, sector: meta.sector, rows: list });
  }
  return new MarketPanel({ dates, series, benchmark: BENCHMARK.symbol });
}

/**
 * Keeps the price tables in sync with the active provider and builds the
 * MarketPanel the engine works from. The panel is cached until new rows arrive.
 */
class MarketDataService {
  constructor({ store, providerFor, clock = () => new Date() }) {
    this.store = store;
    this.providerFor = providerFor;
    this.clock = clock;
    this.panelCache = null;
    this.syncing = null;
  }

  invalidate() {
    this.panelCache = null;
  }

  async sync({ provider, backfillFrom = HISTORY_START } = {}) {
    if (this.syncing) return this.syncing;
    this.syncing = this.doSync(provider || (await this.providerFor()), backfillFrom).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  async doSync(provider, backfillFrom) {
    const sources = this.store.priceSources();
    if (sources.length && !sources.includes(provider.id)) {
      const err = new Error(`Stored prices come from "${sources.join(', ')}" but the active provider is "${provider.id}". Reset market data before switching providers so histories are never mixed.`);
      err.code = 'PROVIDER_MISMATCH';
      throw err;
    }
    const instruments = await provider.listInstruments();
    const bench = provider.benchmarkSymbol();
    this.store.upsertStocks([
      ...instruments.map((i) => ({ symbol: i.symbol, name: i.name, sector: i.sector })),
      { symbol: bench, name: BENCHMARK.name, sector: 'INDEX', benchmark: true },
    ]);
    const to = provider.lastDate();
    let newRows = 0;
    const failures = [];
    for (const symbol of [bench, ...instruments.map((i) => i.symbol)]) {
      const last = this.store.lastPriceDate(symbol);
      const from = last ? addDays(last, 1) : backfillFrom;
      if (from > to) continue;
      try {
        const rows = await provider.fetchDaily(symbol, from, to);
        newRows += this.store.upsertPrices(symbol, rows, provider.id);
      } catch (err) {
        failures.push({ symbol, error: err.message });
      }
    }
    let quotes = 0;
    try {
      const q = await provider.fetchQuotes([bench, ...instruments.map((i) => i.symbol)], this.clock());
      this.store.upsertQuotes(q);
      quotes = Object.keys(q).length;
    } catch (err) {
      failures.push({ symbol: '*quotes*', error: err.message });
    }
    if (newRows) this.invalidate();
    const stats = this.store.priceStats();
    return { provider: provider.id, simulated: !!provider.isSimulated, newRows, quotes, failures, ...stats };
  }

  /** Full-history panel from the database. */
  loadPanel() {
    const stats = this.store.priceStats();
    const key = `${stats.rows}|${stats.last}`;
    if (this.panelCache && this.panelCache.key === key) return this.panelCache.panel;
    const panel = buildPanel(this.store);
    this.panelCache = { key, panel };
    return panel;
  }

  hasData() {
    return this.store.priceStats().rows > 0;
  }

  latestDate() {
    return this.store.priceStats().last;
  }

  /** Latest tradable price: live quote if fresh, else last stored close. */
  priceFor(symbol) {
    const q = this.store.getQuote(symbol);
    if (q && Number.isFinite(q.last)) return { price: q.last, source: 'quote', ts: q.ts, simulated: q.simulated };
    const panel = this.loadPanel();
    const d = panel.data.get(symbol);
    if (!d) return null;
    for (let i = panel.lastIndex; i >= 0; i -= 1) if (Number.isFinite(d.close[i])) return { price: d.close[i], source: 'close', ts: panel.dates[i], simulated: false };
    return null;
  }
}

module.exports = { MarketDataService, buildPanel };
