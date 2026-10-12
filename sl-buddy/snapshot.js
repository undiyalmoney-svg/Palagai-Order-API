'use strict';

const {
  BOOK_LABELS,
  OPENISH,
  PENDING_BUY,
  bookFromInstrument,
  isWatchedDerivative,
  orderQty,
  restingSellQty,
  stopPrice,
  uncoveredQty,
} = require('./rules');

function kiteBody(res) {
  return res && typeof res === 'object' && res.data && typeof res.data === 'object' ? res.data : {};
}

function asOrders(payload) {
  const data = kiteBody(payload).data;
  return Array.isArray(data) ? data : [];
}

function asPositions(payload) {
  const data = kiteBody(payload).data || {};
  const day = Array.isArray(data.day) ? data.day : [];
  const net = Array.isArray(data.net) ? data.net : [];
  return day.length ? day : net;
}

function rowBook(row) {
  return bookFromInstrument(row?.tradingsymbol || row?.instrument);
}

function classify(orders, positions) {
  const pending = [];
  const sl = [];

  for (const order of orders || []) {
    if (!isWatchedDerivative(order)) continue;
    const book = rowBook(order);
    const status = String(order.status || '').toUpperCase();
    const side = String(order.transaction_type || '').toUpperCase();
    const instrument = String(order.tradingsymbol || '').trim();
    const base = {
      orderId: String(order.order_id || '').trim() || null,
      instrument,
      exchange: String(order.exchange || '').toUpperCase() || null,
      book,
      bookLabel: BOOK_LABELS[book] || book,
      product: String(order.product || 'MIS').toUpperCase(),
      qty: orderQty(order),
      price: Number(order.price) || Number(order.trigger_price) || null,
      status,
      tag: order.tag || null,
    };
    if (side === 'BUY' && PENDING_BUY.has(status) && base.qty > 0) {
      pending.push({ ...base, side: 'BUY' });
    }
    if (side === 'SELL' && OPENISH.has(status) && base.qty > 0) {
      const orderType = String(order.order_type || '').toUpperCase();
      if (orderType === 'SL' || orderType === 'SL-M') {
        sl.push({
          ...base,
          side: 'SELL',
          orderType,
          trigger: Number(order.trigger_price) || null,
        });
      }
    }
  }

  const live = [];
  for (const pos of positions || []) {
    if (!isWatchedDerivative(pos)) continue;
    const book = rowBook(pos);
    const qty = Math.floor(Number(pos.quantity) || 0);
    if (!(qty > 0)) continue;
    const instrument = String(pos.tradingsymbol || '').trim();
    const entry = Number(pos.average_price) || null;
    const stop = entry ? stopPrice(book, entry) : null;
    const slQty = restingSellQty(orders, instrument);
    live.push({
      instrument,
      exchange: String(pos.exchange || '').toUpperCase() || null,
      book,
      bookLabel: BOOK_LABELS[book] || book,
      product: String(pos.product || 'MIS').toUpperCase(),
      qty,
      entry,
      stop,
      slQty,
      uncoveredQty: uncoveredQty(qty, slQty),
    });
  }

  return { pending, live, sl };
}

module.exports = { kiteBody, asOrders, asPositions, classify };
