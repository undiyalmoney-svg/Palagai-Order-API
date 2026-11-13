/**
 * Paper-test live Kite state on the droplet. Survives tab close and pm2 restart.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'paper-live', 'state.json');
const UNDERS = ['nifty', 'bank', 'sensex', 'crude'];

function emptyBooks() {
  return { nifty: false, bank: false, sensex: false, crude: false };
}

function todayIst(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function emptyEvolve() {
  return {
    applied: [{ id: 'option-tick-exit-when-bid-through-level', at: 'shipped', day: '2026-11-13' }],
  };
}

function empty(date) {
  return {
    date,
    running: false,
    live: false,
    books: emptyBooks(),
    userId: null,
    session: null,
    evolve: emptyEvolve(),
    lastTick: null,
    lastError: null,
    lastMessage: null,
    sessionOk: false,
  };
}

function load(now = new Date()) {
  const today = todayIst(now);
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return empty(today);
    const books = { ...emptyBooks(), ...(raw.books || {}) };
    for (const u of UNDERS) books[u] = !!books[u];
    const base = raw.date !== today ? { ...empty(today), live: raw.live === true, books, userId: raw.userId || null, running: raw.running === true } : raw;
    return {
      ...empty(today),
      ...base,
      date: today,
      running: base.running === true,
      live: base.live === true,
      books,
      userId: base.userId || null,
      session: base.session && typeof base.session === 'object' ? base.session : null,
      evolve: base.evolve && typeof base.evolve === 'object' ? base.evolve : emptyEvolve(),
      sessionOk: base.sessionOk === true,
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

function liveArmed(state) {
  return !!state.live && UNDERS.some((u) => !!state.books[u]);
}

function publicView(state) {
  const armed = liveArmed(state);
  return {
    running: !!state.running,
    live: !!state.live,
    books: { ...emptyBooks(), ...(state.books || {}) },
    lastTick: state.lastTick || null,
    lastError: state.lastError || null,
    lastMessage: state.lastMessage || null,
    sessionOk: !!state.sessionOk,
    dropletWatching: !!state.running,
    dropletPlacing: armed,
    session: state.session || null,
  };
}

module.exports = { FILE, UNDERS, empty, emptyBooks, emptyEvolve, load, save, liveArmed, publicView, todayIst };
