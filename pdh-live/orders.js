/**
 * NSE equity MIS orders for prior-day live money.
 * Entry is MARKET. Protective stop is SL-M at the prior-day level.
 * 1R / 15:15 / Stop flatten cancel the resting SL first, then MARKET the other side.
 */
'use strict';

const PHRASE = 'START LIVE MONEY';
const TAG = 'PALAGAI_PDH';
const SL_TAG = 'PALAGAI_PDH_SL';
const EXIT_TAG = 'PALAGAI_PDH_EXIT';
const SL_GRACE_MS = 15_000;
const OPENISH = new Set(['OPEN', 'TRIGGER PENDING', 'VALIDATION PENDING']);
const STOPISH = new Set(['SL', 'SL-M', 'SL-L']);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function roundToTick(value, tick = 0.05) {
  const step = tick > 0 ? tick : 0.05;
  return Math.round(Number(value) / step) * step;
}

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

function signedQty(positions, instrument) {
  const symbol = String(instrument || '').trim().toUpperCase();
  for (const pos of positions || []) {
    if (String(pos.tradingsymbol || '').trim().toUpperCase() !== symbol) continue;
    if (String(pos.product || 'MIS').toUpperCase() !== 'MIS') continue;
    const qty = Number(pos.quantity) || 0;
    if (qty !== 0) return qty;
  }
  return 0;
}

function lastPrice(positions, quotes, fill) {
  const symbol = String(fill.instrument || '').trim().toUpperCase();
  for (const pos of positions || []) {
    if (String(pos.tradingsymbol || '').trim().toUpperCase() !== symbol) continue;
    const last = Number(pos.last_price);
    if (last > 0) return last;
  }
  const key = `${fill.exchange || 'NSE'}:${fill.instrument}`;
  const q = quotes && (quotes[key] || quotes[fill.instrument] || quotes[symbol]);
  const last = Number(q?.last_price);
  return last > 0 ? last : null;
}

function targetPx(fill) {
  const entry = Number(fill.entry);
  const stop = Number(fill.stop);
  const risk = Math.abs(entry - stop);
  if (!(entry > 0) || !(risk > 0)) return null;
  return fill.side === 'S' ? roundToTick(entry - risk) : roundToTick(entry + risk);
}

function entryFields(fill) {
  const qty = Math.floor(Number(fill.qty) || 0);
  const symbol = String(fill.instrument || '').trim();
  if (!(qty > 0) || !symbol) return null;
  return {
    exchange: fill.exchange || 'NSE',
    tradingsymbol: symbol,
    transaction_type: fill.side === 'S' ? 'SELL' : 'BUY',
    order_type: 'MARKET',
    quantity: String(qty),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: TAG,
  };
}

function slFields(fill, stop) {
  const qty = Math.floor(Number(fill.qty) || 0);
  const symbol = String(fill.instrument || '').trim();
  const trig = roundToTick(Number(stop));
  if (!(qty > 0) || !symbol || !(trig > 0)) return null;
  return {
    exchange: fill.exchange || 'NSE',
    tradingsymbol: symbol,
    transaction_type: fill.side === 'S' ? 'BUY' : 'SELL',
    order_type: 'SL-M',
    quantity: String(qty),
    product: 'MIS',
    validity: 'DAY',
    trigger_price: trig.toFixed(2),
    market_protection: '-1',
    tag: SL_TAG,
  };
}

function exitFields(fill, qty) {
  const size = Math.floor(Number(qty != null ? qty : fill.qty) || 0);
  const symbol = String(fill.instrument || '').trim();
  if (!(size > 0) || !symbol) return null;
  return {
    exchange: fill.exchange || 'NSE',
    tradingsymbol: symbol,
    transaction_type: fill.side === 'S' ? 'BUY' : 'SELL',
    order_type: 'MARKET',
    quantity: String(size),
    product: 'MIS',
    validity: 'DAY',
    market_protection: '-1',
    tag: EXIT_TAG,
  };
}

