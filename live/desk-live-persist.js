'use strict';
/**
 * Disk snapshot of Trade Bot / Crude Bot Live so a tab reopen or pm2 restart
 * still has fills, SL, events, and Why — not an empty PAPER board.
 */
const fs = require('fs');
const path = require('path');

function dir() {
  return process.env.DESK_LIVE_DIR
    || path.join(__dirname, '..', 'data', 'desk-live');
}

function fileFor(desk, userId) {
  const safe = String(userId || 'anonymous').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(dir(), `${String(desk || 'sr')}-${safe}.json`);
}

function load(desk, userId) {
  if (process.env.DESK_LIVE_PERSIST === '0') return null;
  try {
    const raw = fs.readFileSync(fileFor(desk, userId), 'utf8');
    const snap = JSON.parse(raw);
    return snap && typeof snap === 'object' ? snap : null;
  } catch {
    return null;
  }
}

function save(desk, userId, snap) {
  if (process.env.DESK_LIVE_PERSIST === '0') return;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(fileFor(desk, userId), JSON.stringify(snap || {}, null, 0));
  } catch {
    /* disk optional */
  }
}

const timers = new Map();

function scheduleSave(desk, userId, snapFn) {
  const key = `${desk}:${userId}`;
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    try {
      save(desk, userId, snapFn());
    } catch {
      /* ignore */
    }
  }, 400));
}

function brokerSnapshot(broker) {
  if (!broker) {
    return { closedOptionRs: 0, closedLegs: [], positions: [], lotsByInstrument: [] };
  }
  return {
    closedOptionRs: Number(broker.closedOptionRs) || 0,
    closedLegs: Array.isArray(broker.closedLegs) ? broker.closedLegs : [],
    positions: [...(broker.positions || new Map()).entries()],
    lotsByInstrument: [...(broker.lotsByInstrument || new Map()).entries()],
    optionMaxLossRsByInstrument: [...(broker.optionMaxLossRsByInstrument || new Map()).entries()],
    maxOpenLegs: broker.maxOpenLegs,
  };
}

function restoreBroker(broker, snap) {
  if (!broker || !snap) return broker;
  broker.closedOptionRs = Number(snap.closedOptionRs) || 0;
  broker.closedLegs = Array.isArray(snap.closedLegs) ? snap.closedLegs.map((p) => ({ ...p })) : [];
  broker.positions = new Map();
  for (const pair of snap.positions || []) {
    if (Array.isArray(pair) && pair[0]) broker.positions.set(pair[0], pair[1]);
  }
  for (const pair of snap.lotsByInstrument || []) {
    if (Array.isArray(pair) && pair[0]) broker.setLots(pair[0], pair[1]);
  }
  for (const pair of snap.optionMaxLossRsByInstrument || []) {
    if (Array.isArray(pair) && pair[0] && typeof broker.setOptionMaxLossRs === 'function') {
      broker.setOptionMaxLossRs(pair[0], pair[1]);
    }
  }
  if (snap.maxOpenLegs != null && typeof broker.setMaxOpenLegs === 'function') {
    broker.setMaxOpenLegs(snap.maxOpenLegs);
  }
  return broker;
}

module.exports = {
  load,
  save,
  scheduleSave,
  brokerSnapshot,
  restoreBroker,
  dir,
};
