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
const { searchOrderFlow, simulateOrderFlow } = require('./order-flow-engine');
const { addDaysIso } = require('./nse-option-history');
const { paperPnlWindow } = require('./trade-bot-dates');

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

function isOrderFlowSpec(spec) {
  const engine = String(spec?.engine || '').toLowerCase();
  return engine === 'order-flow' || String(spec?.entry || '') === 'confluence';
}

function pickWinner(eeFound, ofFound) {
  const a = eeFound?.best;
  const b = ofFound?.best;
  if (a && b) {
    const ar = (a.oos?.rupees || 0) + (a.score || 0);
    const br = (b.oos?.rupees || 0) + (b.score || 0);
    return br > ar
      ? { engine: 'order-flow', best: b, source: ofFound }
      : { engine: 'ee-wait', best: a, source: eeFound };
  }
  if (b) return { engine: 'order-flow', best: b, source: ofFound };
  if (a) return { engine: 'ee-wait', best: a, source: eeFound };
  return { engine: 'ee-wait', best: null, source: eeFound };
}

function searchBoth(bars, { lots, lotSize, folds, lite }) {
  const ee = searchSpecs(bars, {
    lots,
    lotSize,
    folds,
    grid: lite ? specGridLite() : undefined,
    skipChecks: !!lite,
  });
  const oflow = searchOrderFlow(bars, { lots, lotSize, folds, lite: !!lite });
  const picked = pickWinner(ee, oflow);
  return {
    ee,
    oflow,
    picked,
    engines: {
      'ee-wait': ee?.best
        ? { spec: ee.best.spec, oos: ee.best.oos, score: ee.best.score }
        : null,
      'order-flow': oflow?.best
        ? { spec: oflow.best.spec, oos: oflow.best.oos, score: oflow.best.score }
        : null,
    },
  };
}

function slimStockRow(symbol, bars, picked, lots, engines) {
  if (!picked?.best) return null;
  return {
    symbol,
    bars: bars.length,
    engine: picked.engine,
    spec: picked.best.spec,
    oos: picked.best.oos,
    score: picked.best.score,
    lots,
    lotSize: 1,
    engines,
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
  const both = searchBoth(bars, { lots, lotSize: NIFTY_LOT_SIZE, folds: opts.folds, lite: false });
  const found = both.picked.source || both.ee;
  return {
    at: new Date().toISOString(),
    universe,
    indexType: series.indexType,
    symbol: series.indexType,
    fromDate: window.fromDate,
    toDate: window.toDate,
    bars: bars.length,
    engine: both.picked.engine,
    lotSize: NIFTY_LOT_SIZE,
    ...found,
    best: both.picked.best,
    engines: both.engines,
    note:
      both.picked.engine === 'order-flow'
        ? both.oflow.note
        : found.note,
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
      const both = searchBoth(bars, { lots, lotSize: 1, folds: opts.folds || 2, lite: true });
      const slim = slimStockRow(symbol, bars, both.picked, lots, both.engines);
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
    engine: best?.engine || 'ee-wait',
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
      'Nifty 100 cash stocks, NSE daily OHLC. Compares entry/wait/exit vs order-flow confluence (volume profile + signed-volume delta). Rupees = ₹ move per share × lots. Live money stays Nifty 50 ATM options; this universe is paper/research.',
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

function paperEeWait({
  bars,
  spec,
  fromDate,
  toDate,
  lots,
  lotSize,
  symbol,
  universe,
  engine,
  usedFindWindow,
}) {
  const size = Number(lotSize) > 0 ? Number(lotSize) : NIFTY_LOT_SIZE;
  const of = isOrderFlowSpec(spec) || String(engine || '').toLowerCase() === 'order-flow';
  const run = of
    ? simulateOrderFlow(bars, spec, { fromDate, toDate })
    : simulate(bars, spec, { fromDate, toDate });
  const totals = summarizeTrades(run.trades, lots, size);
  const resolvedEngine = of ? 'order-flow' : 'ee-wait';
  return {
    engine: resolvedEngine,
    universe: universe || 'nifty-50',
    symbol: symbol || null,
    spec: run.spec || spec,
    fromDate,
    toDate,
    usedFindWindow: !!usedFindWindow,
    totals: {
      trades: totals.trades,
      wins: totals.wins,
      losses: totals.losses,
      optionNetRs: totals.rupees,
      optionNetAfterChargesRs: totals.rupees,
      underlyingPoints: totals.points,
      profitFactor: totals.profitFactor,
      maxDrawdownPoints: totals.maxDrawdownPoints,
    },
    trades: run.trades.map((t) => ({
      ...t,
      instrumentName: symbol || t.instrumentName,
      optionPnlRs: Math.round(t.points * size * Math.max(1, lots || 1)),
      netOptionPnlRs: Math.round(t.points * size * Math.max(1, lots || 1)),
    })),
    open: run.open,
    message:
      totals.trades === 0
        ? 'No trades in this window. Paper needs a multi-day Find window — Today is only for live orders.'
        : undefined,
    note:
      (size === 1
        ? `${resolvedEngine}: stock P&L = rupee move × lots (share qty). Not option premium.`
        : `${resolvedEngine}: index-point P&L marked as rupees via Nifty lot size × 65. Not option premium.`) +
      (usedFindWindow ? ' Today is for live only — paper used the Find date window.' : ''),
  };
}

async function runEeWaitPaper(opts = {}, deps = {}) {
  const lots = Math.max(1, Math.floor(Number(opts.lots)) || 1);
  const universe = parseUniverse(opts.universe || lastFound?.universe);
  const rawWindow = {
    fromDate: String(opts.fromDate || lastFound?.fromDate || '').slice(0, 10),
    toDate: String(opts.toDate || lastFound?.toDate || '').slice(0, 10),
    today: !!opts.today,
    liveMoney: false,
  };
  const expanded = paperPnlWindow(rawWindow, lastFound);
  const fromDate = expanded.fromDate;
  const toDate = expanded.toDate;
  let spec = opts.spec || lastFound?.best?.spec || lastFound?.full?.spec;
  let engine = String(opts.engine || spec?.engine || lastFound?.engine || '').toLowerCase();
  if (!spec) {
    lastFound = await findEntryExitWait(
      { fromDate, toDate, lots, universe, symbol: opts.symbol, folds: opts.folds },
      deps,
    );
    spec = lastFound?.best?.spec || lastFound?.full?.spec;
    engine = lastFound?.engine || engine;
  }
  if (!spec) {
    const err = new Error(
      'No profitable entry/wait/exit or order-flow spec in this window (out-of-sample net ≤ 0). Widen From/To or pick another universe.',
    );
    err.status = 400;
    throw err;
  }
  const usedFindWindow = !!expanded.usedFindWindow;
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
      engine,
      usedFindWindow,
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
    engine,
    usedFindWindow,
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
  isOrderFlowSpec,
  searchBoth,
};