function restingProtectIds(orders, instrument) {
  const symbol = String(instrument || '').trim().toUpperCase();
  if (!symbol) return [];
  const ids = [];
  for (const order of orders || []) {
    if (String(order.tradingsymbol || '').trim().toUpperCase() !== symbol) continue;
    if (!OPENISH.has(String(order.status || '').toUpperCase())) continue;
    if (String(order.product || 'MIS').toUpperCase() !== 'MIS') continue;
    const type = String(order.order_type || '').toUpperCase();
    const tag = String(order.tag || '').toUpperCase();
    if (!STOPISH.has(type) && tag !== SL_TAG) continue;
    const id = String(order.order_id || '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function isPdhTag(tag) {
  const t = String(tag || '').toUpperCase();
  return t === TAG || t === SL_TAG || t === EXIT_TAG;
}

function decideFillAction(fill, last, now = Date.now(), slPlacedAt = new Map()) {
  const inst = fill.instrument;
  if (fill.slPlacedAt && now - fill.slPlacedAt < SL_GRACE_MS) return { action: 'wait', reason: 'SL grace' };
  if (slPlacedAt.get(inst) && now - slPlacedAt.get(inst) < SL_GRACE_MS) {
    return { action: 'wait', reason: 'SL grace' };
  }
  const minutes =
    typeof now === 'number'
      ? new Date(now).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      : null;
  const hm = minutes && minutes.slice(0, 5);
  if (hm && hm >= '15:15') return { action: 'flatten', reason: 'EOD' };
  if (last == null || !Number.isFinite(last)) return { action: 'hold' };
  const stop = Number(fill.stop);
  const target = targetPx(fill);
  if (fill.side === 'S') {
    if (stop > 0 && last >= stop) return { action: 'flatten', reason: 'SL' };
    if (target > 0 && last <= target) return { action: 'flatten', reason: 'TARGET' };
  } else {
    if (stop > 0 && last <= stop) return { action: 'flatten', reason: 'SL' };
    if (target > 0 && last >= target) return { action: 'flatten', reason: 'TARGET' };
  }
  return { action: 'hold' };
}

async function cancelRestingProtect(kite, authorization, instrument) {
  const orderRes = await kite.getOrders(authorization);
  const ids = restingProtectIds(asOrders(orderRes), instrument);
  const messages = [];
  for (const id of ids) {
    const res = await kite.cancelOrder(authorization, 'regular', id);
    const body = kiteBody(res);
    messages.push(body.message || `cancelled ${id}`);
  }
  return { ids, messages };
}

async function flattenFill(kite, authorization, fill, reason) {
  const extras = [...(await cancelRestingProtect(kite, authorization, fill.instrument)).messages];
  await delay(400);
  let remaining = restingProtectIds(asOrders(await kite.getOrders(authorization)), fill.instrument);
  if (remaining.length) {
    extras.push(...(await cancelRestingProtect(kite, authorization, fill.instrument)).messages);
    await delay(400);
    remaining = restingProtectIds(asOrders(await kite.getOrders(authorization)), fill.instrument);
  }
  const posRes = await kite.getPositions(authorization);
  const qty = Math.abs(signedQty(asPositions(posRes), fill.instrument));
  const label = reason === 'TARGET' ? '1R' : reason === 'EOD' ? '15:15' : reason === 'STOP' ? 'Stop flatten' : 'Stop';
  if (!(qty > 0)) {
    return { ok: true, alreadyFlat: true, message: `${label} — already flat on ${fill.instrument}. ${extras.join(' ')}`.trim() };
  }
  if (remaining.length) {
    return {
      ok: false,
      message: `${label} — stop still live on ${fill.instrument}, flatten skipped. ${extras.join(' ')}`.trim(),
    };
  }
  const fields = exitFields({ ...fill, qty }, qty);
  const placed = await kite.placeOrder(authorization, 'regular', fields);
  const body = kiteBody(placed);
  const http = placed.status || 0;
  const orderId = body.data?.order_id || null;
  const ok = http < 400 && (body.status === 'success' || orderId);
  return {
    ok: !!ok,
    orderId,
    message: `${label} — ${body.message || (orderId ? `exit ${orderId}` : 'exit sent')} · ${extras.join(' ')}`.trim(),
  };
}

async function ensureStop(kite, authorization, fill, stop, slPlacedAt) {
  const last = slPlacedAt.get(fill.instrument) || 0;
  if (Date.now() - last < SL_GRACE_MS) return { ok: true, skipped: true, message: 'SL grace' };
  const ids = restingProtectIds(asOrders(await kite.getOrders(authorization)), fill.instrument);
  if (ids.length) return { ok: true, skipped: true, message: 'SL already resting', orderId: ids[0] };
  const fields = slFields(fill, stop);
  if (!fields) return { ok: false, message: 'Could not rest SL-M' };
  const placed = await kite.placeOrder(authorization, 'regular', fields);
  const body = kiteBody(placed);
  const orderId = body.data?.order_id || null;
  if (orderId) slPlacedAt.set(fill.instrument, Date.now());
  return { ok: !!orderId, orderId, message: body.message || (orderId ? `SL-M ${orderId}` : 'SL-M failed') };
}

function phraseOk(value) {
  return String(value || '').trim() === PHRASE;
}

function confirmOk(body) {
  if (body && body.confirm === true) return true;
  return phraseOk(body?.phrase);
}

module.exports = {
  PHRASE,
  TAG,
  SL_TAG,
  EXIT_TAG,
  SL_GRACE_MS,
  kiteBody,
  asOrders,
  asPositions,
  signedQty,
  lastPrice,
  targetPx,
  entryFields,
  slFields,
  exitFields,
  restingProtectIds,
  isPdhTag,
  decideFillAction,
  cancelRestingProtect,
  flattenFill,
  ensureStop,
  phraseOk,
  confirmOk,
  roundToTick,
};
