'use strict';
const { fetchIndexDaily } = require('./nse-index-history');
const { searchSpecs, simulate, summarizeTrades, NIFTY_LOT_SIZE } = require('./ee-wait-engine');

let lastFound = null;

function defaultWindow(now = new Date()) {
  const toDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const from = new Date(`${toDate}T00:00:00+05:30`);
  from.setFullYear(from.getFullYear() - 4);
  const fromDate = from.toISOString().slice(0, 10);
  return { fromDate, toDate };
}

async function findEntryExitWait(opts = {}, deps = {}) {
  const lots = Math.max(1, Math.floor(Number(opts.lots)) || 1);
  let fromDate = String(opts.fromDate || '').slice(0, 10);
  let toDate = String(opts.toDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate >= toDate) {
    const d = defaultWindow();
    fromDate = d.fromDate;
    toDate = d.toDate;
  }
  const window = { fromDate, toDate };
  const fetchDaily = deps.fetchIndexDaily || fetchIndexDaily;
  const series = await fetchDaily({
    indexType: opts.indexType || 'NIFTY 50',
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
  lastFound = {
    at: new Date().toISOString(),
    indexType: series.indexType,
    fromDate: window.fromDate,
    toDate: window.toDate,
    bars: bars.length,
    engine: 'ee-wait',
    ...found,
  };
  return lastFound;
}

function getLastFound() {
  return lastFound;
}

function paperEeWait({ bars, spec, fromDate, toDate, lots }) {
  const run = simulate(bars, spec, { fromDate, toDate });
  const totals = summarizeTrades(run.trades, lots, NIFTY_LOT_SIZE);
  return {
    engine: 'ee-wait',
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
      optionPnlRs: Math.round(t.points * NIFTY_LOT_SIZE * Math.max(1, lots || 1)),
      netOptionPnlRs: Math.round(t.points * NIFTY_LOT_SIZE * Math.max(1, lots || 1)),
    })),
    open: run.open,
    note: 'Index-point P&L marked as rupees via Nifty lot size. Not option premium marks.',
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
  const { addDaysIso } = require('./nse-option-history');
  const fromDate = String(opts.fromDate || lastFound?.fromDate || '').slice(0, 10);
  const toDate = String(opts.toDate || lastFound?.toDate || '').slice(0, 10);
  const fetchDaily = deps.fetchIndexDaily || fetchIndexDaily;
  const series = await fetchDaily({
    indexType: opts.indexType || 'NIFTY 50',
    fromDate: addDaysIso(fromDate, -40),
    toDate,
  });
  return paperEeWait({
    bars: series.historical || [],
    spec,
    fromDate,
    toDate,
    lots,
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
};
