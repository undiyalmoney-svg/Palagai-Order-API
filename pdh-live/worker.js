/**
 * Prior-day live money worker — idle until Start live money.
 *
 * Scan: every closed 5-minute bar 09:45–14:30 across Nifty 500. Crowd from 09:45
 * is a side filter only; a 11:20 close still qualifies.
 * Entry: NSE EQ MIS MARKET. Stop: SL-M at the prior-day level.
 * Exit: software 1R or 15:15 — cancel SL-M, then MARKET flatten. Also flatten on Stop.
 */
'use strict';

const { kiteService } = require('../services/kite.service');
const { fetchQuoteLtp, fetchUserMargins } = require('../services/kite-market');
const { NIFTY_500 } = require('../orb-backtest/universe');
const { getDb } = require('../orb-backtest/store');
const { loadUniverseBars, resolveNseEq, fetchSymbolBars } = require('../orb-backtest/load-bars');
const { sessionDate, minutesOfDay } = require('../research/time');
const { toMin } = require('../orb-backtest/engine');
const { clampLiveCapital, LIVE_MAX_NAMES } = require('../orb-backtest/pdh-desk');
const { prevDayRange } = require('../daily-profit/signals');
const store = require('./store');
const scan = require('./scan');
const orders = require('./orders');

const TICK_MS = 5_000;
const LTP_BATCH = 200;
const REFRESH_BATCH = 12;
const LOOKBACK_DAYS = 7;
const slPlacedAt = new Map();

let timer = null;
let exitBusy = false;
let entryBusy = false;
let getAuthorization = async () => null;
let saveAuthorization = () => false;
let kite = kiteService;
let universe = { day: null, symbolBars: {}, tokens: new Map(), scanIndex: 0 };

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

