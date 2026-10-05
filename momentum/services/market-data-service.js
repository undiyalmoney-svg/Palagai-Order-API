'use strict';

const { panelFromStore } = require('../data/panel');
const { BENCHMARK } = require('../data/universe');
const { addDays } = require('../utils/dates');
const { HISTORY_START } = require('../data/synthetic-provider');
const { KiteTape } = require('../data/kite-tape');

function buildPanel(store) {
  return panelFromStore(store, BENCHMARK.symbol);
}

function lastCloseOf(panel, symbol) {
  const d = panel.data.get(symbol);
  if (!d) return { close: null, closeTs: null };
  for (let i = panel.lastIndex; i >= 0; i -= 1) {
    if (Number.isFinite(d.close[i])) return { close: d.close[i], closeTs: panel.dates[i] };
  }
  return { close: null, closeTs: null };
}

/**
 * Keeps the price tables in sync with the active provider and builds the
 * MarketPanel the engine works from. The panel is cached until new rows arrive.
 *
 * Live Kite daily history lives in a separate kite tape so it never mixes with
 * the synthetic sqlite (that mix throws PROVIDER_MISMATCH).
 */
class MarketDataService {
  constructor({ store, providerFor, clock = () => new Date(), kiteTapePath = null }) {
    this.store = store;
    this.providerFor = providerFor;
    this.clock = clock;
    this.panelCache = null;
    this.syncing = null;
    this.livePanel = null;
    this.liveMeta = null;
    this.kiteTape = kiteTapePath ? new KiteTape({ dbPath: kiteTapePath, clock }) : null;
  }

  close() {
    this.kiteTape?.close();
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

  loadSyntheticPanel() {
    const stats = this.store.priceStats();
    const key = `${stats.rows}|${stats.last}`;
    if (this.panelCache && this.panelCache.key === key) return this.panelCache.panel;
    const panel = buildPanel(this.store);
    this.panelCache = { key, panel };
    return panel;
  }

  /** Engine panel: live Kite tape when warmed, otherwise the synthetic store. */
  loadPanel() {
    if (this.livePanel) return this.livePanel;
    return this.loadSyntheticPanel();
  }

  hasData() {
    return this.store.priceStats().rows > 0;
  }

  latestDate() {
    if (this.livePanel?.dates?.length) return this.livePanel.dates[this.livePanel.lastIndex];
    return this.store.priceStats().last;
  }

  priceSource() {
    if (this.livePanel) return { id: 'kite', simulated: false, label: 'NSE daily history (Kite)' };
    return { id: 'synthetic', simulated: true, label: 'Simulated prices' };
  }

  /**
   * Pull (or refresh) the Kite daily tape without touching synthetic rows.
   * `from` defaults to ~4.5 years so Dual Momentum 12-1 has warmup in one Kite chunk.
   */
  async activateKite(provider, { from } = {}) {
    if (!this.kiteTape) {
      const err = new Error('Kite tape is not configured');
      err.code = 'NO_KITE_TAPE';
      throw err;
    }
    const to = provider.lastDate();
    const fromDate = from || addDays(to, -1600);
    const stats = await this.kiteTape.ensure({ provider, from: fromDate, to });
    this.livePanel = this.kiteTape.loadPanel();
    this.liveMeta = { provider: 'kite', simulated: false, ...stats };
    return { panel: this.livePanel, ...stats };
  }

  /**
   * Latest tradable price. Real Kite LTP wins; simulated intraday ticks do not
   * replace the last daily close (those ticks were showing as "the" stock price).
   */
  priceFor(symbol) {
    const kiteQ = this.kiteTape?.store.getQuote(symbol);
    if (kiteQ && Number.isFinite(kiteQ.last) && !kiteQ.simulated) {
      return { price: kiteQ.last, source: 'quote', ts: kiteQ.ts, simulated: false };
    }
    const q = this.store.getQuote(symbol);
    const panel = this.livePanel || this.loadSyntheticPanel();
    const { close, closeTs } = lastCloseOf(panel, symbol);
    if (q && Number.isFinite(q.last) && !q.simulated) {
      return { price: q.last, source: 'quote', ts: q.ts, simulated: false };
    }
    if (close != null) {
      return { price: close, source: 'close', ts: closeTs, simulated: !this.livePanel };
    }
    if (q && Number.isFinite(q.last)) {
      return { price: q.last, source: 'quote', ts: q.ts, simulated: !!q.simulated };
    }
    return null;
  }
}

module.exports = { MarketDataService, buildPanel };
