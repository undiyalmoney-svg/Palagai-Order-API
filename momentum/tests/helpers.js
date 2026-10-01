'use strict';

const { createMomentumApp } = require('../index');

const NOW = new Date('2026-09-30T11:30:00Z'); // Wed 17:00 IST, market closed, day complete
const OPEN = new Date('2026-09-30T05:00:00Z'); // Wed 10:30 IST, market open

let cachedRows = null;

/** Fresh in-memory app with the deterministic synthetic history loaded. */
async function makeApp({ clock = () => NOW, brokerOverride = null } = {}) {
  const app = createMomentumApp({ dbPath: ':memory:', clock, brokerOverride, coreOnly: true });
  if (cachedRows) {
    const stocks = cachedRows.stocks;
    app.store.upsertStocks(stocks.map((s) => ({ ...s, benchmark: !!s.benchmark })));
    app.store.tx(() => {
      for (const [sym, rows] of cachedRows.prices) app.store.upsertPrices(sym, rows, 'synthetic');
    });
    const provider = await app.momentum.providerFor();
    app.store.upsertQuotes(await provider.fetchQuotes(stocks.map((s) => s.symbol), clock()));
  } else {
    await app.marketData.sync();
    const prices = new Map();
    for (const r of app.store.allPriceRows()) {
      if (!prices.has(r.symbol)) prices.set(r.symbol, []);
      prices.get(r.symbol).push(r);
    }
    cachedRows = { stocks: app.store.listStocks(), prices };
  }
  app.marketData.invalidate();
  return app;
}

module.exports = { makeApp, NOW, OPEN };