async function loadBroker(authorization) {
  const [orderRes, posRes] = await Promise.all([kite.getOrders(authorization), kite.getPositions(authorization)]);
  return { orders: orders.asOrders(orderRes), positions: orders.asPositions(posRes) };
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

async function ensureUniverse(authorization, state, now) {
  const day = sessionDate(now);
  if (universe.day === day && Object.keys(universe.symbolBars).length) return universe;
  const from = addCalendarDays(day, -LOOKBACK_DAYS);
  state.scan = { phase: 'candles', done: 0, total: NIFTY_500.length, symbol: null };
  state.lastMessage = 'Loading Nifty 500 5-minute bars so later breaks (not only 09:50) can still qualify.';
  store.save(state);
  if (!universe.tokens.size) {
    universe.tokens = await resolveNseEq(authorization, NIFTY_500);
  }
  const loaded = await loadUniverseBars({
    authorization,
    from,
    to: day,
    db: getDb(),
    batchSize: 10,
    instrumentMap: universe.tokens,
    fillDay: day,
    alwaysRefreshFillDay: true,
    onProgress: (p) => {
      const cur = store.load(now);
      cur.scan = p;
      cur.lastMessage = `Scanning ${p.done}/${p.total}${p.symbol ? ` · ${p.symbol}` : ''}`;
      store.save(cur);
    },
  });
  universe = {
    day,
    symbolBars: loaded.symbolBars || {},
    tokens: universe.tokens,
    scanIndex: 0,
  };
  return universe;
}

async function refreshHotAndBatch(authorization, state, now) {
  const day = sessionDate(now);
  const names = Object.keys(universe.symbolBars);
  if (!names.length) return;
  const crowd = state.crowd;
  const hot = [];
  try {
    const keys = scan.quoteKeys(names);
    const quotes = {};
    for (const batch of scan.chunk(keys, LTP_BATCH)) {
      Object.assign(quotes, await fetchQuoteLtp(authorization, batch).catch(() => ({})));
    }
    for (const symbol of names) {
      const q = quotes[`NSE:${symbol}`] || quotes[symbol];
      const ltp = Number(q?.last_price);
      const prev = prevDayRange(universe.symbolBars[symbol], day);
      if (scan.ltpBeyond(ltp, prev, crowd)) hot.push(symbol);
    }
  } catch {
    // LTP is a speed-up; closed 5-minute bars remain the entry gate.
  }
  const start = universe.scanIndex % Math.max(1, names.length);
  const round = [];
  for (let i = 0; i < REFRESH_BATCH; i += 1) {
    const symbol = names[(start + i) % names.length];
    if (symbol && !round.includes(symbol)) round.push(symbol);
  }
  universe.scanIndex = start + REFRESH_BATCH;
  const want = [...new Set([...hot, ...round])];
  for (const symbol of want) {
    const token = universe.tokens.get(symbol);
    if (!token) continue;
    try {
      const bars = await fetchSymbolBars(authorization, token.instrumentToken, day, day);
      if (bars && bars[day]) {
        universe.symbolBars[symbol] = { ...(universe.symbolBars[symbol] || {}), ...bars };
      }
    } catch {
      // Keep the last closed bars we already have.
    }
  }
  state.scan = {
    phase: 'watching',
    done: Math.min(names.length, (universe.scanIndex % names.length) || names.length),
    total: names.length,
    symbol: want[0] || null,
  };
}

async function placeEntry(authorization, state, picked, now) {
  const live = { ...picked, instrument: picked.symbol, exchange: 'NSE' };
  const fields = orders.entryFields(live);
  if (!fields) {
    state.lastError = `Could not size ${picked.symbol}`;
    return state;
  }
  const placed = await kite.placeOrder(authorization, 'regular', fields);
  const body = orders.kiteBody(placed);
  const http = placed.status || 0;
  const orderId = body.data?.order_id || null;
  const ok = http < 400 && (body.status === 'success' || orderId);
  if (!ok) {
    state.lastError = body.message || `Entry failed on ${picked.symbol}`;
    state.lastMessage = state.lastError;
    return state;
  }
  const fillPx = await readFillPrice(authorization, orderId, picked.fillPx);
  const levels = scan.liveLevels(picked.side, fillPx, picked.stopPx);
  const fill = {
    instrument: picked.symbol,
    exchange: 'NSE',
    side: picked.side,
    qty: picked.qty,
    entry: fillPx,
    stop: picked.stopPx,
    target: levels ? levels.target : picked.targetPx,
    signalT: picked.signalT,
    orderId,
  };
  state = store.upsertFill(state, fill);
  const sl = await orders.ensureStop(kite, authorization, fill, fill.stop, slPlacedAt);
  if (sl.orderId) {
    const cur = (state.fills || []).find((row) => row.instrument === fill.instrument);
    if (cur) cur.slOrderId = sl.orderId;
  }
  state.lastError = sl.ok || sl.skipped ? null : sl.message;
    state.lastMessage = `LIVE ${picked.side === 'S' ? 'short' : 'long'} ${picked.symbol} x${picked.qty} @ ${fillPx} · SL-M ${fill.stop} · compulsory 1R ${fill.target}. ${sl.message || ''}`.trim();
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
    const { positions } = await loadBroker(authorization);
    const quotes = {};
    const keys = (state.fills || []).map((f) => `${f.exchange || 'NSE'}:${f.instrument}`);
    if (keys.length) {
      try {
        Object.assign(quotes, await fetchQuoteLtp(authorization, keys));
      } catch {
        // Positions still carry last_price.
      }
    }
    const live = [...(state.fills || [])];
    for (const fill of live) {
      const qty = orders.signedQty(positions, fill.instrument);
      if (!qty) {
        state = store.dropFill(state, fill.instrument);
        state.doneToday = store.bookComplete(state, LIVE_MAX_NAMES);
        state.lastMessage = `Flat ${fill.instrument}`;
        continue;
      }
      const working = { ...fill, qty: Math.abs(qty) };
      const last = orders.lastPrice(positions, quotes, working);
      const decision = orders.decideFillAction(working, last, now.getTime ? now.getTime() : now, slPlacedAt);
      if (decision.action === 'flatten') {
        const result = await orders.flattenFill(kite, authorization, working, decision.reason);
        state.lastMessage = result.message;
        state.lastError = result.ok ? null : result.message;
        if (result.ok) {
          state = store.dropFill(state, working.instrument);
          state.doneToday = store.bookComplete(state, LIVE_MAX_NAMES);
        }
        continue;
      }
      if (working.stop) {
        const sl = await orders.ensureStop(kite, authorization, working, working.stop, slPlacedAt);
        if (!sl.ok && !sl.skipped) state.lastError = sl.message;
      }
    }
    if (scan.pastTimeExit(now) && (state.fills || []).length) {
      for (const fill of [...(state.fills || [])]) {
        const result = await orders.flattenFill(kite, authorization, fill, 'EOD');
        state.lastMessage = result.message;
        if (result.ok) {
          state = store.dropFill(state, fill.instrument);
          state.doneToday = store.bookComplete(state, LIVE_MAX_NAMES);
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
    console.error('[pdh-live]', err.message || err);
  } finally {
    exitBusy = false;
  }
}

async function tickEntries(now = new Date()) {
  if (entryBusy) return;
  let state = store.load(now);
  if (!state.enabled) return;
  if (store.bookComplete(state, LIVE_MAX_NAMES) || store.takenList(state).length >= LIVE_MAX_NAMES) {
    if (!state.doneToday && store.bookComplete(state, LIVE_MAX_NAMES)) {
      state.doneToday = true;
      store.save(state);
    }
    return;
  }
  if ((state.fills || []).length >= LIVE_MAX_NAMES) return;
  if (minutesOfDay(now) > toMin(scan.ENTRY_END) && !(state.fills || []).length) {
    state.lastMessage = 'No new live entries after 14:30. Open fills still auto-exit at 1R, SL-M, or 15:15.';
    state.lastTick = new Date(now).toISOString();
    store.save(state);
    return;
  }
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
    if (!(state.capital > 0)) {
      try {
        const funds = await fetchUserMargins(authorization);
        state.capital = clampLiveCapital(funds && (funds.equityCash || funds.capitalRs));
        state.fundsRs = state.capital;
      } catch {
        state.lastError = 'Could not read Kite funds. Refresh Token, then start again.';
        store.save(state);
        return;
      }
    }
    if (!(state.capital > 0)) {
      state.lastError = 'Kite equity cash is empty. Live money sizes from real funds.';
      store.save(state);
      return;
    }
    if (minutesOfDay(now) >= toMin('09:00')) {
      await ensureUniverse(authorization, state, now);
      state = store.load(now);
      await refreshHotAndBatch(authorization, state, now);
    }
    if (!scan.inEntryWindow(now)) {
      state.lastMessage = 'Live money armed. Waiting for 09:45 IST, then scanning every closed 5-minute bar until 14:30.';
      state.lastTick = new Date(now).toISOString();
      store.save(state);
      return;
    }
    const found = scan.eligibleFromBars(universe.symbolBars, {
      day: sessionDate(now),
      now,
      capital: state.capital,
      crowdDay: state.crowd,
      taken: store.takenList(state),
    });
    if (found.crowd) state.crowd = found.crowd;
    const picks = found.picks && found.picks.length ? found.picks : found.picked ? [found.picked] : [];
    if (!picks.length) {
      const watching = Object.keys(universe.symbolBars).length;
      const taken = store.takenList(state).length;
      state.lastMessage =
        found.reason === 'before-crowd'
          ? 'Waiting for the 09:45 crowd, then scanning every closed 5-minute bar.'
          : found.reason === 'crowd-pending'
            ? '09:45 bars still loading. Scanning continues — not a one-shot 09:50 job.'
            : `Watching ${watching} names until 14:30. Crowd ${state.crowd || 'pending'}. ${taken}/2 live names. Compulsory 1R.`;
      state.lastError = null;
      state.lastTick = new Date(now).toISOString();
      store.save(state);
      return;
    }
    for (const pick of picks) {
      const already = store.takenList(state);
      if (already.length >= LIVE_MAX_NAMES) break;
      if (already.includes(String(pick.symbol || '').toUpperCase())) continue;
      state = await placeEntry(authorization, state, pick, now);
    }
    store.save(state);
  } catch (err) {
    const stateErr = store.load(now);
    stateErr.lastError = err.message || String(err);
    stateErr.lastTick = new Date(now).toISOString();
    store.save(stateErr);
    console.error('[pdh-live] entry', err.message || err);
  } finally {
    entryBusy = false;
  }
}

async function stopLive({ authorization, userId, now = new Date() } = {}) {
  let state = store.load(now);
  state.enabled = false;
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
    state.lastMessage = state.lastMessage || 'Live money stopped. Flat.';
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
  console.log('[pdh-live] idle until Start live money; then every', TICK_MS, 'ms');
  const state = store.load();
  if (state.enabled || (state.fills || []).length) kick();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function resetUniverse() {
  universe = { day: null, symbolBars: {}, tokens: new Map(), scanIndex: 0 };
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
  resetUniverse,
};
