/**
 * Crude Mini live money worker — idle until Start live money.
 *
 * Instrument: next MCX CRUDEOILM FUT (skips the contract that expires today).
 * Entry: 1 lot MIS MARKET after PDHL / OR fade / trap + next-bar confirm, 10:00–23:00 IST.
 * Stop: SL-M 20 pts hard floor. Software scratch 10 pts or first-bar smell, TP 25 (₹200), flatten 23:10.
 */
'use strict';

const { kiteService } = require('../services/kite.service');
const { fetchQuoteLtp, fetchHistorical5m, fetchInstrumentsCsv } = require('../services/kite-market');
const { sessionDate } = require('../research/time');
const { DNA } = require('./dna');
const { resolveNextCrudeMiniFut } = require('./contract');
const scan = require('./scan');
const orders = require('./orders');
const store = require('./store');

const TICK_MS = 5_000;
const LOOKBACK_DAYS = 5;
const slPlacedAt = new Map();

let timer = null;
let exitBusy = false;
let entryBusy = false;
let getAuthorization = async () => null;
let saveAuthorization = () => false;
let kite = kiteService;
let cache = { day: null, token: 0, bars: [] };

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

function addCalendarDays(day, delta) {
  const ms = Date.parse(`${day}T12:00:00+05:30`) + delta * 86400000;
  return sessionDate(new Date(ms));
}

async function refreshContract(authorization, now = new Date()) {
  if (!authorization) return store.load(now);
  let state = store.load(now);
  const today = sessionDate(now);
  if (state.contract?.tradingSymbol && state.contract.expiry && state.contract.expiry > today) {
    return state;
  }
  try {
    const csv = await fetchInstrumentsCsv(authorization, 'MCX');
    const hit = resolveNextCrudeMiniFut(csv, now);
    if (!hit) {
      state.lastError = 'No next CRUDEOILM future after today’s expiry. Standing down.';
      state.contract = null;
      store.save(state);
      return state;
    }
    state.contract = hit;
    if (hit.expiryDay) {
      state.lastMessage =
        state.lastMessage && /armed|watching|confirm|LIVE|flat/i.test(state.lastMessage)
          ? state.lastMessage
          : `Expiry day — trading next ${hit.tradingSymbol} (expires ${hit.expiry}).`;
    }
    store.save(state);
    return state;
  } catch (err) {
    state.lastError = err.message || String(err);
    store.save(state);
    return state;
  }
}

async function loadBars(authorization, contract, now) {
  const day = sessionDate(now);
  const token = Number(contract.instrumentToken);
  if (cache.day === day && cache.token === token && cache.bars.length) {
    try {
      const fresh = await fetchHistorical5m(authorization, token, day, day);
      const older = cache.bars.filter((b) => b.day !== day);
      cache.bars = [...older, ...scan.barsFromKite(fresh)];
    } catch {
      // Keep the last closed bars we already have.
    }
    return cache.bars;
  }
  const from = addCalendarDays(day, -LOOKBACK_DAYS);
  const rows = await fetchHistorical5m(authorization, token, from, day);
  cache = { day, token, bars: scan.barsFromKite(rows) };
  return cache.bars;
}

async function readFillPrice(authorization, orderId, fallback) {
  if (!orderId) return fallback;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await kite.getOrderHistory(authorization, orderId);
      const rows = orders.kiteBody(res).data;
      const list = Array.isArray(rows) ? rows : [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const px = Number(list[i]?.average_price);
        if (/complete/i.test(String(list[i]?.status || '')) && px > 0) return px;
      }
    } catch {
      // SL-M can still rest off the quote.
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return fallback;
}

