'use strict';

const { kiteService } = require('../services/kite.service');

const BUY_TAG = 'PALAGAI_PAPER';
const SL_TAG = 'PALAGAI_PAPER_SL';
const EXIT_TAG = 'PALAGAI_PAPER_X';

function exchangeOf(under) {
  if (under === 'crude') return 'MCX';
  if (under === 'sensex') return 'BFO';
  return 'NFO';
}

function qtyOf(under, lot) {
  if (under === 'crude') return 1;
  const n = Math.floor(Number(lot) || 0);
  return n > 0 ? n : 1;
}

function roundToTick(value, tick) {
  const t = tick > 0 ? tick : 0.05;
  return Math.round(value / t) * t;
}

function ticketOk(book) {
  return !!(book && Number(book.optionToken) > 0 && String(book.optionSymbol || '').trim());
}

function buyFields(book) {
  if (!ticketOk(book)) return null;
  const under = book.under || '';
  return {
    exchange: exchangeOf(under),
    tradingsymbol: book.optionSymbol,
    transaction_type: 'BUY',
    order_type: 'MARKET',
    quantity: String(qtyOf(under, book.lot)),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: BUY_TAG,
  };
}

function stopFields(book) {
  if (!ticketOk(book)) return null;
  const trig = roundToTick(Number(book.sl), 0.05);
  if (!(trig > 0) || trig >= 1e9) return null;
  const under = book.under || '';
  return {
    exchange: exchangeOf(under),
    tradingsymbol: book.optionSymbol,
    transaction_type: 'SELL',
    order_type: 'SL',
    quantity: String(qtyOf(under, book.lot)),
    product: 'MIS',
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    price: roundToTick(Math.max(0.05, trig * 0.9), 0.05).toFixed(2),
    tag: SL_TAG,
  };
}

function exitFields(book) {
  if (!ticketOk(book)) return null;
  const under = book.under || '';
  return {
    exchange: exchangeOf(under),
    tradingsymbol: book.optionSymbol,
    transaction_type: 'SELL',
    order_type: 'MARKET',
    quantity: String(qtyOf(under, book.lot)),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: EXIT_TAG,
  };
}

function orderIdOf(res) {
  const id = res?.data?.data?.order_id ?? res?.data?.order_id;
  const s = id != null ? String(id).trim() : '';
  return s || null;
}

function openBuyId(orders, symbol) {
  const want = String(symbol || '').trim().toUpperCase();
  if (!want) return null;
  for (const o of orders || []) {
    if (String(o.tradingsymbol || '').trim().toUpperCase() !== want) continue;
    if (String(o.transaction_type || '').toUpperCase() !== 'BUY') continue;
    if (String(o.tag || '').toUpperCase() !== BUY_TAG) continue;
    const status = String(o.status || '').trim().toUpperCase();
    if (status === 'REJECTED' || status === 'CANCELLED' || status === 'EXPIRED') continue;
    const id = o.order_id != null ? String(o.order_id).trim() : '';
    if (id) return id;
  }
  return null;
}

function orderErrorOf(res, fallback) {
  return (
    res?.data?.message ||
    res?.data?.error_type ||
    fallback ||
    `Kite HTTP ${res?.status || '?'}`
  );
}

async function place(authorization, fields) {
  const res = await kiteService.placeOrder(authorization, 'regular', fields);
  if (res.status >= 400 || res.data?.status === 'error') {
    throw new Error(orderErrorOf(res, 'Order rejected'));
  }
  const id = orderIdOf(res);
  if (!id) throw new Error('Kite returned no order id');
  return id;
}

async function cancel(authorization, orderId) {
  if (!orderId) return;
  const res = await kiteService.cancelOrder(authorization, 'regular', orderId);
  if (res.status >= 400 && res.status !== 404 && res.data?.status === 'error') {
    throw new Error(orderErrorOf(res, 'Cancel failed'));
  }
}

module.exports = {
  BUY_TAG,
  SL_TAG,
  EXIT_TAG,
  buyFields,
  stopFields,
  exitFields,
  place,
  cancel,
  openBuyId,
  ticketOk,
  qtyOf,
  exchangeOf,
};
