/**
 * Charts Protect worker — droplet super-assistant for PALAGAI_CHART.
 *
 * Entries: SMC on 1m with 5m HTF, ATM CE/PE, lots from funds, one book.
 * Exits: watch 0.5R in software, cancel every resting SELL, then MARKET SELL.
 * Also rest a missing 25% SL. The Charts tab can be closed.
 */
'use strict';

const { kiteService } = require('../services/kite.service');
const { fetchQuotes } = require('../services/kite-market');
const { chartProtectiveLevels, bookFromInstrument, isChartTag } = require('./levels');
const { asOrders, asPositions, decideFillAction, ensureStop, flattenFill, lastPrice, openQty } = require('./flatten');
const store = require('./store');
const { scanEntries, ENTRY_MS } = require('./entry');

const TICK_MS = 4_000;
const slPlacedAt = new Map();
let exitTimer = null;
let exitBusy = false;
let entryBusy = false;
let lastEntryAt = 0;
let getAuthorization = async () => null;

function quoteKey(fill) {
  const crude = /crude/i.test(fill.instrument || '');
  return `${fill.exchange || (crude ? 'MCX' : 'NFO')}:${fill.instrument}`;
}

function fillsFromBroker(orders, positions) {
  const symbols = new Set();
  for (const order of orders) {
    if (isChartTag(order.tag) && order.tradingsymbol) symbols.add(String(order.tradingsymbol).trim());
  }
  const out = [];
  for (const symbol of symbols) {
    const qty = openQty(positions, symbol);
    if (!(qty > 0)) continue;
    const pos = positions.find((p) => String(p.tradingsymbol || '').trim().toUpperCase() === symbol.toUpperCase());
    const entryBuy = [...orders]
      .reverse()
      .find(
        (o) =>
          String(o.tradingsymbol || '').trim().toUpperCase() === symbol.toUpperCase() &&
          String(o.tag || '').toUpperCase() === 'PALAGAI_CHART' &&
          String(o.transaction_type || '').toUpperCase() === 'BUY' &&
          String(o.status || '').toUpperCase() === 'COMPLETE',
      );
    const entry = Number(entryBuy?.average_price || pos?.average_price) || null;
    const levels = entry ? chartProtectiveLevels(entry) : null;
    const crude = /crude/i.test(symbol);
    out.push({
      instrument: symbol,
      exchange: String(entryBuy?.exchange || pos?.exchange || (crude ? 'MCX' : 'NFO')),
      book: bookFromInstrument(symbol),
      qty,
      entry,
      stop: levels?.stop || null,
      target: levels?.target || null,
    });
  }
  return out;
}

async function loadBroker(authorization) {
  const [orderRes, posRes] = await Promise.all([
    kiteService.getOrders(authorization),
    kiteService.getPositions(authorization),
  ]);
  return { orders: asOrders(orderRes), positions: asPositions(posRes) };
}

async function tickExits() {
  if (exitBusy) return;
  let state = store.load();
  if (!state.enabled && !(state.fills || []).length) return;
  exitBusy = true;
  try {
    const authorization = await getAuthorization(state.userId);
    state.sessionOk = !!authorization;
    if (!authorization) {
      state.lastError = 'Kite session missing on droplet. Open Token, then turn Protect on.';
      state.lastTick = new Date().toISOString();
      store.save(state);
      return;
    }
    const { orders, positions } = await loadBroker(authorization);
    const brokerFills = fillsFromBroker(orders, positions);
    for (const fill of brokerFills) {
      if (!(state.fills || []).some((row) => row.instrument === fill.instrument)) {
        state = store.upsertFill(state, fill);
      }
    }
    const live = [...(state.fills || [])];
    const quotes = live.length ? await fetchQuotes(authorization, live.map(quoteKey)) : {};

    for (const fill of live) {
      const qty = openQty(positions, fill.instrument);
      if (!(qty > 0)) {
        state = store.dropFill(state, fill.instrument);
        state.lastMessage = `Flat ${fill.instrument}`;
        continue;
      }
      const working = { ...fill, qty };
      if (!working.stop || !working.target) {
        const levels = working.entry ? chartProtectiveLevels(working.entry) : null;
        if (levels) {
          working.stop = levels.stop;
          working.target = levels.target;
          state = store.upsertFill(state, working);
        }
      }
      const last = lastPrice(positions, quotes, working);
      const decision = decideFillAction(working, last, Date.now(), slPlacedAt);
      if (decision.action === 'flatten') {
        const result = await flattenFill(kiteService, authorization, working, decision.reason);
        state.lastMessage = result.message;
        state.lastError = result.ok ? null : result.message;
        if (result.ok) state = store.dropFill(state, working.instrument);
        continue;
      }
      if (working.stop) {
        const sl = await ensureStop(kiteService, authorization, working, working.stop, slPlacedAt);
        if (!sl.ok && !sl.skipped) state.lastError = sl.message;
      }
    }
    state.lastTick = new Date().toISOString();
    if (!state.lastError) state.lastError = null;
    store.save(state);
  } catch (err) {
    const stateErr = store.load();
    stateErr.lastError = err.message || String(err);
    stateErr.lastTick = new Date().toISOString();
    store.save(stateErr);
    console.error('[charts-protect]', err.message || err);
  } finally {
    exitBusy = false;
  }
}

async function tickEntries() {
  if (entryBusy) return;
  let state = store.load();
  if (!state.enabled) return;
  if ((state.fills || []).length) return;
  const now = Date.now();
  if (now - lastEntryAt < ENTRY_MS) return;
  lastEntryAt = now;
  entryBusy = true;
  try {
    const authorization = await getAuthorization(state.userId);
    state.sessionOk = !!authorization;
    if (!authorization) {
      state.lastError = 'Kite session missing on droplet. Open Token, then turn Protect on.';
      state.lastTick = new Date().toISOString();
      store.save(state);
      return;
    }
    const { positions } = await loadBroker(authorization);
    state = await scanEntries(authorization, state, positions, slPlacedAt, new Date());
    state.sessionOk = true;
    state.lastTick = new Date().toISOString();
    store.save(state);
  } catch (err) {
    const stateErr = store.load();
    stateErr.lastError = err.message || String(err);
    stateErr.lastTick = new Date().toISOString();
    store.save(stateErr);
    console.error('[charts-protect] entry', err.message || err);
  } finally {
    entryBusy = false;
  }
}

function kick() {
  lastEntryAt = 0;
  void tickExits();
  void tickEntries();
}

function start(opts = {}) {
  if (opts.getAuthorization) getAuthorization = opts.getAuthorization;
  if (exitTimer) return;
  exitTimer = setInterval(() => {
    void tickExits();
    void tickEntries();
  }, TICK_MS);
  console.log('[charts-protect] placing and watching PALAGAI_CHART every', TICK_MS, 'ms');
  kick();
}

function stop() {
  if (exitTimer) clearInterval(exitTimer);
  exitTimer = null;
}

module.exports = { start, stop, tick: tickExits, tickExits, tickEntries, kick, fillsFromBroker };