async function placeEntry(authorization, state, picked, now) {
  const contract = state.contract;
  if (!contract || !contract.tradingSymbol) {
    state.lastError = 'No live CRUDEOILM future. Waiting for the next contract.';
    return state;
  }
  const live = {
    instrument: contract.tradingSymbol,
    exchange: 'MCX',
    side: picked.side,
    qty: DNA.qty,
  };
  const fields = orders.entryFields(live);
  if (!fields) {
    state.lastError = `Could not size ${contract.tradingSymbol}`;
    return state;
  }
  const placed = await kite.placeOrder(authorization, 'regular', fields);
  const body = orders.kiteBody(placed);
  const http = placed.status || 0;
  const orderId = body.data?.order_id || null;
  const ok = http < 400 && (body.status === 'success' || orderId);
  if (!ok) {
    state.lastError = body.message || `Entry failed on ${contract.tradingSymbol}`;
    state.lastMessage = state.lastError;
    return state;
  }
  const fillPx = await readFillPrice(authorization, orderId, picked.fillPx);
  const lv = scan.levels(picked.side, fillPx) || { stopPx: picked.stopPx, targetPx: picked.targetPx };
  const fill = {
    instrument: contract.tradingSymbol,
    exchange: 'MCX',
    side: picked.side,
    qty: DNA.qty,
    entry: fillPx,
    stop: lv.stopPx,
    target: lv.targetPx,
    signalT: picked.signalT,
    confirmT: picked.confirmT,
    orderId,
  };
  state = store.upsertFill(state, fill);
  const sl = await orders.ensureStop(kite, authorization, fill, fill.stop, slPlacedAt);
  if (sl.orderId) {
    const cur = (state.fills || [])[0];
    if (cur) cur.slOrderId = sl.orderId;
  }
  state.lastError = sl.ok || sl.skipped ? null : sl.message;
  state.lastMessage =
    `LIVE ${picked.side === 'S' ? 'short' : 'long'} ${fill.instrument} x${fill.qty} @ ${fillPx} · SL-M ${fill.stop} · TP ${fill.target}. ${sl.message || ''}`.trim();
  state.lastTick = new Date(now).toISOString();
  return state;
}

async function tickExits(now = new Date()) {
  if (exitBusy) return;
  let state = store.load(now);
  if (!state.enabled && !(state.fills || []).length) return;
  exitBusy = true;
  try {
    const authorization = await getAuthorization(state.userId);
    state.sessionOk = !!authorization;
    if (!authorization) {
      state.lastError = 'Kite session missing on droplet. Open Token, then start live money.';
      state.lastTick = new Date(now).toISOString();
      store.save(state);
      return;
    }
    const posRes = await kite.getPositions(authorization);
    const positions = orders.asPositions(posRes);
    const quotes = {};
    const keys = (state.fills || []).map((f) => `${f.exchange || 'MCX'}:${f.instrument}`);
    if (keys.length) {
      try {
        Object.assign(quotes, await fetchQuoteLtp(authorization, keys));
      } catch {
        // Positions still carry last_price.
      }
    }
    for (const fill of [...(state.fills || [])]) {
      const qty = orders.signedQty(positions, fill.instrument);
      if (!qty) {
        const last = orders.lastPrice(positions, quotes, fill);
        const pts = orders.ptsFor(fill, last || fill.stop || fill.entry);
        state = store.dropFill(state, fill.instrument, pts);
        state.lastMessage = `Flat ${fill.instrument}`;
        continue;
      }
      const working = { ...fill, qty: Math.abs(qty) };
      const last = orders.lastPrice(positions, quotes, working);
      const smellBar = scan.firstBarAfter(cache.bars, sessionDate(now), working.confirmT);
      const decision = scan.decideExit({ fill: working, lastPx: last, now, smellBar });
      if (decision.action === 'flatten') {
        const result = await orders.flattenFill(kite, authorization, working, decision.reason);
        state.lastMessage = result.message;
        state.lastError = result.ok ? null : result.message;
        if (result.ok) {
          const pts = orders.ptsFor(working, last || working.stop || working.entry);
          state = store.dropFill(state, working.instrument, pts);
        }
        continue;
      }
      if (working.stop) {
        const sl = await orders.ensureStop(kite, authorization, working, working.stop, slPlacedAt);
        if (sl.orderId) {
          const cur = (state.fills || [])[0];
          if (cur) cur.slOrderId = sl.orderId;
        }
        if (sl.ok) {
          state.lastError = null;
          if (!sl.skipped) state.lastMessage = `SL-M resting on ${working.instrument} @ ${working.stop}`;
        } else if (!sl.skipped) {
          state.lastError = sl.message;
        }
      }
    }
    state.lastTick = new Date(now).toISOString();
    store.save(state);
  } catch (err) {
    const stateErr = store.load(now);
    stateErr.lastError = err.message || String(err);
    stateErr.lastTick = new Date(now).toISOString();
    store.save(stateErr);
    console.error('[crude-live]', err.message || err);
  } finally {
    exitBusy = false;
  }
}

