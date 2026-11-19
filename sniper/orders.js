'use strict';

const { kiteService } = require('../services/kite.service');

const BUY_TAG = 'PALAGAI_SNIPER';
const SL_TAG = 'PALAGAI_SNIPER_SL';
const EXIT_TAG = 'PALAGAI_SNIPER_X';
const SL_LIMIT_SLIP_RS = 20;

function exchangeOf(under) {
  if (under === 'crude') return 'MCX';
  if (under === 'sensex') return 'BFO';
  return 'NFO';
}

function qtyOf(book) {
  const n = Math.floor(Number(book?.qty) || 0);
  return n > 0 ? n : 0;
}

function roundToTick(value, tick) {
  const t = tick > 0 ? tick : 0.05;
  return Math.round(value / t) * t;
}

function slLimitPrice(trigger, qty, tick) {
  const t = tick > 0 ? tick : 0.05;
  const trig = roundToTick(Number(trigger), t);
  const n = Math.max(1, Math.floor(Number(qty) || 0) || 1);
  return roundToTick(Math.max(t, trig - SL_LIMIT_SLIP_RS / n), t);
}

function ticketOk(book) {
  return !!(book && Number(book.optionToken) > 0 && String(book.optionSymbol || '').trim() && qtyOf(book) > 0);
}

function buyFields(book) {
  if (!ticketOk(book)) return null;
  return {
    exchange: exchangeOf(book.id || book.under),
    tradingsymbol: book.optionSymbol,
    transaction_type: 'BUY',
    order_type: 'MARKET',
    quantity: String(qtyOf(book)),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: BUY_TAG,
  };
}

function stopFields(book) {
  if (!ticketOk(book)) return null;
  const trig = roundToTick(Number(book.sl), 0.05);
  if (!(trig > 0)) return null;
  const exchange = exchangeOf(book.id || book.under);
  const qty = String(qtyOf(book));
  return {
    exchange,
    tradingsymbol: book.optionSymbol,
    transaction_type: 'SELL',
    order_type: 'SL',
    quantity: qty,
    product: 'MIS',
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    price: slLimitPrice(trig, qtyOf(book), 0.05).toFixed(2),
    tag: SL_TAG,
  };
}

function exitFields(book) {
  if (!ticketOk(book)) return null;
  return {
    exchange: exchangeOf(book.id || book.under),
    tradingsymbol: book.optionSymbol,
    transaction_type: 'SELL',
    order_type: 'MARKET',
    quantity: String(qtyOf(book)),
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
  return res?.data?.message || res?.data?.error_type || fallback || `Kite HTTP ${res?.status || '?'}`;
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
