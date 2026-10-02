/**
 * Charts Protect day state — survives a pm2 restart so a fill is not abandoned.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'charts-protect', 'state.json');

function empty(date) {
  return {
    enabled: false,
    userId: null,
    date,
    nseBook: null,
    placed: { nifty: false, bank: false, crude: false },
    done: { nifty: false, bank: false, crude: false },
    fills: [],
    lastTick: null,
    lastError: null,
    lastMessage: null,
    sessionOk: false,
  };
}

function todayIst(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function load(now = new Date()) {
  const today = todayIst(now);
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return empty(today);
    if (raw.date !== today) {
      return { ...empty(today), enabled: raw.enabled === true, userId: raw.userId || null };
    }
    return {
      ...empty(today),
      ...raw,
      date: today,
      enabled: raw.enabled === true,
      fills: Array.isArray(raw.fills) ? raw.fills : [],
      placed: { nifty: !!raw.placed?.nifty, bank: !!raw.placed?.bank, crude: !!raw.placed?.crude },
      done: { nifty: !!raw.done?.nifty, bank: !!raw.done?.bank, crude: !!raw.done?.crude },
      sessionOk: raw.sessionOk === true,
    };
  } catch {
    return empty(today);
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function upsertFill(state, fill) {
  const instrument = String(fill.instrument || '').trim();
  if (!instrument) return state;
  const rest = (state.fills || []).filter((row) => row.instrument !== instrument);
  const book = fill.book || null;
  const next = {
    ...state,
    fills: [
      ...rest,
      {
        instrument,
        exchange: fill.exchange || null,
        book,
        qty: Math.floor(Number(fill.qty) || 0),
        entry: Number(fill.entry) || null,
        stop: Number(fill.stop) || null,
        target: Number(fill.target) || null,
        protectOwned: true,
        openedAt: fill.openedAt || new Date().toISOString(),
      },
    ],
  };
  if (book) {
    next.placed = { ...next.placed, [book]: true };
    if (book === 'nifty' || book === 'bank') next.nseBook = book;
  }
  return next;
}

function markPlaced(state, book) {
  if (!book) return state;
  const next = { ...state, placed: { ...state.placed, [book]: true } };
  if (book === 'nifty' || book === 'bank') next.nseBook = book;
  return next;
}

function unmarkPlaced(state, book) {
  if (!book) return state;
  const next = { ...state, placed: { ...state.placed, [book]: false } };
  if (state.nseBook === book && !(state.fills || []).some((row) => row.book === book)) {
    next.nseBook = null;
  }
  return next;
}

function dropFill(state, instrument) {
  const symbol = String(instrument || '').trim();
  const fill = (state.fills || []).find((row) => row.instrument === symbol);
  const fills = (state.fills || []).filter((row) => row.instrument !== symbol);
  const next = { ...state, fills };
  if (fill?.book) next.done = { ...next.done, [fill.book]: true };
  return next;
}

function publicView(state) {
  return {
    enabled: state.enabled === true,
    date: state.date,
    nseBook: state.nseBook,
    placed: state.placed,
    done: state.done,
    openFills: (state.fills || []).map((f) => f.instrument),
    lastTick: state.lastTick,
    lastError: state.lastError,
    lastMessage: state.lastMessage,
    dropletWatching: true,
    dropletPlacing: state.enabled === true && state.sessionOk === true,
    sessionOk: state.sessionOk === true,
  };
}

module.exports = {
  FILE,
  empty,
  todayIst,
  load,
  save,
  upsertFill,
  dropFill,
  markPlaced,
  unmarkPlaced,
  publicView,
};
