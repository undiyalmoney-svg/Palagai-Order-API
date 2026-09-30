'use strict';

const { roundPrice } = require('../utils/math');

/**
 * Paper broker: simulates an exchange fill against the latest price with
 * slippage. It never touches a real account.
 *
 * `partialFillPct < 1` produces a genuine partial fill first; the remainder
 * is reported the next time the order is reconciled, exactly like a real
 * broker, so the partial-fill path is exercised end to end.
 */
class PaperBroker {
  constructor({ priceFor, slippageBps = 5, partialFillPct = 1 }) {
    this.id = 'paper';
    this.isLive = false;
    this.priceFor = priceFor;
    this.slippageBps = slippageBps;
    this.partialFillPct = partialFillPct;
    this.book = new Map();
  }

  fillPrice(order) {
    const p = this.priceFor(order.symbol);
    if (!p) return null;
    const slip = this.slippageBps / 10_000;
    const px = order.side === 'BUY' ? p.price * (1 + slip) : p.price * (1 - slip);
    return roundPrice(px);
  }

  async place(order) {
    const px = this.fillPrice(order);
    if (!px) return { status: 'REJECTED', message: `No price available for ${order.symbol}` };
    if (order.limitPrice != null) {
      const crosses = order.side === 'BUY' ? px <= order.limitPrice : px >= order.limitPrice;
      if (!crosses) return { status: 'REJECTED', message: `Limit ${order.limitPrice} not marketable at ${px}` };
    }
    const brokerOrderId = `PAPER-${order.id}`;
    const first = this.partialFillPct >= 1 ? order.qty : Math.max(1, Math.floor(order.qty * this.partialFillPct));
    this.book.set(brokerOrderId, { qty: order.qty, price: px });
    return {
      status: first >= order.qty ? 'FILLED' : 'PARTIALLY_FILLED',
      brokerOrderId,
      filledQty: first,
      avgPrice: px,
      message: first >= order.qty ? 'Paper fill' : `Paper partial fill ${first}/${order.qty}`,
    };
  }

  async getOrder(order) {
    const rec = this.book.get(order.brokerOrderId) || { qty: order.qty, price: order.avgFillPrice };
    return { status: 'FILLED', brokerOrderId: order.brokerOrderId, filledQty: rec.qty, avgPrice: rec.price, message: 'Paper fill completed' };
  }

  async cancel(order) {
    return { status: order.filledQty > 0 ? 'FILLED' : 'CANCELLED', brokerOrderId: order.brokerOrderId, filledQty: order.filledQty, avgPrice: order.avgFillPrice };
  }

  async findByTag() {
    return null;
  }
}

module.exports = { PaperBroker };
