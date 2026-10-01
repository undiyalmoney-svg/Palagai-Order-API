'use strict';

/**
 * Paper the ₹10k weekly book on large+mid versus large+mid+small.
 *
 * Prices are the deterministic synthetic tape (it has a built-in momentum
 * drift). Results show how the *engine* behaves when the scan list grows,
 * not how NSE small-caps would have paid in real life.
 *
 * Full-list run (264 large+mid vs 433 with 169 small-caps, ₹10k weekly):
 *   2020-04..2021-09  large+mid +₹3,595 | same-tape +₹4,982 | realistic +₹3,470
 *   2021-10..2022-06  large+mid   -₹403 | same-tape  -₹1,164 | realistic   -₹455
 *   2020-04..2026-09  large+mid +₹5,061 | same-tape +₹5,654 | realistic +₹2,665
 * Realistic small-caps cut the 6.5-year profit almost in half. Leave them off.
 */

const { BENCHMARK, LARGE_CAP, MID_CAP, UNIVERSE } = require('../data/universe');
const { SMALL_CAP } = require('../data/universe-small');
const { SyntheticProvider } = require('../data/synthetic-provider');
const { MarketPanel } = require('../data/panel');
const { runBacktest } = require('../backtest/backtester');
const { paramsFromPreset } = require('../config/defaults');

const DEFAULT_WINDOWS = [
  { id: 'bull-2020', from: '2020-04-01', to: '2021-09-30', label: 'Bull 2020-04 to 2021-09' },
  { id: 'bear-2021', from: '2021-10-01', to: '2022-06-30', label: 'Bear 2021-10 to 2022-06' },
  { id: 'chop-2023', from: '2023-01-02', to: '2024-09-30', label: 'Chop/bull 2023-01 to 2024-09' },
  { id: 'recent-2025', from: '2025-04-01', to: '2026-09-28', label: 'Recent 2025-04 to 2026-09' },
];

const FULL_WINDOW = { id: 'full-2020-26', from: '2020-04-01', to: '2026-09-28', label: 'Full 2020-04 to 2026-09' };

function uniqueBySymbol(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const u of list) {
      if (seen.has(u.symbol)) continue;
      seen.add(u.symbol);
      out.push(u);
    }
  }
  return out;
}

function smallcapOnly() {
  const taken = new Set(UNIVERSE.map((u) => u.symbol));
  return SMALL_CAP.filter((u) => !taken.has(u.symbol));
}

function largeMidUniverse() {
  return uniqueBySymbol([LARGE_CAP, MID_CAP]);
}

function buildPanel(universe, { clock, smallcapPhysics = true } = {}) {
  const provider = new SyntheticProvider({ now: clock, universe, smallcapPhysics });
  const g = provider.ensureGenerated();
  const series = [provider.seriesOf(BENCHMARK.symbol)];
  for (const u of universe) {
    const s = provider.seriesOf(u.symbol);
    if (s) series.push(s);
  }
  return { panel: new MarketPanel({ dates: g.dates, series, benchmark: BENCHMARK.symbol }), provider };
}

function summarize(bt, smallSet) {
  const closedPnl = (bt.roundTrips || []).reduce((a, t) => a + (Number(t.pnl) || 0), 0);
  const openPnl = (bt.openPositions || []).reduce((a, t) => a + (Number(t.unrealizedPnl) || 0), 0);
  const fills = bt.fills || [];
  const smallFills = fills.filter((f) => smallSet.has(f.symbol));
  const smallBuyValue = smallFills.filter((f) => f.side === 'BUY').reduce((a, f) => a + (f.value || 0), 0);
  const allBuyValue = fills.filter((f) => f.side === 'BUY').reduce((a, f) => a + (f.value || 0), 0);
  const names = new Set(fills.map((f) => f.symbol));
  const smallNames = [...names].filter((s) => smallSet.has(s));
  return {
    start: bt.metrics.startCapital,
    end: bt.metrics.endCapital,
    profit: Math.round((bt.metrics.endCapital - bt.metrics.startCapital) * 100) / 100,
    totalReturnPct: bt.metrics.totalReturnPct,
    cagrPct: bt.metrics.cagrPct,
    maxDrawdownPct: bt.metrics.maxDrawdownPct,
    sharpe: bt.metrics.sharpe,
    trades: (bt.roundTrips || []).length,
    winRatePct: bt.metrics.winRatePct,
    closedPnl: Math.round(closedPnl * 100) / 100,
    openPnl: Math.round(openPnl * 100) / 100,
    namesTraded: names.size,
    smallNamesTraded: smallNames,
    smallBuySharePct: allBuyValue > 0 ? Math.round((1000 * smallBuyValue) / allBuyValue) / 10 : 0,
  };
}

function runBook({ universe, from, to, capital, clock, smallcapPhysics, smallSet, slippageBps }) {
  const { panel } = buildPanel(universe, { clock, smallcapPhysics });
  const params = paramsFromPreset('momentum-weekly');
  const bt = runBacktest({
    panel,
    params,
    capital,
    from,
    to,
    slippageBps,
    keepTimeline: false,
  });
  return { universeSize: universe.length, ...summarize(bt, smallSet) };
}

/**
 * Compare the current large+mid scan with the same scan plus small-caps.
 * `sample` keeps the tape small enough for tests; omit it to use the full lists.
 */
