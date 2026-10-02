/**
 * Charts Protect flatten — cancel every resting MIS SELL, then MARKET SELL.
 * Kite rejects a second SELL while the stop still holds qty. Never rest TP.
 */
'use strict';

const { atmExitFields, atmStopFields, hitPlannedLevel, restingSellIds } = require('./levels');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const SL_GRACE_MS = 15_000;

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

function openQty(positions, instrument) {
  const symbol = String(instrument || '').trim().toUpperCase();
  for (const pos of positions) {
    if (String(pos.tradingsymbol || '').trim().toUpperCase() !== symbol) continue;
    if (String(pos.product || 'MIS').toUpperCase() !== 'MIS') continue;
    const qty = Math.abs(Number(pos.quantity) || 0);
    if (qty > 0) return qty;
  }
  return 0;
}

function lastPrice(positions, quotes, fill) {
  const symbol = String(fill.instrument || '').trim().toUpperCase();
  for (const pos of positions) {
    if (String(pos.tradingsymbol || '').trim().toUpperCase() !== symbol) continue;
    const last = Number(pos.last_price);
    if (last > 0) return last;
  }
  const crude = /crude/i.test(fill.instrument || '');
  const key = `${fill.exchange || (crude ? 'MCX' : 'NFO')}:${fill.instrument}`;
  const q = quotes && (quotes[key] || quotes[fill.instrument]);
  const last = Number(q?.last_price);
  return last > 0 ? last : null;
}

async function cancelRestingSells(kite, authorization, instrument) {
  const orderRes = await kite.getOrders(authorization);
  const ids = restingSellIds(asOrders(orderRes), instrument);
  const messages = [];
  for (const id of ids) {
    const res = await kite.cancelOrder(authorization, 'regular', id);
    const body = kiteBody(res);
    messages.push(body.message || `cancelled ${id}`);
  }
  return { ids, messages };
}

/**
 * The live-safe exit: cancel SL (and any leftover TP), wait until qty is free,
 * then MARKET SELL tagged PALAGAI_CHART_EXIT. Skip the sell if a stop is still live.
 */
async function flattenFill(kite, authorization, fill, reason) {
  const extras = [...(await cancelRestingSells(kite, authorization, fill.instrument)).messages];
  await delay(400);
  let remaining = restingSellIds(asOrders(await kite.getOrders(authorization)), fill.instrument);
  if (remaining.length) {
    extras.push(...(await cancelRestingSells(kite, authorization, fill.instrument)).messages);
    await delay(400);
    remaining = restingSellIds(asOrders(await kite.getOrders(authorization)), fill.instrument);
  }
  const posRes = await kite.getPositions(authorization);
  const qty = openQty(asPositions(posRes), fill.instrument);
  const label = reason === 'PROFIT' ? 'Max profit' : 'Max loss';
  if (!(qty > 0)) {
    return { ok: true, alreadyFlat: true, message: `${label} — already flat on ${fill.instrument}. ${extras.join(' ')}`.trim() };
  }
  if (remaining.length) {
    return {
      ok: false,
      message: `${label} — stop still live on ${fill.instrument}, sell skipped. ${extras.join(' ')}`.trim(),
    };
  }
  const fields = atmExitFields({ ...fill, qty });
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
  const ids = restingSellIds(asOrders(await kite.getOrders(authorization)), fill.instrument);
  if (ids.length) return { ok: true, skipped: true, message: 'SL already resting' };
  const fields = atmStopFields(fill, stop);
  if (!fields) return { ok: false, message: 'Could not rest stop' };
  const placed = await kite.placeOrder(authorization, 'regular', fields);
  const body = kiteBody(placed);
  const orderId = body.data?.order_id || null;
  if (orderId) slPlacedAt.set(fill.instrument, Date.now());
  return { ok: !!orderId, orderId, message: body.message || (orderId ? `SL ${orderId}` : 'SL failed') };
}

function decideFillAction(fill, last, now = Date.now(), slPlacedAt = new Map()) {
  if (fill.slPlacedAt && now - fill.slPlacedAt < SL_GRACE_MS) return { action: 'wait', reason: 'SL grace' };
  const inst = fill.instrument;
  if (slPlacedAt.get(inst) && now - slPlacedAt.get(inst) < SL_GRACE_MS) {
    return { action: 'wait', reason: 'SL grace' };
  }
  const hit = hitPlannedLevel(last, { stop: fill.stop, target: fill.target });
  if (hit) return { action: 'flatten', reason: hit };
  return { action: 'hold' };
}

module.exports = {
  SL_GRACE_MS,
  kiteBody,
  asOrders,
  asPositions,
  openQty,
  lastPrice,
  cancelRestingSells,
  flattenFill,
  ensureStop,
  decideFillAction,
};
