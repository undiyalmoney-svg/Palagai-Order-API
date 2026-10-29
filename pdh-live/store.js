/**
 * Prior-day live money day state — survives a pm2 restart so a fill is not abandoned.
 * Idle unless Start live money was pressed. Never auto-arms on deploy.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'pdh-live', 'state.json');

function filePath() {
  return process.env.PDH_LIVE_STATE || FILE;
}

function empty(date) {
  return {
    enabled: false,
    userId: null,
    date,
    fills: [],
    doneToday: false,
    crowd: null,
    capital: 0,
    fundsRs: 0,
    scan: { phase: 'idle', done: 0, total: 0, symbol: null },
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
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (!raw || typeof raw !== 'object') return empty(today);
    if (raw.date !== today) {
      return {
        ...empty(today),
        enabled: raw.enabled === true,
        userId: raw.userId || null,
      };
    }
    return {
      ...empty(today),
      ...raw,
      date: today,
      enabled: raw.enabled === true,
      doneToday: raw.doneToday === true,
      fills: Array.isArray(raw.fills) ? raw.fills : [],
      sessionOk: raw.sessionOk === true,
      scan: raw.scan && typeof raw.scan === 'object' ? raw.scan : empty(today).scan,
    };
  } catch {
    return empty(today);
  }
}

function save(state) {
  const dest = filePath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dest);
}

function upsertFill(state, fill) {
  const instrument = String(fill.instrument || fill.symbol || '').trim().toUpperCase();
  if (!instrument) return state;
  const rest = (state.fills || []).filter((row) => String(row.instrument || '').toUpperCase() !== instrument);
  return {
    ...state,
    fills: [
      ...rest,
      {
        instrument,
        exchange: fill.exchange || 'NSE',
        side: fill.side === 'S' ? 'S' : 'L',
        qty: Math.floor(Number(fill.qty) || 0),
        entry: Number(fill.entry) || null,
        stop: Number(fill.stop) || null,
        target: Number(fill.target) || null,
        signalT: fill.signalT || null,
        orderId: fill.orderId || null,
        slOrderId: fill.slOrderId || null,
        openedAt: fill.openedAt || new Date().toISOString(),
      },
    ],
  };
}

function dropFill(state, instrument) {
  const symbol = String(instrument || '').trim().toUpperCase();
  return {
    ...state,
    fills: (state.fills || []).filter((row) => String(row.instrument || '').toUpperCase() !== symbol),
  };
}

function publicView(state) {
  const fills = state.fills || [];
  return {
    enabled: state.enabled === true,
    liveOrders: state.enabled === true,
    date: state.date,
    crowd: state.crowd || null,
    capital: state.capital || 0,
    fundsRs: state.fundsRs || 0,
    doneToday: state.doneToday === true,
    fills: fills.map((f) => ({
      instrument: f.instrument,
      side: f.side,
      qty: f.qty,
      entry: f.entry,
      stop: f.stop,
      target: f.target,
      signalT: f.signalT || null,
    })),
    scan: state.scan || { phase: 'idle', done: 0, total: 0, symbol: null },
    lastTick: state.lastTick,
    lastError: state.lastError,
    lastMessage: state.lastMessage,
    sessionOk: state.sessionOk === true,
    dropletWatching: true,
    dropletPlacing: state.enabled === true && state.sessionOk === true,
    guaranteed: false,
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
  publicView,
};
