/**
 * Paper Live worker — droplet keeps ticking paper and placing PALAGAI_PAPER
 * after the tab closes.
 */
'use strict';

const { kiteService } = require('../services/kite.service');
const {
  fetchQuotes,
  fetchHistoricalInterval,
  fetchInstrumentsCsv,
  fetchUserMargins,
} = require('../services/kite-market');
const store = require('./store');
const orders = require('./orders');

const TICK_MS = 8_000;
const placing = new Set();
let timer = null;
let busy = false;
let getAuthorization = async () => null;
let saveAuthorization = () => false;
let engine = null;

function loadEngine() {
  if (engine) return engine;
  try {
    engine = require('./from-paper/bundle');
  } catch (err) {
    console.error('[paper-live] tick bundle missing — overlay-only until rebuild', err.message);
    engine = null;
  }
  return engine;
}

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

async function dumpCsv(authorization) {
  const chunks = [];
  for (const ex of ['NSE', 'NFO', 'BFO', 'BSE', 'MCX']) {
    try {
      const csv = await fetchInstrumentsCsv(authorization, ex);
      const lines = String(csv || '').split(/\r?\n/);
      if (!chunks.length && lines[0]) chunks.push(lines[0]);
      chunks.push(lines.slice(1).join('\n'));
    } catch {
      /* one exchange missing is fine */
    }
  }
  return chunks.join('\n');
}

function candlesOf(rows) {
  return (rows || []).map((r) => [r.date, r.open, r.high, r.low, r.close]);
}

async function overlayBook(authorization, state, prev, next) {
  const eng = loadEngine();
  const under = eng ? eng.underOf(next.id) : String(next.under || '').trim();
  const closed = (next.fills || []).length > (prev.fills || []).length;
  if (closed && (prev.kiteBuyOrderId || prev.kiteSlOrderId)) {
    return flattenBook(authorization, {
      ...next,
      optionSymbol: next.optionSymbol || prev.optionSymbol,
      optionToken: next.optionToken || prev.optionToken,
      lot: next.lot || prev.lot,
      kiteBuyOrderId: prev.kiteBuyOrderId,
      kiteSlOrderId: prev.kiteSlOrderId,
    });
  }
  const armed = eng
    ? eng.paperLiveArmedFor(state.live, state.books, under)
    : !!(state.live && state.books[under]);
  if (!armed) return next;
  if (next.kiteHalt && !next.kiteBuyOrderId) return next;
  if (next.side !== 'flat' && next.optionSymbol && Number(next.optionToken) > 0) {
    return enterBook(authorization, next);
  }
  return next;
}

async function enterBook(authorization, book) {
  const key = book.id;
  if (placing.has(key)) return book;
  placing.add(key);
  let next = { ...book };
  try {
    if (!next.kiteBuyOrderId) {
      const fields = orders.buyFields(next);
      if (!fields) return { ...next, kiteNote: 'No listed contract — Kite buy skipped.' };
      try {
        const id = await orders.place(authorization, fields);
        next = { ...next, kiteBuyOrderId: id, kiteHalt: false, kiteNote: `Kite buy ${id}` };
      } catch (err) {
        return {
          ...next,
          kiteHalt: true,
          kiteNote: `Kite rejected — not retrying. ${err.message || 'Order failed'}`,
        };
      }
    }
    if (next.kiteBuyOrderId && !next.kiteSlOrderId && Number(next.sl) > 0) {
      const fields = orders.stopFields(next);
      if (!fields) return { ...next, kiteNote: `${next.kiteNote || ''} · could not rest SL`.trim() };
      try {
        const id = await orders.place(authorization, fields);
        next = {
          ...next,
          kiteSlOrderId: id,
          kiteNote: `${next.kiteNote || ''} · SL ${id} at ₹${fields.trigger_price}`.trim(),
        };
      } catch (err) {
        return { ...next, kiteNote: `${next.kiteNote || ''} · SL ${err.message || 'failed'}`.trim() };
      }
    }
    return next;
  } finally {
    placing.delete(key);
  }
}

