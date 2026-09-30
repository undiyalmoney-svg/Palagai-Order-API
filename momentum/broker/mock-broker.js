'use strict';

/**
 * Scriptable broker for tests and dry runs. Behaviour per call is chosen by a
 * queue of scripted responses so every failure path (reject, timeout, partial
 * fill, lost response) can be reproduced deterministically.
 */
class MockBroker {
  constructor({ live = true } = {}) {
    this.id = 'mock';
    this.isLive = live;
    this.script = [];
    this.placed = [];
    this.remote = new Map();
    this.seq = 0;
  }

  enqueue(...responses) {
    this.script.push(...responses);
    return this;
  }

  async place(order) {
    this.placed.push(order);
    const next = this.script.shift() || { status: 'FILLED' };
    if (next.throw) throw new Error(next.throw);
    const brokerOrderId = next.brokerOrderId || `MOCK-${(this.seq += 1)}`;
    const price = next.avgPrice ?? order.limitPrice ?? order.priceRef;
    const filledQty = next.filledQty ?? (next.status === 'FILLED' ? order.qty : 0);
    if (!next.lost) this.remote.set(brokerOrderId, { ...next, brokerOrderId, filledQty, avgPrice: price, tag: order.idempotencyKey, qty: order.qty });
    else this.remote.set(brokerOrderId, { status: next.remoteStatus || 'OPEN', brokerOrderId, filledQty: 0, avgPrice: price, tag: order.idempotencyKey, qty: order.qty });
    return { status: next.status, brokerOrderId: next.lost ? undefined : brokerOrderId, filledQty, avgPrice: price, message: next.message || `mock ${next.status}` };
  }

  async getOrder(order) {
    const r = this.remote.get(order.brokerOrderId);
    if (!r) return { status: 'UNKNOWN', message: 'not found' };
    if (r.later) {
      Object.assign(r, r.later);
      delete r.later;
    }
    return { status: r.status, brokerOrderId: r.brokerOrderId, filledQty: r.filledQty, avgPrice: r.avgPrice, message: 'mock' };
  }

  async findByTag(key) {
    for (const r of this.remote.values()) if (r.tag === key) return { status: r.status, brokerOrderId: r.brokerOrderId, filledQty: r.filledQty, avgPrice: r.avgPrice };
    return null;
  }

  async cancel(order) {
    const r = this.remote.get(order.brokerOrderId);
    if (r) r.status = 'CANCELLED';
    return { status: 'CANCELLED', brokerOrderId: order.brokerOrderId };
  }
}

module.exports = { MockBroker };
