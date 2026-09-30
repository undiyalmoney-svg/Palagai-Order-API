'use strict';

const { applyBuy, applySell, newPosition, cashDelta } = require('../execution/ledger');
const { legCost } = require('../execution/costs');
const { round } = require('../utils/math');
const { istDate } = require('../utils/dates');

/**
 * DB-backed portfolio. Every change to cash or positions goes through
 * `applyFill`, which is idempotent per (order, cumulative filled quantity),
 * so replaying a broker update can never double-count a fill.
 */
class PortfolioService {
  constructor({ store, clock = () => new Date() }) {
    this.store = store;
    this.clock = clock;
  }

  stateOf(portfolio) {
    return { cash: portfolio.cash, positions: this.store.listPositions(portfolio.id), peakEquity: portfolio.peakEquity };
  }

  value(portfolio, priceOf) {
    const positions = this.store.listPositions(portfolio.id);
    let invested = 0;
    let unrealized = 0;
    const rows = positions.map((p) => {
      const px = priceOf(p.symbol) ?? p.avgPrice;
      const value = px * p.qty;
      invested += value;
      unrealized += (px - p.avgPrice) * p.qty;
      return { ...p, lastPrice: px, value: round(value, 2), unrealizedPnl: round((px - p.avgPrice) * p.qty, 2), unrealizedPct: round(px / p.avgPrice - 1, 4) };
    });
    return { positions: rows, invested: round(invested, 2), unrealized: round(unrealized, 2), equity: round(portfolio.cash + invested, 2), cash: round(portfolio.cash, 2) };
  }

  /**
   * Apply the *new* part of a broker fill. `cumulativeQty` is the total filled
   * quantity the broker reports for the order; only the delta versus what was
   * already applied is booked.
   */
  applyFill({ portfolio, order, cumulativeQty, avgPrice, costsModel, date, stopPrice = null, reason = '' }) {
    const delta = cumulativeQty - order.appliedQty;
    if (delta <= 0) return { applied: 0 };
    const fillKey = `order:${order.id}:${cumulativeQty}`;
    return this.store.tx(() => {
      const fresh = this.store.getPortfolioById(portfolio.id);
      const cost = legCost({ side: order.side, price: avgPrice, qty: delta, costs: costsModel }).total;
      const existing = this.store.getPosition(fresh.id, order.symbol);
      let pnl = null;
      let pnlPct = null;
      let holdingDays = null;
      if (order.side === 'BUY') {
        const pos = existing;
        const next = pos
          ? applyBuy(pos, { qty: delta, price: avgPrice, cost, stopPrice })
          : newPosition({ symbol: order.symbol, qty: delta, price: avgPrice, cost, date, initialStop: stopPrice, stopPrice, signalId: order.signalId });
        this.store.savePosition(fresh.id, next);
      } else {
        if (!existing) throw new Error(`Cannot apply SELL fill: no ${order.symbol} position`);
        const res = applySell(existing, { symbol: order.symbol, qty: delta, price: avgPrice, cost, date });
        pnl = res.pnl;
        pnlPct = res.pnlPct;
        holdingDays = res.holdingDays;
        if (res.position) this.store.savePosition(fresh.id, res.position);
        else this.store.deletePosition(fresh.id, order.symbol);
      }
      const inserted = this.store.insertTrade({
        userId: fresh.userId,
        portfolioId: fresh.id,
        orderId: order.id,
        signalId: order.signalId,
        fillKey,
        date,
        symbol: order.symbol,
        side: order.side,
        qty: delta,
        price: avgPrice,
        value: round(avgPrice * delta, 2),
        cost,
        pnl,
        pnlPct,
        holdingDays,
        reason,
      });
      if (!inserted) return { applied: 0, duplicate: true };
      const cash = fresh.cash + cashDelta(order.side, avgPrice, delta, cost);
      this.store.updatePortfolio(fresh.id, { cash: round(cash, 2) });
      this.store.updateOrder(order.id, { appliedQty: cumulativeQty });
      return { applied: delta, cost, pnl, cash };
    });
  }

  deposit(portfolio, amount, note) {
    const fresh = this.store.getPortfolioById(portfolio.id);
    this.store.tx(() => {
      this.store.updatePortfolio(fresh.id, { cash: round(fresh.cash + amount, 2), peakEquity: fresh.peakEquity + amount });
      this.store.addCapitalEvent({ userId: fresh.userId, portfolioId: fresh.id, kind: 'DEPOSIT', amount, note });
    });
    return this.store.getPortfolioById(fresh.id);
  }

  withdraw(portfolio, amount, note) {
    const fresh = this.store.getPortfolioById(portfolio.id);
    if (amount > fresh.cash + 1e-6) {
      const err = new Error('Withdrawal exceeds available cash; sell positions first (see Decision Center)');
      err.code = 'INSUFFICIENT_CASH';
      throw err;
    }
    this.store.tx(() => {
      this.store.updatePortfolio(fresh.id, { cash: round(fresh.cash - amount, 2), peakEquity: Math.max(0, fresh.peakEquity - amount) });
      this.store.addCapitalEvent({ userId: fresh.userId, portfolioId: fresh.id, kind: 'WITHDRAWAL', amount: -amount, note });
    });
    return this.store.getPortfolioById(fresh.id);
  }

  snapshot(portfolio, priceOf, date = istDate(this.clock())) {
    const fresh = this.store.getPortfolioById(portfolio.id);
    const v = this.value(fresh, priceOf);
    this.store.saveEquitySnapshot(fresh.id, date, v.equity, fresh.cash, v.invested);
    if (v.equity > fresh.peakEquity) this.store.updatePortfolio(fresh.id, { peakEquity: v.equity });
    return v;
  }

  /** Persist ratcheted stops / peaks computed by the engine for held positions. */
  applyHoldUpdates(portfolio, decisions, priceOf) {
    for (const d of decisions) {
      if (!['HOLD', 'REDUCE'].includes(d.action) || !d.risk) continue;
      const pos = this.store.getPosition(portfolio.id, d.symbol);
      if (!pos) continue;
      const stop = Number.isFinite(d.risk.stopPrice) ? Math.max(pos.stopPrice ?? 0, d.risk.stopPrice) : pos.stopPrice;
      const peak = Math.max(pos.peakClose || pos.avgPrice, d.risk.peakClose || 0, priceOf(d.symbol) || 0);
      if (stop !== pos.stopPrice || peak !== pos.peakClose) this.store.savePosition(portfolio.id, { ...pos, stopPrice: stop, peakClose: peak });
    }
  }
}

module.exports = { PortfolioService };
