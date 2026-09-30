'use strict';

const { mean, stdev, round } = require('../utils/math');
const { daysBetween } = require('../utils/dates');

/**
 * Performance metrics from a daily equity series.
 * Returns are time-weighted: deposits/withdrawals are removed from each day's
 * change so capital events do not masquerade as performance.
 *
 * equity: [{ date, equity, flow }]  flow = external cash added that day (+/-)
 * roundTrips: closed position lifecycles [{ pnl, returnPct, holdingDays }]
 */
function computeMetrics({ equity, roundTrips = [], fills = [], costs = 0, slippage = 0, benchmark = null, riskFreeAnnual = 0, startCapital }) {
  if (!equity.length) return emptyMetrics(startCapital);
  const rets = [];
  const twr = [1];
  for (let i = 1; i < equity.length; i += 1) {
    const prev = equity[i - 1].equity;
    const flow = equity[i].flow || 0;
    const r = prev > 0 ? (equity[i].equity - flow) / prev - 1 : 0;
    rets.push(r);
    twr.push(twr[i - 1] * (1 + r));
  }
  const first = equity[0];
  const last = equity[equity.length - 1];
  const years = Math.max(daysBetween(first.date, last.date) / 365.25, 1 / 365.25);
  const totalReturn = twr[twr.length - 1] - 1;
  const cagr = years >= 0.25 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;

  let peak = twr[0];
  let maxDd = 0;
  let ddStart = equity[0].date;
  let maxDdStart = ddStart;
  let maxDdEnd = ddStart;
  for (let i = 0; i < twr.length; i += 1) {
    if (twr[i] > peak) {
      peak = twr[i];
      ddStart = equity[i].date;
    }
    const dd = 1 - twr[i] / peak;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdStart = ddStart;
      maxDdEnd = equity[i].date;
    }
  }

  const rf = riskFreeAnnual / 252;
  const excess = rets.map((r) => r - rf);
  const sd = stdev(rets);
  const sharpe = sd > 0 ? (mean(excess) / sd) * Math.sqrt(252) : 0;
  const downside = Math.sqrt(mean(rets.map((r) => Math.min(0, r - rf) ** 2)));
  const sortino = downside > 0 ? (mean(excess) / downside) * Math.sqrt(252) : 0;
  const vol = sd * Math.sqrt(252);

  const wins = roundTrips.filter((t) => t.pnl > 0);
  const losses = roundTrips.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const n = roundTrips.length;
  const winRate = n ? wins.length / n : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const avgEquity = mean(equity.map((e) => e.equity));
  const tradedValue = fills.reduce((a, f) => a + f.value, 0);
  const turnover = avgEquity > 0 ? tradedValue / 2 / avgEquity / years : 0;
  const invSeries = equity.map((e) => (e.invested != null && e.equity > 0 ? e.invested / e.equity : 0));

  const out = {
    startCapital: round(startCapital ?? first.equity, 2),
    endCapital: round(last.equity, 2),
    netContributions: round(equity.reduce((a, e) => a + (e.flow || 0), 0), 2),
    totalReturnPct: round(totalReturn * 100, 2),
    cagrPct: round(cagr * 100, 2),
    maxDrawdownPct: round(maxDd * 100, 2),
    maxDrawdownStart: maxDdStart,
    maxDrawdownEnd: maxDdEnd,
    annualVolPct: round(vol * 100, 2),
    sharpe: round(sharpe, 2),
    sortino: round(sortino, 2),
    calmar: maxDd > 0 ? round(cagr / maxDd, 2) : null,
    trades: fills.length,
    roundTrips: n,
    winRatePct: round(winRate * 100, 1),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? null : 0,
    avgProfit: round(avgWin, 2),
    avgLoss: round(avgLoss, 2),
    avgWinPct: wins.length ? round(mean(wins.map((t) => t.returnPct)) * 100, 2) : 0,
    avgLossPct: losses.length ? round(mean(losses.map((t) => t.returnPct)) * 100, 2) : 0,
    expectancy: round(winRate * avgWin - (1 - winRate) * avgLoss, 2),
    avgHoldingDays: n ? round(mean(roundTrips.map((t) => t.holdingDays)), 1) : 0,
    turnoverPerYear: round(turnover, 2),
    totalCosts: round(costs, 2),
    totalSlippage: round(slippage, 2),
    costDragPct: round((costs + slippage) / Math.max(startCapital ?? first.equity, 1) * 100, 2),
    avgExposurePct: round(mean(invSeries) * 100, 1),
    bestTrade: n ? round(Math.max(...roundTrips.map((t) => t.pnl)), 2) : 0,
    worstTrade: n ? round(Math.min(...roundTrips.map((t) => t.pnl)), 2) : 0,
    years: round(years, 2),
    days: equity.length,
  };
  if (benchmark && benchmark.length > 1) {
    const b0 = benchmark[0];
    const b1 = benchmark[benchmark.length - 1];
    const br = b1 / b0 - 1;
    let bPeak = b0;
    let bDd = 0;
    for (const v of benchmark) {
      if (v > bPeak) bPeak = v;
      bDd = Math.max(bDd, 1 - v / bPeak);
    }
    out.benchmarkReturnPct = round(br * 100, 2);
    out.benchmarkCagrPct = round((years >= 0.25 ? Math.pow(1 + br, 1 / years) - 1 : br) * 100, 2);
    out.benchmarkMaxDrawdownPct = round(bDd * 100, 2);
    out.alphaCagrPct = round(out.cagrPct - out.benchmarkCagrPct, 2);
  }
  return out;
}

function emptyMetrics(startCapital = 0) {
  return {
    startCapital,
    endCapital: startCapital,
    totalReturnPct: 0,
    cagrPct: 0,
    maxDrawdownPct: 0,
    sharpe: 0,
    sortino: 0,
    trades: 0,
    roundTrips: 0,
    winRatePct: 0,
    profitFactor: 0,
    avgProfit: 0,
    avgLoss: 0,
    expectancy: 0,
    avgHoldingDays: 0,
    turnoverPerYear: 0,
    totalCosts: 0,
    totalSlippage: 0,
    days: 0,
    years: 0,
  };
}

module.exports = { computeMetrics, emptyMetrics };
