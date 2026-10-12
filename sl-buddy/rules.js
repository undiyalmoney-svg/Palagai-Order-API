/**
 * SL Buddy — index stop offsets on the fill's entry (premium or futures price).
 * Nifty 50 −25, Bank Nifty −55, Crude −55, Sensex −40. Same qty as the live fill.
 */
'use strict';

const OFFSETS = {
  nifty: 25,
  bank: 55,
  crude: 55,
  sensex: 40,
};

const BOOK_LABELS = {
  nifty: 'Nifty 50',
  bank: 'Bank Nifty',
  crude: 'Crude oil',
  sensex: 'Sensex',
};

const TAG = 'PALAGAI_SL_BUDDY';
const OPENISH = new Set(['OPEN', 'TRIGGER PENDING', 'VALIDATION PENDING', 'OPEN PENDING']);
const PENDING_BUY = new Set([
  'OPEN',
  'TRIGGER PENDING',
  'VALIDATION PENDING',
  'PUT ORDER REQ RECEIVED',
  'OPEN PENDING',
  'AMO REQ RECEIVED',
  'MODIFY PENDING',
]);

function roundToTick(value, tick) {
  const step = tick > 0 ? tick : 0.05;
  return Math.round(Number(value) / step) * step;
}

function bookFromInstrument(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (!s) return null;
  if (s.includes('BANKNIFTY') || s.includes('BANKEX')) return 'bank';
  if (s.includes('CRUDE')) return 'crude';
  if (s.includes('SENSEX')) return 'sensex';
  if (s.startsWith('NIFTYNXT') || s.includes('BEES') || s.startsWith('FINNIFTY') || s.startsWith('MIDCPNIFTY')) {
    return null;
  }
  if (s.startsWith('NIFTY')) return 'nifty';
  return null;
}

function isWatchedDerivative(row) {
  const book = bookFromInstrument(row?.tradingsymbol || row?.instrument);
  if (!book) return false;
  const ex = String(row?.exchange || '').toUpperCase();
  if (ex === 'NSE' || ex === 'BSE') return false;
  if (ex === 'NFO' || ex === 'MCX' || ex === 'BFO' || ex === 'BCD') return true;
  const s = String(row?.tradingsymbol || row?.instrument || '').toUpperCase();
  return /(?:CE|PE|FUT)$/.test(s);
}

function tickFor(book) {
  return book === 'crude' ? 0.1 : 0.05;
}

function stopPrice(book, entry) {
  const offset = OFFSETS[book];
  const fill = Number(entry);
  if (!offset || !(fill > 0) || !Number.isFinite(fill)) return null;
  const stop = roundToTick(fill - offset, tickFor(book));
  if (!(stop > 0)) return null;
  return stop;
}

function defaultExchange(book, row) {
  const ex = String(row?.exchange || '').toUpperCase();
  if (ex) return ex;
  if (book === 'crude') return 'MCX';
  if (book === 'sensex') return 'BFO';
  return 'NFO';
}

function orderQty(order) {
  const pending = Number(order?.pending_quantity);
  if (pending > 0) return Math.floor(pending);
  return Math.floor(Number(order?.quantity) || 0);
}

function uncoveredQty(liveQty, restingQty) {
  const live = Math.floor(Number(liveQty) || 0);
  const rest = Math.floor(Number(restingQty) || 0);
  if (!(live > 0)) return 0;
  return Math.max(0, live - rest);
}

function restingSellQty(orders, instrument) {
  const symbol = String(instrument || '').trim().toUpperCase();
  if (!symbol) return 0;
  let qty = 0;
  for (const order of orders || []) {
    if (String(order.tradingsymbol || '').trim().toUpperCase() !== symbol) continue;
    if (String(order.transaction_type || '').toUpperCase() !== 'SELL') continue;
    if (!OPENISH.has(String(order.status || '').toUpperCase())) continue;
    qty += orderQty(order);
  }
  return qty;
}

function slOrderFields(fill, qty, stop) {
  const book = fill.book || bookFromInstrument(fill.instrument);
  const trig = roundToTick(Number(stop), tickFor(book));
  const limit = roundToTick(Math.max(tickFor(book), trig * 0.9), tickFor(book));
  const size = Math.floor(Number(qty) || 0);
  const symbol = String(fill.instrument || '').trim();
  if (!(trig > 0) || !(size > 0) || !symbol) return null;
  return {
    exchange: defaultExchange(book, fill),
    tradingsymbol: symbol,
    transaction_type: 'SELL',
    order_type: 'SL',
    quantity: String(size),
    product: String(fill.product || 'MIS').toUpperCase() || 'MIS',
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    price: limit.toFixed(2),
    tag: TAG,
  };
}

function publicRules() {
  return Object.keys(OFFSETS).map((book) => ({
    book,
    label: BOOK_LABELS[book],
    offset: OFFSETS[book],
    rule: `${BOOK_LABELS[book]} entry minus ${OFFSETS[book]}`,
  }));
}

module.exports = {
  OFFSETS,
  BOOK_LABELS,
  TAG,
  OPENISH,
  PENDING_BUY,
  roundToTick,
  bookFromInstrument,
  isWatchedDerivative,
  tickFor,
  stopPrice,
  defaultExchange,
  orderQty,
  uncoveredQty,
  restingSellQty,
  slOrderFields,
  publicRules,
};
