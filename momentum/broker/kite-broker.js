'use strict';

const crypto = require('crypto');
const kiteServiceDefault = require('../../services/kite.service');
const { roundTick } = require('../utils/math');

/** Kite `tag`: max 20 alphanumeric chars. Derived from the idempotency key so a lost response can be recovered. */
function tagFor(idempotencyKey) {
  return `M${crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex').slice(0, 15)}`;
}

function mapKiteStatus(o) {
  const st = String(o.status || '').toUpperCase();
  const filled = Number(o.filled_quantity) || 0;
  const qty = Number(o.quantity) || 0;
  if (st === 'COMPLETE') return 'FILLED';
  if (st === 'REJECTED') return 'REJECTED';
  if (st === 'CANCELLED') return filled > 0 ? 'PARTIALLY_FILLED_CANCELLED' : 'CANCELLED';
  if (filled > 0 && filled < qty) return 'PARTIALLY_FILLED';
  return 'OPEN';
}

/**
 * Real broker adapter. Order placement is NEVER retried blindly: an ambiguous
 * outcome (timeout, 5xx) returns UNKNOWN and is resolved by looking the order
 * up by its tag, so a network error cannot create a duplicate order.
 */
class KiteBroker {
  constructor({ getAuthorization, kite = kiteServiceDefault }) {
    this.id = 'kite';
    this.isLive = true;
    this.getAuthorization = getAuthorization;
    this.kite = kite;
  }

  async auth() {
    const a = await this.getAuthorization();
    if (!a) throw Object.assign(new Error('Kite session missing or expired'), { code: 'NO_SESSION' });
    return a;
  }

  async place(order) {
    const authorization = await this.auth();
    const tag = tagFor(order.idempotencyKey);
    const fields = {
      exchange: 'NSE',
      tradingsymbol: order.symbol,
      transaction_type: order.side,
      quantity: String(order.qty),
      product: 'CNC',
      order_type: order.limitPrice != null ? 'LIMIT' : 'MARKET',
      validity: 'DAY',
      tag,
    };
    if (order.limitPrice != null) fields.price = String(roundTick(order.limitPrice));
    let res;
    try {
      res = await this.kite.placeOrder(authorization, order.variety || 'regular', fields);
    } catch (err) {
      return { status: 'UNKNOWN', message: `Network error while placing order (${err.code || err.message}); will reconcile by tag`, tag };
    }
    if (res.status >= 500) return { status: 'UNKNOWN', message: `Broker HTTP ${res.status}; will reconcile by tag`, tag };
    if (res.status >= 400 || res.data?.status === 'error') {
      return { status: 'REJECTED', message: res.data?.message || `Broker HTTP ${res.status}`, tag };
    }
    const brokerOrderId = res.data?.data?.order_id;
    if (!brokerOrderId) return { status: 'UNKNOWN', message: 'Broker accepted the request but returned no order id; will reconcile by tag', tag };
    return { status: 'SUBMITTED', brokerOrderId: String(brokerOrderId), filledQty: 0, message: 'Order accepted by broker', tag };
  }

  async listOrders() {
    const authorization = await this.auth();
    const res = await this.kite.getOrders(authorization);
    if (res.status >= 400 || res.data?.status === 'error') throw new Error(res.data?.message || `orders HTTP ${res.status}`);
    return res.data?.data || [];
  }

  toResult(o) {
    return {
      status: mapKiteStatus(o),
      brokerOrderId: String(o.order_id),
      filledQty: Number(o.filled_quantity) || 0,
      avgPrice: Number(o.average_price) || null,
      message: o.status_message || o.status,
    };
  }

  async getOrder(order) {
    const list = await this.listOrders();
    const hit = list.find((o) => String(o.order_id) === String(order.brokerOrderId));
    if (!hit) return { status: 'UNKNOWN', message: 'Order not visible at broker yet' };
    return this.toResult(hit);
  }

  async findByTag(idempotencyKey) {
    const tag = tagFor(idempotencyKey);
    const list = await this.listOrders();
    const hit = list.find((o) => o.tag === tag);
    return hit ? this.toResult(hit) : null;
  }

  async cancel(order) {
    const authorization = await this.auth();
    const res = await this.kite.cancelOrder(authorization, order.variety || 'regular', order.brokerOrderId);
    if (res.status >= 400) return { status: 'UNKNOWN', message: res.data?.message || `Cancel HTTP ${res.status}` };
    return { status: 'CANCELLED', brokerOrderId: order.brokerOrderId };
  }

  async funds() {
    const { fetchUserMargins } = require('../../services/kite-market');
    return fetchUserMargins(await this.auth());
  }

  async holdings() {
    const authorization = await this.auth();
    const res = await this.kite.getHoldings(authorization);
    if (res.status >= 400 || res.data?.status === 'error') throw new Error(res.data?.message || `holdings HTTP ${res.status}`);
    return (res.data?.data || []).map((h) => ({
      symbol: String(h.tradingsymbol || '').toUpperCase(),
      exchange: String(h.exchange || 'NSE').toUpperCase(),
      qty: Math.floor(Number(h.quantity) || 0),
      avgPrice: Number(h.average_price) || 0,
      lastPrice: Number(h.last_price) || 0,
    }));
  }
}

module.exports = { KiteBroker, tagFor, mapKiteStatus };
