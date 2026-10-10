'use strict';

/**
 * Formulas (closed trades unless noted):
 * - Win rate = winning closes / closed trades. Open trades are excluded.
 * - Expectancy = sum(net P&L) / closed trades.
 * - Profit factor = gross winning P&L / abs(gross losing P&L).
 *   When there are no losing trades, profit factor is null (undefined), not infinity.
 * - Max drawdown = largest peak-to-trough drop on a time-ordered equity curve.
 *   The curve includes unrealized P&L when account snapshots exist. A curve built
 *   only from closed trades is labelled as such.
 */

function summarizeTrades(trades, initialCapital) {
  const closed = trades.filter((t) => t.status === 'CLOSED');
  let grossProfit = 0;
  let grossLoss = 0;
  let fees = 0;
  let slippage = 0;
  let net = 0;
  let wins = 0;
  let losses = 0;
  let holdMs = 0;
  for (const t of closed) {
    const g = Number(t.grossPnl) || 0;
    if (g > 0) {
      grossProfit += g;
      wins += 1;
    } else if (g < 0) {
      grossLoss += g;
      losses += 1;
    }
    fees += Number(t.fees) || 0;
    slippage += Number(t.slippage) || 0;
    net += Number(t.netPnl) || 0;
    if (t.entryTime && t.exitTime) holdMs += new Date(t.exitTime) - new Date(t.entryTime);
  }
  const n = closed.length;
  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null;
  return {
    trades: trades.length,
    closed: n,
    wins,
    losses,
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    fees: round2(fees),
    slippage: round2(slippage),
    netPnl: round2(net),
    returnPct: initialCapital ? round2((net / initialCapital) * 100) : null,
    profitFactor: profitFactor == null ? null : round2(profitFactor),
    profitFactorNote: profitFactor == null ? 'undefined when there are no losing trades' : 'gross wins / abs(gross losses)',
    winRate: n ? round2(wins / n) : null,
    expectancy: n ? round2(net / n) : null,
    avgWin: wins ? round2(grossProfit / wins) : null,
    avgLoss: losses ? round2(grossLoss / losses) : null,
    avgHoldingMs: n ? Math.round(holdMs / n) : null,
  };
}

function maxDrawdown(equityPoints) {
  let peak = null;
  let maxDd = 0;
  let maxDdPct = 0;
  for (const equity of equityPoints) {
    if (!Number.isFinite(equity)) continue;
    if (peak == null || equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = peak > 0 ? dd / peak : 0;
    }
  }
  return { maxDrawdown: round2(maxDd), maxDrawdownPct: round2(maxDdPct * 100) };
}

function equityFromClosedTrades(initialCapital, trades) {
  const closed = trades
    .filter((t) => t.status === 'CLOSED' && t.exitTime)
    .slice()
    .sort((a, b) => new Date(a.exitTime) - new Date(b.exitTime));
  const curve = [initialCapital];
  let equity = initialCapital;
  for (const t of closed) {
    equity += Number(t.netPnl) || 0;
    curve.push(equity);
  }
  return { curve, source: 'closed-trades' };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { summarizeTrades, maxDrawdown, equityFromClosedTrades, round2 };
