/**
 * Crude Mini live money day state — survives a pm2 restart so a fill is not abandoned.
 * Idle unless Start live money was pressed. Never auto-arms on deploy.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { weekMonday } = require('./dna');

const FILE = path.join(__dirname, '..', 'data', 'crude-live', 'state.json');

function filePath() {
  return process.env.CRUDE_LIVE_STATE || FILE;
}

function empty(date) {
  return {
    enabled: false,
    userId: null,
    date,
    weekMonday: weekMonday(date),
    weekNetPts: 0,
    dayNetPts: 0,
    tradesToday: 0,
    pending: null,
    fills: [],
    contract: null,
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
  const monday = weekMonday(today);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (!raw || typeof raw !== 'object') return empty(today);
    const sameWeek = raw.weekMonday === monday;
    if (raw.date !== today) {
      return {
        ...empty(today),
        enabled: raw.enabled === true,
        userId: raw.userId || null,
        weekMonday: monday,
        weekNetPts: sameWeek ? Number(raw.weekNetPts) || 0 : 0,
        contract: raw.contract || null,
      };
    }
    return {
      ...empty(today),
      ...raw,
      date: today,
      weekMonday: monday,
      enabled: raw.enabled === true,
      weekNetPts: Number(raw.weekNetPts) || 0,
      dayNetPts: Number(raw.dayNetPts) || 0,
      tradesToday: Math.floor(Number(raw.tradesToday) || 0),
      fills: Array.isArray(raw.fills) ? raw.fills : [],
      pending: raw.pending && typeof raw.pending === 'object' ? raw.pending : null,
      contract: raw.contract && typeof raw.contract === 'object' ? raw.contract : null,
      sessionOk: raw.sessionOk === true,
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
  return {
    ...state,
    pending: null,
    tradesToday: Math.max(state.tradesToday || 0, (state.fills || []).length) + ((state.fills || []).length ? 0 : 1),
    fills: [
      {
        instrument,
        exchange: fill.exchange || 'MCX',
        side: fill.side === 'S' ? 'S' : 'L',
        qty: Math.floor(Number(fill.qty) || 1),
        entry: Number(fill.entry) || null,
        stop: Number(fill.stop) || null,
        target: Number(fill.target) || null,
        signalT: fill.signalT || null,
        confirmT: fill.confirmT || null,
        orderId: fill.orderId || null,
        slOrderId: fill.slOrderId || null,
        openedAt: fill.openedAt || new Date().toISOString(),
      },
    ],
  };
}

function dropFill(state, instrument, pts = 0) {
  const symbol = String(instrument || '').trim().toUpperCase();
  const add = Number(pts) || 0;
  return {
    ...state,
    fills: (state.fills || []).filter((row) => String(row.instrument || '').toUpperCase() !== symbol),
    dayNetPts: (Number(state.dayNetPts) || 0) + add,
    weekNetPts: (Number(state.weekNetPts) || 0) + add,
  };
}

function publicView(state) {
  const fills = state.fills || [];
  const contract = state.contract || null;
  return {
    enabled: state.enabled === true,
    liveOrders: state.enabled === true,
    date: state.date,
    weekMonday: state.weekMonday,
    weekNetPts: Number(state.weekNetPts) || 0,
    dayNetPts: Number(state.dayNetPts) || 0,
    tradesToday: Math.floor(Number(state.tradesToday) || 0),
    pending: state.pending
      ? {
          dir: state.pending.dir,
          signalT: state.pending.signalT,
        }
      : null,
    contract: contract
      ? {
          tradingSymbol: contract.tradingSymbol,
          instrumentToken: contract.instrumentToken || 0,
          expiry: contract.expiry || null,
          lotSize: contract.lotSize || 1,
          tickSize: contract.tickSize || 1,
          rolled: contract.rolled === true,
          expiryDay: contract.expiryDay === true,
        }
      : null,
    fills: fills.map((f) => ({
      instrument: f.instrument,
      side: f.side,
      qty: f.qty,
      entry: f.entry,
      stop: f.stop,
      target: f.target,
      signalT: f.signalT || null,
      confirmT: f.confirmT || null,
    })),
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
