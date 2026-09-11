'use strict';
const { fetchIndexDaily } = require('./nse-index-history');
const { fetchNifty100Symbols, fetchEquityDaily, mapPool } = require('./nse-equity-history');
const {
  searchSpecs,
  simulate,
  summarizeTrades,
  specGridLite,
  NIFTY_LOT_SIZE,
} = require('./ee-wait-engine');
const { addDaysIso } = require('./nse-option-history');

let lastFound = null;

function defaultWindow(now = new Date()) {
  const toDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const [y, m, d] = toDate.split('-').map(Number);
  const fromDate = `${y - 4}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { fromDate, toDate };
}

function parseUniverse(raw) {
  const u = String(raw || 'nifty-50').toLowerCase().replace(/\s+/g, '-');
  if (u === 'nifty-100' || u === 'nifty100' || u === 'index-nifty-100') return 'nifty-100';
  if (u === 'nifty-100-stocks' || u === 'nifty100-stocks' || u === 'stocks' || u === 'n100') {
    return 'nifty-100-stocks';
  }
  return 'nifty-50';
}

function resolveWindow(opts, universe) {
  let fromDate = String(opts.fromDate || '').slice(0, 10);
  let toDate = String(opts.toDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate >= toDate) {
    const d = defaultWindow();
    fromDate = d.fromDate;
    toDate = d.toDate;
  }
  if (universe === 'nifty-100-stocks') {
    const maxFrom = addDaysIso(toDate, -400);
    if (fromDate < maxFrom) fromDate = maxFrom;
  }
  return { fromDate, toDate };
}

function slimStockRow(symbol, bars, found, lots) {
  if (!found?.best) return null;
  return {
    symbol,
    bars: bars.length,
    spec: found.best.spec,
    oos: found.best.oos,
    score: found.best.score,
    lots,
    lotSize: 1,
  };
}

async function findOnIndex(opts, deps, universe, window, lots) {
  const indexType = universe === 'nifty-100' ? 'NIFTY 100' : 'NIFTY 50';
  const fetchDaily = deps.fetchIndexDaily || fetchIndexDaily;
  const series = await fetchDaily({
    indexType,
    fromDate: window.fromDate,
    toDate: window.toDate,
  });
  const bars = series.historical || [];
  if (bars.length < 80) {
    const err = new Error(`Need more daily bars to search (got ${bars.length}). Widen From/To.`);
    err.status = 400;
    throw err;
  }
  const found = searchSpecs(bars, { lots, lotSize: NIFTY_LOT_SIZE, folds: opts.folds });
  return {
    at: new Date().toISOString(),
    universe,
    indexType: series.indexType,
    symbol: series.indexType,
    fromDate: window.fromDate,
    toDate: window.toDate,
    bars: bars.length,
    engine: 'ee-wait',
    lotSize: NIFTY_LOT_SIZE,
    ...found,
  };
}

async function findOnNifty100Stocks(opts, deps, window, lots) {
  const listFn = deps.fetchNifty100Symbols || fetchNifty100Symbols;
  const equityFn = deps.fetchEquityDaily || fetchEquityDaily;
  let symbols = await listFn();
  const cap = Math.max(1, Math.min(100, Math.floor(Number(opts.maxSymbols)) || 100));
  symbols = symbols.slice(0, cap);
  const rows = await mapPool(symbols, Math.min(4, symbols.length), async (symbol) => {
    try {
      const series = await equityFn({
        symbol,
        fromDate: window.fromDate,
        toDate: window.toDate,
      });
      const bars = series.historical || [];
      if (bars.length < 80) return { symbol, skipped: true, bars: bars.length };
      const found = searchSpecs(bars, {
        lots,
        lotSize: 1,
        folds: opts.folds || 2,
        grid: specGridLite(),
        skipChecks: true,
      });
      const slim = slimStockRow(symbol, bars, found, lots);
      return slim || { symbol, skipped: true, bars: bars.length, reason: 'no-oos-edge' };
    } catch (err) {
      return { symbol, skipped: true, error: err.message };
    }
  });
  const ranked = rows.filter((r) => r && r.spec && r.oos).sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = ranked[0] || null;
  return {
    at: new Date().toISOString(),
    universe: 'nifty-100-stocks',
    indexType: 'NIFTY 100',
    fromDate: window.fromDate,
    toDate: window.toDate,
    engine: 'ee-wait',
    lotSize: 1,
    scanned: symbols.length,
    ranked: ranked.length,
    skipped: rows.filter((r) => r && r.skipped).length,
    best: best
      ? {
          spec: best.spec,
          oos: best.oos,
          score: best.score,
          trainPoints: null,
        }
      : null,
    full: best
      ? {
          spec: best.spec,
          ...best.oos,
          tradeCount: best.oos.trades,
        }
      : null,
    symbol: best?.symbol || null,
    stocks: ranked.slice(0, 15),
    note:
      'Nifty 100 cash stocks, NSE daily OHLC. Rupees = ₹ move per share × lots (share qty). Same kill-failure engine. Live money stays Nifty 50 ATM options; this universe is paper/research.',
  };
}

async function findEntryExitWait(opts = {}, deps = {}) {
  const lots = Math.max(1, Math.floor(Number(opts.lots)) || 1);
  const universe = parseUniverse(opts.universe || opts.indexType);
  const window = resolveWindow(opts, universe);
  lastFound =
    universe === 'nifty-100-stocks'
      ? await findOnNifty100Stocks(opts, deps, window, lots)
      : await findOnIndex(opts, deps, universe, window, lots);
  return lastFound;
}

function getLastFound() {
  return lastFound;
}

function paperEeWait({ bars, spec, fromDate, toDate, lots, lotSize, symbol, universe }) {
  const size = Number(lotSize) > 0 ? Number(lotSize) : NIFTY_LOT_SIZE;
  const run = simulate(bars, spec, { fromDate, toDate });
  const totals = summarizeTrades(run.trades, lots, size);
  return {
    engine: 'ee-wait',
    universe: universe || 'nifty-50',
    symbol: symbol || null,
    spec,
    fromDate,
    toDate,
    totals: {
      trades: totals.trades,
      wins: totals.wins,
      losses: totals.losses,
      optionNetRs: totals.rupees,
      optionNetAfterChargesRs: totals.rupees,
      underlyingPoints: totals.points,
    },
    trades: run.trades.map((t) => ({
      ...t,
      instrumentName: symbol || t.instrumentName,
      optionPnlRs: Math.round(t.points * size * Math.max(1, lots || 1)),
      netOptionPnlRs: Math.round(t.points * size * Math.max(1, lots || 1)),
    })),
    open: run.open,
    note:
      size === 1
        ? 'Stock P&L = rupee move × lots (treated as share qty). Not option premium.'
        : 'Index-point P&L marked as rupees via Nifty lot size. Not option premium marks.',
  };
}

async function runEeWaitPaper(opts = {}, deps = {}) {
  const spec = opts.spec || lastFound?.best?.spec || lastFound?.full?.spec;
  if (!spec) {
    const err = new Error('Find entry/exit/wait first, then Run paper.');
    err.status = 400;
    throw err;
  }
  const lots = Math.max(1, Math.floor(Number(opts.lots)) || 1);
  const universe = parseUniverse(opts.universe || lastFound?.universe);
  const fromDate = String(opts.fromDate || lastFound?.fromDate || '').slice(0, 10);
  const toDate = String(opts.toDate || lastFound?.toDate || '').slice(0, 10);
  if (universe === 'nifty-100-stocks') {
    const symbol = String(opts.symbol || lastFound?.symbol || '').toUpperCase();
    if (!symbol) {
      const err = new Error('No winning Nifty 100 stock yet — Find first.');
      err.status = 400;
      throw err;
    }
    const equityFn = deps.fetchEquityDaily || fetchEquityDaily;
    const series = await equityFn({
      symbol,
      fromDate: addDaysIso(fromDate, -40),
      toDate,
    });
    return paperEeWait({
      bars: series.historical || [],
      spec,
      fromDate,
      toDate,
      lots,
      lotSize: 1,
      symbol,
      universe,
    });
  }
  const indexType = universe === 'nifty-100' ? 'NIFTY 100' : 'NIFTY 50';
  const fetchDaily = deps.fetchIndexDaily || fetchIndexDaily;
  const series = await fetchDaily({
    indexType,
    fromDate: addDaysIso(fromDate, -40),
    toDate,
  });
  return paperEeWait({
    bars: series.historical || [],
    spec,
    fromDate,
    toDate,
    lots,
    lotSize: NIFTY_LOT_SIZE,
    symbol: indexType,
    universe,
  });
}

function setLastFoundForTests(value) {
  lastFound = value;
}

module.exports = {
  findEntryExitWait,
  getLastFound,
  runEeWaitPaper,
  paperEeWait,
  setLastFoundForTests,
  defaultWindow,
  parseUniverse,
};
