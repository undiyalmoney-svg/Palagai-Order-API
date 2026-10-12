/**
 * SL Buddy worker — while Watch my orders is on, rest a matching-qty SL on
 * Nifty / Bank / Crude / Sensex fills. Idle when stopped.
 */
'use strict';

const { kiteService } = require('../services/kite.service');
const { slOrderFields, stopPrice, uncoveredQty, restingSellQty } = require('./rules');
const { asOrders, asPositions, classify, kiteBody } = require('./snapshot');
const store = require('./store');

const TICK_MS = 4_000;
const SL_GRACE_MS = 15_000;
const slPlacedAt = new Map();

let timer = null;
let busy = false;
let getAuthorization = async () => null;
let saveAuthorization = () => false;
let kite = kiteService;

function parseTokenHeader(authorization) {
  const raw = String(authorization || '').trim();
  const m = /^token\s+([^:\s]+):(\S+)/i.exec(raw);
  if (!m) return null;
  return { apiKey: m[1], accessToken: m[2] };
}

function captureAuth(userId, header) {
  const parsed = parseTokenHeader(header);
  if (!userId || !parsed) return false;
  return saveAuthorization(userId, parsed.apiKey, parsed.accessToken) === true;
}

async function loadBroker(authorization) {
  const [orderRes, posRes] = await Promise.all([kite.getOrders(authorization), kite.getPositions(authorization)]);
  return { orders: asOrders(orderRes), positions: asPositions(posRes) };
}

async function ensureStop(authorization, fill, orders) {
  const last = slPlacedAt.get(fill.instrument) || 0;
  if (Date.now() - last < SL_GRACE_MS) return { ok: true, skipped: true, message: 'SL grace' };
  const stop = fill.stop || stopPrice(fill.book, fill.entry);
  if (!(stop > 0)) return { ok: true, skipped: true, message: 'stop not positive' };
  const resting = restingSellQty(orders, fill.instrument);
  const qty = uncoveredQty(fill.qty, resting);
  if (!(qty > 0)) return { ok: true, skipped: true, message: 'SL qty already matches' };
  const fields = slOrderFields(fill, qty, stop);
  if (!fields) return { ok: false, message: 'Could not rest stop' };
  const placed = await kite.placeOrder(authorization, 'regular', fields);
  const body = kiteBody(placed);
  const orderId = body.data?.order_id || null;
  if (orderId) slPlacedAt.set(fill.instrument, Date.now());
  return { ok: !!orderId, orderId, qty, stop, message: body.message || (orderId ? `SL ${orderId}` : 'SL failed') };
}

async function inspect(authorization, { place } = { place: false }) {
  const { orders, positions } = await loadBroker(authorization);
  const snapshot = classify(orders, positions);
  const placed = [];
  if (place) {
    let workingOrders = orders;
    for (const fill of snapshot.live) {
      const result = await ensureStop(authorization, fill, workingOrders);
      if (result.ok && result.orderId) {
        placed.push(result);
        workingOrders = [
          ...workingOrders,
          {
            order_id: result.orderId,
            tradingsymbol: fill.instrument,
            transaction_type: 'SELL',
            status: 'TRIGGER PENDING',
            product: fill.product,
            quantity: result.qty,
            pending_quantity: result.qty,
            order_type: 'SL',
            trigger_price: result.stop,
            tag: 'PALAGAI_SL_BUDDY',
            exchange: fill.exchange,
          },
        ];
      } else if (!result.ok && !result.skipped) {
        snapshot.placeError = result.message;
      }
    }
    if (placed.length) {
      const refreshed = await loadBroker(authorization);
      const next = classify(refreshed.orders, refreshed.positions);
      next.placed = placed;
      next.placeError = snapshot.placeError || null;
      return next;
    }
  }
  snapshot.placed = placed;
  return snapshot;
}

async function tick(opts = {}) {
  const place = opts.place === true;
  let state = store.load();
  if (busy && !opts.force) return { state, snapshot: opts.snapshot || { pending: [], live: [], sl: [] } };
  busy = true;
  try {
    if (opts.userId) state.userId = opts.userId;
    const header = opts.authorization || null;
    if (header && state.userId) captureAuth(state.userId, header);
    const authorization = header || (await getAuthorization(state.userId));
    state.sessionOk = !!authorization;
    if (!authorization) {
      state.lastError = 'Kite session missing on droplet. Open Token, then press Watch my orders.';
      state.lastTick = new Date().toISOString();
      store.save(state);
      return { state, snapshot: { pending: [], live: [], sl: [] } };
    }
    const snapshot = await inspect(authorization, { place: place && state.enabled === true });
    state.lastTick = new Date().toISOString();
    if (snapshot.placeError) {
      state.lastError = snapshot.placeError;
    } else {
      state.lastError = null;
    }
    if ((snapshot.placed || []).length) {
      const n = snapshot.placed.length;
      state.lastMessage = `Rested SL on ${n} fill${n === 1 ? '' : 's'}`;
    } else if (state.enabled) {
      state.lastMessage = 'Watching orders';
    }
    store.save(state);
    return { state, snapshot };
  } catch (err) {
    const stateErr = store.load();
    stateErr.lastError = err.message || String(err);
    stateErr.lastTick = new Date().toISOString();
    store.save(stateErr);
    console.error('[sl-buddy]', err.message || err);
    return { state: stateErr, snapshot: { pending: [], live: [], sl: [] } };
  } finally {
    busy = false;
  }
}

function kick() {
  void tick({ place: true, force: true });
}

function start(opts = {}) {
  if (opts.getAuthorization) getAuthorization = opts.getAuthorization;
  if (opts.saveAuthorization) saveAuthorization = opts.saveAuthorization;
  if (opts.kite) kite = opts.kite;
  if (timer) return;
  timer = setInterval(() => {
    const state = store.load();
    if (!state.enabled) return;
    void tick({ place: true });
  }, TICK_MS);
  console.log('[sl-buddy] idle until Watch my orders; then every', TICK_MS, 'ms');
  const state = store.load();
  if (state.enabled) kick();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  TICK_MS,
  SL_GRACE_MS,
  start,
  stop,
  tick,
  kick,
  inspect,
  parseTokenHeader,
  captureAuth,
};