function compareSmallcapProfit({
  capital = 10_000,
  windows = DEFAULT_WINDOWS,
  clock = () => new Date('2026-09-30T11:30:00Z'),
  largeMid = largeMidUniverse(),
  small = smallcapOnly(),
  sample = null,
} = {}) {
  const lm = sample ? largeMid.slice(0, sample.largeMid || largeMid.length) : largeMid;
  const sm = sample ? small.slice(0, sample.small || small.length) : small;
  const mixed = uniqueBySymbol([lm, sm]);
  const smallSet = new Set(sm.map((u) => u.symbol));
  const rows = [];
  for (const w of windows) {
    const base = runBook({
      universe: lm,
      from: w.from,
      to: w.to,
      capital,
      clock,
      smallcapPhysics: true,
      smallSet,
      slippageBps: 5,
    });
    const plusSame = runBook({
      universe: mixed,
      from: w.from,
      to: w.to,
      capital,
      clock,
      smallcapPhysics: false,
      smallSet,
      slippageBps: 5,
    });
    const plusReal = runBook({
      universe: mixed,
      from: w.from,
      to: w.to,
      capital,
      clock,
      smallcapPhysics: true,
      smallSet,
      slippageBps: 20,
    });
    rows.push({
      window: w,
      largeMid: { ...base, label: 'large+mid' },
      plusSamePhysics: { ...plusSame, label: 'plus small (same tape)' },
      plusRealistic: { ...plusReal, label: 'plus small (wider spreads / vol)' },
      extraProfitSame: Math.round((plusSame.profit - base.profit) * 100) / 100,
      extraProfitRealistic: Math.round((plusReal.profit - base.profit) * 100) / 100,
    });
  }
  const sameWins = rows.filter((r) => r.extraProfitSame > 0).length;
  const realWins = rows.filter((r) => r.extraProfitRealistic > 0).length;
  const sum = (key) => rows.reduce((a, r) => a + r[key].profit, 0);
  const baseTotal = Math.round(sum('largeMid') * 100) / 100;
  const sameTotal = Math.round(sum('plusSamePhysics') * 100) / 100;
  const realTotal = Math.round(sum('plusRealistic') * 100) / 100;
  const bull = rows.find((r) => /bull/i.test(r.window.id) || /bull/i.test(r.window.label));
  const realisticKeepsBull = !bull || bull.plusRealistic.profit >= 0 && bull.plusRealistic.profit >= bull.largeMid.profit;
  const realisticBeats = realTotal > baseTotal && realTotal > 0 && realisticKeepsBull;
  return {
    capital,
    largeMidCount: lm.length,
    smallCount: sm.length,
    mixedCount: mixed.length,
    windows: rows,
    samePhysicsHelpsIn: sameWins,
    realisticHelpsIn: realWins,
    totals: { largeMid: baseTotal, plusSamePhysics: sameTotal, plusRealistic: realTotal },
    verdict: realisticBeats
      ? 'On this synthetic tape, adding small-caps raised total profit and still made money in the bull window. That is not live NSE — do not turn them on without a real-data check.'
      : 'Adding small-caps does not give a reliable profit on a ₹10k weekly book. The same-tape run looks better only because the simulator already contains a momentum drift; the realistic tape (wider spreads, higher vol, extra crash) either loses money or steals the slots that paid in the bull window. Keep the live scan at large+mid.',
  };
}

function formatReport(result) {
  const lines = [];
  lines.push(`₹${result.capital.toLocaleString('en-IN')} weekly book`);
  lines.push(`Scan sizes: large+mid ${result.largeMidCount} | +small ${result.mixedCount} (${result.smallCount} extra names)`);
  lines.push('');
  for (const row of result.windows) {
    lines.push(row.window.label);
    for (const book of [row.largeMid, row.plusSamePhysics, row.plusRealistic]) {
      lines.push(
        `  ${book.label.padEnd(32)} profit ${fmt(book.profit)}  CAGR ${book.cagrPct}%  DD ${book.maxDrawdownPct}%  Sharpe ${book.sharpe}  trades ${book.trades}  small-buy ${book.smallBuySharePct}%`,
      );
    }
    lines.push(`  extra vs large+mid: same-tape ${fmt(row.extraProfitSame)} | realistic ${fmt(row.extraProfitRealistic)}`);
    lines.push('');
  }
  if (result.totals) {
    lines.push(
      `Sum across windows: large+mid ${fmt(result.totals.largeMid)} | same-tape ${fmt(result.totals.plusSamePhysics)} | realistic ${fmt(result.totals.plusRealistic)}`,
    );
  }
  lines.push(`Realistic tape beat large+mid in ${result.realisticHelpsIn}/${result.windows.length} windows (often a smaller loss, not a profit).`);
  lines.push(result.verdict);
  return lines.join('\n');
}

function fmt(n) {
  const sign = n > 0 ? '+' : '';
  return `${sign}₹${Math.round(n).toLocaleString('en-IN')}`;
}

module.exports = {
  SMALL_CAP,
  DEFAULT_WINDOWS,
  FULL_WINDOW,
  smallcapOnly,
  largeMidUniverse,
  uniqueBySymbol,
  compareSmallcapProfit,
  formatReport,
  buildPanel,
};

if (require.main === module) {
  const full = process.argv.includes('--full');
  const sample = full ? null : { largeMid: 80, small: 80 };
  const windows = full ? [...DEFAULT_WINDOWS, FULL_WINDOW] : DEFAULT_WINDOWS;
  const started = Date.now();
  const result = compareSmallcapProfit({ windows, sample });
  process.stdout.write(`${formatReport(result)}\n`);
  process.stderr.write(`elapsed ${(Date.now() - started) / 1000}s sample=${JSON.stringify(sample)}\n`);
}
