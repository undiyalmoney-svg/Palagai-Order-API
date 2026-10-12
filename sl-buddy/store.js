/**
 * SL Buddy enabled flag — survives pm2 restart. Worker is idle unless watching.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'sl-buddy', 'state.json');

function filePath() {
  return process.env.SL_BUDDY_STATE || FILE;
}

function empty(date) {
  return {
    enabled: false,
    userId: null,
    date,
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
    return {
      ...empty(today),
      ...raw,
      date: today,
      enabled: raw.enabled === true,
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

function publicView(state, snapshot = {}) {
  return {
    watching: state.enabled === true,
    date: state.date,
    lastTick: state.lastTick,
    lastError: state.lastError,
    lastMessage: state.lastMessage,
    sessionOk: state.sessionOk === true,
    pending: Array.isArray(snapshot.pending) ? snapshot.pending : [],
    live: Array.isArray(snapshot.live) ? snapshot.live : [],
    sl: Array.isArray(snapshot.sl) ? snapshot.sl : [],
  };
}

module.exports = { FILE, empty, todayIst, load, save, publicView };
