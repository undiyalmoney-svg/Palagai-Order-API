'use strict';

const { PortfolioDecisionEngine } = require('../engine/portfolio-decision-engine');
const { applyBuy, applySell, newPosition, cashDelta } = require('../execution/ledger');
const { legCost, normalizeCosts } = require('../execution/costs');
const { checkBuy } = require('../engine/risk');
const { computeMetrics } = require('./metrics');
const { round, roundPrice } = require('../utils/math');
const { paramsHash } = require('../config/defaults');

/**
 * Historical execution layer for the *same* PortfolioDecisionEngine used live.
 *
 *   Market data -> indicators -> engine.decide(view at close of day t)
 *                                     |
 *   orders queued -> filled at the OPEN of day t+1 with slippage and costs
 *
 * The engine only ever receives a MarketView bound to day t, so it cannot see
 * later bars. Fills use the next open (the first price a real order placed
 * after the close could get), and a BUY is skipped when the open gaps more than
 * `maxPriceDeviationPct` above the reference price - the same guard the live
 * order pipeline applies.
 */
function runBacktest({
  panel,
  params,
  capital,
  from,
  to,
  costs,
  slippageBps = 5,
  maxPriceDeviationPct = 0.04,
  capitalEvents = [],
  engine = new PortfolioDecisionEngine(),
  keepTimeline = true,
  lean = true,
  riskFreeAnnual = 0,
  onProgress = null,
  shouldCancel = null,
}) {
  const costModel = normalizeCosts(costs);
  const firstEligible = Math.min(
    ...panel.symbols().map((s) => panel.meta.get(s).firstIdx),
    panel.lastIndex,
  ) + params.minHistoryBars;
  const startIdx = Math.max(panel.indexOnOrBefore(from) < 0 ? 0 : panel.indexOnOrBefore(from), firstEligible);
  const endIdx = panel.indexOnOrBefore(to);
  if (endIdx < 0 || endIdx <= startIdx) {
    throw new Error(`Not enough data between ${from} and ${to} (history needed: ${params.minHistoryBars} bars before the start)`);
  }
  const eventsByDate = new Map();
  for (const ev of capitalEvents) {
    const idx = panel.indexOnOrBefore(ev.date);
    if (idx < startIdx || idx > endIdx) continue;
    const d = panel.dates[idx];
    eventsByDate.set(d, [...(eventsByDate.get(d) || []), ev]);
  }

  let cash = capital;
  const positions = new Map();
  let pending = [];
  let pendingWithdrawal = 0;
  let prevRegime = null;
  let lastReviewDate = null;
  let peakEquity = capital;
  let seq = 0;
  let totalCosts = 0;
  let totalSlippage = 0;
  const fills = [];
  const roundTrips = [];
  const equity = [];
  const timeline = [];
  const rejected = [];
  const benchmarkSeries = [];
  const benchSym = panel.benchmark;
  let lastPrice = new Map();
  let pendingCapitalEvent = null;
  let events = 0;

  const priceAtClose = (sym, idx) => {
    const v = panel.data.get(sym)?.close[idx];
    if (Number.isFinite(v)) {
      lastPrice.set(sym, v);
      return v;
    }
    return lastPrice.get(sym);
  };

  for (let idx = startIdx; idx <= endIdx; idx += 1) {
    if (shouldCancel && shouldCancel()) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    const date = panel.dates[idx];
    let flow = 0;

    for (const ev of eventsByDate.get(date) || []) {
      if (ev.amount > 0) {
        cash += ev.amount;
        flow += ev.amount;
        pendingCapitalEvent = { amount: ev.amount, kind: 'DEPOSIT', date };
        events += 1;
      } else if (ev.amount < 0) {
        pendingCapitalEvent = { amount: ev.amount, kind: 'WITHDRAWAL', date };
        events += 1;
      }
    }

    // ---- 1. fill yesterday's orders at today's open ------------------------------
    if (pending.length) {
      const ordered = [...pending].sort((a, b) => (a.side === 'SELL' ? 0 : 1) - (b.side === 'SELL' ? 0 : 1));
      for (const o of ordered) {
        const bars = panel.data.get(o.symbol);
        const open = bars ? bars.open[idx] : NaN;
        if (!Number.isFinite(open)) {
          rejected.push({ date, symbol: o.symbol, side: o.side, reason: 'No open price (halted or not trading)' });
          continue;
        }
        const pos = positions.get(o.symbol);
        if (o.side === 'SELL') {
          if (!pos) continue;
          const qty = Math.min(o.qty, pos.qty);
          const fillPrice = roundPrice(open * (1 - slippageBps / 10_000));
          const cost = legCost({ side: 'SELL', price: fillPrice, qty, costs: costModel }).total;
          const res = applySell(pos, { symbol: o.symbol, qty, price: fillPrice, cost, date });
          cash += cashDelta('SELL', fillPrice, qty, cost);
          totalCosts += cost;
          totalSlippage += (open - fillPrice) * qty;
          if (res.position) positions.set(o.symbol, res.position);
          else positions.delete(o.symbol);
          seq += 1;
          fills.push({
            seq,
            date,
            symbol: o.symbol,
            side: 'SELL',
            action: o.action,
            qty,
            price: fillPrice,
            value: round(fillPrice * qty, 2),
            cost,
            pnl: res.pnl,
            pnlPct: res.pnlPct,
            holdingDays: res.holdingDays,
            trigger: o.trigger,
            reason: o.reason,
            regime: o.regime,
          });
          if (res.closed) {
            roundTrips.push({
              symbol: o.symbol,
              entryDate: pos.entryDate,
              exitDate: date,
              pnl: res.lifecyclePnl,
              returnPct: res.lifecycleInvested > 0 ? res.lifecyclePnl / res.lifecycleInvested : 0,
              holdingDays: res.holdingDays,
              trigger: o.trigger,
            });
          }
        } else {
          if (open > o.priceRef * (1 + maxPriceDeviationPct)) {
            rejected.push({ date, symbol: o.symbol, side: 'BUY', reason: `Open ${open} gapped above reference ${o.priceRef} by more than ${maxPriceDeviationPct * 100}%` });
            continue;
          }
          const fillPrice = roundPrice(open * (1 + slippageBps / 10_000));
          let qty = o.qty;
          while (qty > 0 && fillPrice * qty + legCost({ side: 'BUY', price: fillPrice, qty, costs: costModel }).total > cash) qty -= 1;
          if (qty <= 0) {
            rejected.push({ date, symbol: o.symbol, side: 'BUY', reason: 'Insufficient cash at the open' });
            continue;
          }
          const cost = legCost({ side: 'BUY', price: fillPrice, qty, costs: costModel }).total;
          const next = pos
            ? applyBuy(pos, { qty, price: fillPrice, cost, stopPrice: o.stopPrice })
            : newPosition({ symbol: o.symbol, qty, price: fillPrice, cost, date, initialStop: o.stopPrice, stopPrice: o.stopPrice });
          positions.set(o.symbol, next);
          cash += cashDelta('BUY', fillPrice, qty, cost);
          totalCosts += cost;
          totalSlippage += (fillPrice - open) * qty;
          seq += 1;
          fills.push({
            seq,
            date,
            symbol: o.symbol,
            side: 'BUY',
            action: o.action,
            qty,
            price: fillPrice,
            value: round(fillPrice * qty, 2),
            cost,
            pnl: null,
            pnlPct: null,
            holdingDays: null,
            trigger: o.trigger,
            reason: o.reason,
            regime: o.regime,
          });
        }
      }
      pending = [];
      if (pendingWithdrawal > 0) {
        const take = Math.min(pendingWithdrawal, Math.max(0, cash));
        cash -= take;
        flow -= take;
        pendingWithdrawal = 0;
      }
    }

    // ---- 2. mark to market at today's close ----------------------------------------
    let invested = 0;
    for (const p of positions.values()) {
      const px = priceAtClose(p.symbol, idx) ?? p.avgPrice;
      invested += px * p.qty;
      if (px > (p.peakClose || 0)) p.peakClose = px;
    }
    const eq = cash + invested;
    peakEquity = Math.max(peakEquity, eq);
    equity.push({ date, equity: round(eq, 2), cash: round(cash, 2), invested: round(invested, 2), flow });
    const bClose = benchSym ? panel.data.get(benchSym)?.close[idx] : NaN;
    if (Number.isFinite(bClose)) benchmarkSeries.push(bClose);
    if (onProgress && (idx - startIdx) % 50 === 0) onProgress((idx - startIdx) / (endIdx - startIdx));

    // ---- 3. decide at today's close, queue orders for the next open -----------------
    if (idx < endIdx) {
      const view = panel.view(idx, params);
      const portfolio = {
        cash,
        positions: [...positions.values()],
        peakEquity,
      };
      const result = engine.decide({
        view,
        params,
        portfolio,
        state: { prevRegime, lastReviewDate },
        capitalEvent: pendingCapitalEvent,
        costs: costModel,
        slippageBps,
        now: new Date(`${date}T10:00:00Z`),
        lean,
      });
      if (pendingCapitalEvent && pendingCapitalEvent.amount < 0) pendingWithdrawal = -pendingCapitalEvent.amount;
      pendingCapitalEvent = null;
      prevRegime = result.nextState.regime;
      lastReviewDate = result.nextState.lastReviewDate;

      for (const d of result.decisions) {
        if (d.action === 'BUY' && d.quantity > 0) {
          pending.push({
            side: 'BUY',
            symbol: d.symbol,
            qty: d.quantity,
            priceRef: d.priceRef,
            stopPrice: d.risk?.stopPrice,
            action: d.kind === 'ADD' ? 'ADD' : 'BUY',
            trigger: d.trigger,
            reason: d.reason,
            regime: result.regime.regime,
          });
        } else if (['SELL', 'EXIT', 'REDUCE'].includes(d.action) && d.quantity > 0) {
          pending.push({
            side: 'SELL',
            symbol: d.symbol,
            qty: d.quantity,
            priceRef: d.priceRef,
            action: d.action,
            trigger: d.trigger,
            reason: `${d.reason}${d.reasons?.length ? ` | ${d.reasons[0]}` : ''}`,
            regime: result.regime.regime,
          });
        } else if (d.action === 'HOLD' && d.risk && Number.isFinite(d.risk.stopPrice)) {
          const p = positions.get(d.symbol);
          if (p && d.risk.stopPrice > (p.stopPrice ?? 0)) p.stopPrice = d.risk.stopPrice;
        }
      }
      if (keepTimeline) {
        timeline.push({
          date,
          regime: result.regime.regime,
          regimeScore: result.regime.score,
          review: result.review,
          answer: result.summary.answer,
          positions: positions.size,
          targetSize: result.portfolioSize.n,
          equity: round(eq, 2),
          orders: pending.length,
        });
      }
    }
  }

  const finalPrice = (s) => lastPrice.get(s) ?? positions.get(s)?.avgPrice;
  const openPositions = [...positions.values()].map((p) => ({
    symbol: p.symbol,
    qty: p.qty,
    avgPrice: round(p.avgPrice, 2),
    lastPrice: round(finalPrice(p.symbol), 2),
    unrealizedPnl: round((finalPrice(p.symbol) - p.avgPrice) * p.qty, 2),
    entryDate: p.entryDate,
  }));

  const metrics = computeMetrics({
    equity,
    roundTrips,
    fills,
    costs: totalCosts,
    slippage: totalSlippage,
    benchmark: benchmarkSeries,
    riskFreeAnnual,
    startCapital: capital,
  });
  metrics.rejectedOrders = rejected.length;
  metrics.capitalEvents = events;

  return {
    metrics,
    equity,
    fills,
    roundTrips,
    rejected,
    openPositions,
    timeline,
    config: { capital, from: panel.dates[startIdx], to: panel.dates[endIdx], slippageBps, costs: costModel, strategy: params.id, paramsHash: paramsHash(params) },
    benchmark: benchmarkSeries,
  };
}

module.exports = { runBacktest };