async function flattenBook(authorization, book) {
  const key = `x:${book.id}`;
  if (placing.has(key)) return book;
  placing.add(key);
  const notes = [];
  try {
    if (book.kiteSlOrderId) {
      try {
        await orders.cancel(authorization, book.kiteSlOrderId);
        notes.push(`cancelled SL ${book.kiteSlOrderId}`);
      } catch (err) {
        notes.push(`SL cancel ${err.message || 'failed'}`);
      }
    }
    const fields = orders.exitFields(book);
    if (fields) {
      try {
        const id = await orders.place(authorization, fields);
        notes.push(id ? `Kite exit ${id}` : 'Kite returned no exit id');
      } catch (err) {
        notes.push(`exit ${err.message || 'failed'}`);
      }
    }
    return {
      ...book,
      kiteBuyOrderId: '',
      kiteSlOrderId: '',
      kiteNote: notes.join(' · ') || book.kiteNote,
    };
  } finally {
    placing.delete(key);
  }
}

async function tickOnce() {
  if (busy) return;
  let state = store.load();
  if (!state.running && !state.live) return;
  busy = true;
  try {
    const authorization = await getAuthorization(state.userId);
    state.sessionOk = !!authorization;
    if (!authorization) {
      state.lastError = 'Kite session missing on droplet. Open Token, then turn Live Kite on.';
      state.lastTick = new Date().toISOString();
      store.save(state);
      return;
    }
    const prevSession = state.session;
    const eng = loadEngine();
    let nextSession = prevSession;
    if (state.running && eng && typeof eng.runPaperTick === 'function') {
      nextSession = await eng.runPaperTick({
        live: state.live,
        liveBooks: state.books,
        session: prevSession || eng.emptySession(eng.istDay()),
        fetchMargins: () => fetchUserMargins(authorization).catch(() => null),
        fetchCsv: () => dumpCsv(authorization),
        fetchQuotes: (keys) => (keys.length ? fetchQuotes(authorization, keys) : {}),
        fetchHistorical: async (token, interval, from, to) => {
          const rows = await fetchHistoricalInterval(authorization, token, from, to, interval).catch(() => []);
          return candlesOf(rows);
        },
      });
    }
    if (nextSession && Array.isArray(nextSession.books)) {
      const prevBooks = prevSession?.books || [];
      const books = [];
      for (const next of nextSession.books) {
        const prev = prevBooks.find((b) => b.id === next.id) || next;
        books.push(await overlayBook(authorization, state, prev, next));
      }
      nextSession = { ...nextSession, books, liveOrders: store.liveArmed(state) };
      state.session = nextSession;
    }
    state.lastError = null;
    state.lastTick = new Date().toISOString();
    state.lastMessage = store.liveArmed(state)
      ? 'Droplet placing PALAGAI_PAPER with the tab closed'
      : 'Droplet watching paper with the tab closed';
    store.save(state);
  } catch (err) {
    const stateErr = store.load();
    stateErr.lastError = err.message || String(err);
    stateErr.lastTick = new Date().toISOString();
    store.save(stateErr);
    console.error('[paper-live]', err.message || err);
  } finally {
    busy = false;
  }
}

function kick() {
  void tickOnce();
}

function start(opts = {}) {
  if (opts.getAuthorization) getAuthorization = opts.getAuthorization;
  if (opts.saveAuthorization) saveAuthorization = opts.saveAuthorization;
  if (timer) return;
  timer = setInterval(() => {
    void tickOnce();
  }, TICK_MS);
  console.log('[paper-live] ticking paper and placing PALAGAI_PAPER every', TICK_MS, 'ms');
  kick();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  start,
  stop,
  tick: tickOnce,
  kick,
  captureAuth,
  overlayBook,
  enterBook,
  flattenBook,
};
