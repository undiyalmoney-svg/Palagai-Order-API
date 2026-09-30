'use strict';

const { PortfolioDecisionEngine } = require('../engine/portfolio-decision-engine');
const { runBacktest } = require('../backtest/backtester');
const { normalizeCosts } = require('../execution/costs');
const { round } = require('../utils/math');

const engine = new PortfolioDecisionEngine();

const fingerprint = (r) =>
  JSON.stringify({
    regime: [r.regime.regime, r.regime.score],
    size: r.portfolioSize.n,
    decisions: r.decisions.map((d) => [d.symbol, d.action, d.quantity, d.priceRef, d.score, d.rank]),
  });

/**
 * "What would the system have told me on date X?"
 *
 * The decision is produced by the same engine as live trading from a
 * MarketView cut at that date. `verifiedNoLookahead` re-runs the decision on a
 * panel physically truncated at that date and confirms the output is identical,
 * i.e. later bars had no influence. The optional `hindsight` block then shows
 * what those recommendations would have earned afterwards - it is reporting
 * only and never feeds back into the decision.
 */
function whatIf({ panel, params, date, capital, portfolio = null, costs, slippageBps = 5, horizons = [5, 21, 63], verify = true }) {
  const idx = panel.indexOnOrBefore(date);
  const firstUsable = Math.min(...panel.symbols().map((s) => panel.meta.get(s).firstIdx)) + params.minHistoryBars;
  if (idx < 0 || idx < firstUsable) {
    const err = new Error(`Not enough history before ${date}: the engine needs ${params.minHistoryBars} bars, first usable date is ${panel.dates[Math.min(firstUsable, panel.lastIndex)]}`);
    err.code = 'NO_HISTORY';
    throw err;
  }
  const costModel = normalizeCosts(costs);
  const pf = portfolio || { cash: capital, positions: [], peakEquity: capital };
  const asOf = panel.dates[idx];
  const input = { params, portfolio: pf, costs: costModel, slippageBps, now: new Date(`${asOf}T10:00:00Z`), forceReview: true };
  const result = engine.decide({ ...input, view: panel.view(idx, params) });

  let verifiedNoLookahead = null;
  if (verify && idx < panel.lastIndex) {
    const cut = panel.truncate(idx);
    const check = engine.decide({ ...input, view: cut.view(cut.lastIndex, params) });
    verifiedNoLookahead = fingerprint(check) === fingerprint(result);
  }

  let hindsight = null;
  if (idx < panel.lastIndex) {
    const buys = result.decisions.filter((d) => d.action === 'BUY' && d.quantity > 0);
    const benchClose = panel.data.get(panel.benchmark).close;
    const lastIdx = panel.lastIndex;
    const rows = buys.map((d) => {
      const bars = panel.data.get(d.symbol);
      const entry = bars.open[idx + 1] * (1 + slippageBps / 10_000);
      const stop = d.risk?.stopPrice;
      let stopHit = null;
      for (let i = idx + 1; i <= lastIdx; i += 1) {
        if (Number.isFinite(stop) && bars.close[i] <= stop) {
          stopHit = { date: panel.dates[i], price: bars.close[i] };
          break;
        }
      }
      const at = (n) => {
        const i = Math.min(idx + 1 + n, lastIdx);
        return { date: panel.dates[i], returnPct: round((bars.close[i] / entry - 1) * 100, 2) };
      };
      const endPrice = stopHit ? stopHit.price : bars.close[lastIdx];
      return {
        symbol: d.symbol,
        quantity: d.quantity,
        entry: round(entry, 2),
        forward: Object.fromEntries(horizons.map((h) => [`d${h}`, at(h)])),
        stopHit,
        endPrice: round(endPrice, 2),
        pnl: round((endPrice - entry) * d.quantity, 2),
        // Percent, same scale as returnOnInvestedPct (12.3 means +12.3%).
        returnPct: round((endPrice / entry - 1) * 100, 2),
      };
    });
    const invested = rows.reduce((a, r) => a + r.entry * r.quantity, 0);
    const pnl = rows.reduce((a, r) => a + r.pnl, 0);
    let followed = null;
    try {
      const bt = runBacktest({ panel, params, capital, from: asOf, to: panel.dates[lastIdx], costs: costModel, slippageBps, keepTimeline: false, engine });
      followed = {
        description: 'Started flat with this capital on the decision date and followed every subsequent system decision (entries, stops, exits, rebalances) to the latest date.',
        endCapital: bt.metrics.endCapital,
        totalReturnPct: bt.metrics.totalReturnPct,
        maxDrawdownPct: bt.metrics.maxDrawdownPct,
        trades: bt.metrics.trades,
        benchmarkReturnPct: bt.metrics.benchmarkReturnPct,
        openPositions: bt.openPositions.length,
      };
    } catch {
      followed = null;
    }
    hindsight = {
      followedSystem: followed,
      note: 'Hindsight only - shown for evaluation, never used by the decision. Assumes buys at the next open and exit at the protective stop (on a close below it) or the latest close.',
      through: panel.dates[lastIdx],
      buys: rows,
      invested: round(invested, 2),
      pnl: round(pnl, 2),
      returnOnInvestedPct: invested > 0 ? round((pnl / invested) * 100, 2) : 0,
      returnOnCapitalPct: capital > 0 ? round((pnl / capital) * 100, 2) : null,
      benchmarkReturnPct: round((benchClose[lastIdx] / benchClose[idx + 1] - 1) * 100, 2),
    };
  }
  return { requestedDate: date, asOf, verifiedNoLookahead, result, hindsight };
}

module.exports = { whatIf, fingerprint };
