'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp } = require('./helpers');
const { paperReplay } = require('../services/desk');

function fakeKiteFromStore(store, { tcsLast = 4123.45 } = {}) {
  const stocks = store.listStocks();
  const bySymbol = new Map();
  for (const r of store.allPriceRows()) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push(r);
  }
  const last = store.priceStats().last;
  return {
    id: 'kite',
    isSimulated: false,
    lastDate: () => last,
    benchmarkSymbol: () => 'NIFTY50',
    async listInstruments() {
      return stocks.filter((s) => !s.benchmark).map((s) => ({ symbol: s.symbol, name: s.name, sector: s.sector }));
    },
    async fetchDaily(symbol, from, to) {
      return (bySymbol.get(symbol) || [])
        .filter((r) => r.date >= from && r.date <= to)
        .map((r) => ({
          date: r.date,
          open: r.open,
          high: r.high,
          low: r.low,
          close: symbol === 'TCS' && r.date === last ? tcsLast : r.close,
          volume: r.volume,
        }));
    },
    async fetchQuotes(symbols) {
      const out = {};
      for (const s of symbols) {
        const rows = bySymbol.get(s) || [];
        const row = rows[rows.length - 1];
        out[s] = {
          symbol: s,
          last: s === 'TCS' ? tcsLast : row?.close ?? 100,
          ts: '2026-09-30T11:30:00.000Z',
          simulated: false,
        };
      }
      return out;
    },
  };
}

test('paper without a Kite tape stays on simulated prices and types start capital', async () => {
  const app = await makeApp();
  const paper = await paperReplay(app.research, app.momentum, 'u1', { capital: 100000, period: 'last_12m' });
  assert.equal(paper.priceSource, 'synthetic');
  assert.equal(paper.simulated, true);
  assert.equal(paper.startCapital, 100000);
  assert.match(paper.priceNote || '', /Simulated/i);
  app.close();
});

test('paper with a Kite session replays the Kite tape, not synthetic closes', async () => {
  const app = await makeApp({ kiteTapePath: ':memory:' });
  const tcsLast = 4123.45;
  const fake = fakeKiteFromStore(app.store, { tcsLast });
  app.momentum.sessions.save('u1', 'kitekey', 'token');
  app.momentum.paperProviderFor = async () => fake;

  const paper = await paperReplay(app.research, app.momentum, 'u1', { capital: 25000, period: 'last_12m' });
  assert.equal(paper.priceSource, 'kite');
  assert.equal(paper.simulated, false);
  assert.equal(paper.startCapital, 25000);
  assert.ok(Number.isFinite(paper.endCapital));
  assert.equal(app.marketData.priceFor('TCS').price, tcsLast);
  assert.equal(app.marketData.priceFor('TCS').simulated, false);

  const synClose = (() => {
    const panel = app.marketData.loadSyntheticPanel();
    const d = panel.data.get('TCS');
    for (let i = panel.lastIndex; i >= 0; i -= 1) if (Number.isFinite(d.close[i])) return d.close[i];
    return null;
  })();
  assert.notEqual(synClose, tcsLast);
  app.close();
});