async function tickEntries(now = new Date()) {
  if (entryBusy) return;
  let state = store.load(now);
  if (!state.enabled) return;
  if ((state.fills || []).length) return;
  entryBusy = true;
  try {
    const authorization = await getAuthorization(state.userId);
    state.sessionOk = !!authorization;
    if (!authorization) {
      state.lastError = 'Kite session missing on droplet. Open Token, then start live money.';
      state.lastTick = new Date(now).toISOString();
      store.save(state);
      return;
    }
    state = await refreshContract(authorization, now);
    if (!state.contract) {
      state.lastTick = new Date(now).toISOString();
      store.save(state);
      return;
    }
    const bars = await loadBars(authorization, state.contract, now);
    let found = scan.nextAction({
      bars,
      now,
      pending: state.pending,
      tradesToday: state.tradesToday,
      dayNetPts: state.dayNetPts,
      weekNetPts: state.weekNetPts,
      fill: (state.fills || [])[0] || null,
    });
    if (found.action === 'reject-confirm') {
      state.pending = null;
      found = scan.nextAction({
        bars,
        now,
        pending: null,
        tradesToday: state.tradesToday,
        dayNetPts: state.dayNetPts,
        weekNetPts: state.weekNetPts,
        fill: null,
      });
    }
    if (found.action === 'pending') {
      state.pending = found.pending;
      state.lastError = null;
      state.lastMessage = found.message;
    } else if (found.action === 'wait-confirm') {
      state.pending = found.pending;
      state.lastError = null;
      state.lastMessage = found.message;
    } else if (found.action === 'enter') {
      state.pending = null;
      state = await placeEntry(authorization, state, found, now);
    } else {
      if (found.action === 'reject-confirm') state.pending = null;
      state.lastError = found.action === 'wild-prev' ? null : state.lastError;
      state.lastMessage = found.message || state.lastMessage;
    }
    state.lastTick = new Date(now).toISOString();
    store.save(state);
  } catch (err) {
    const stateErr = store.load(now);
    stateErr.lastError = err.message || String(err);
    stateErr.lastTick = new Date(now).toISOString();
    store.save(stateErr);
    console.error('[crude-live] entry', err.message || err);
  } finally {
    entryBusy = false;
  }
}

async function stopLive({ authorization, userId, now = new Date() } = {}) {
  let state = store.load(now);
  state.enabled = false;
  state.pending = null;
  if (userId) state.userId = userId;
  const header = authorization || (await getAuthorization(state.userId));
  if (header && (state.fills || []).length) {
    for (const fill of [...(state.fills || [])]) {
      try {
        const result = await orders.flattenFill(kite, header, fill, 'STOP');
        state.lastMessage = result.message;
        if (result.ok) state = store.dropFill(state, fill.instrument);
        else state.lastError = result.message;
      } catch (err) {
        state.lastError = err.message || String(err);
      }
    }
  }
  if (!(state.fills || []).length) {
    state.lastMessage = state.lastMessage || 'Live Crude Mini stopped. Flat.';
    state.lastError = state.lastError && (state.fills || []).length ? state.lastError : null;
  }
  state.lastTick = new Date(now).toISOString();
  store.save(state);
  return store.publicView(state);
}

function kick() {
  void tickExits();
  void tickEntries();
}

function start(opts = {}) {
  if (opts.getAuthorization) getAuthorization = opts.getAuthorization;
  if (opts.saveAuthorization) saveAuthorization = opts.saveAuthorization;
  if (opts.kite) kite = opts.kite;
  if (timer) return;
  timer = setInterval(() => {
    const state = store.load();
    if (!state.enabled && !(state.fills || []).length) return;
    void tickExits();
    void tickEntries();
  }, TICK_MS);
  console.log('[crude-live] idle until Start live money; then every', TICK_MS, 'ms');
  const state = store.load();
  if (state.enabled || (state.fills || []).length) kick();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function resetCache() {
  cache = { day: null, token: 0, bars: [] };
}

module.exports = {
  TICK_MS,
  start,
  stop,
  kick,
  tickExits,
  tickEntries,
  stopLive,
  captureAuth,
  parseTokenHeader,
  refreshContract,
  resetCache,
};
