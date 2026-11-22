/**
 * 5-Minute Sniper state on the droplet. Survives tab close and pm2 restart.
 * Independent of Arise / paper-live.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'sniper');
const FILE = path.join(DIR, 'state.json');
const DAYS = path.join(DIR, 'days');
const paths = { FILE, DAYS };

function archiveDay(raw) {
  if (!raw || !raw.date) return;
  const books = raw.session && Array.isArray(raw.session.books) ? raw.session.books : [];
  const has = books.some((b) => (Array.isArray(b.fills) && b.fills.length) || (Array.isArray(b.skips) && b.skips.length));
  if (!has) return;
  try {
    fs.mkdirSync(paths.DAYS, { recursive: true });
    fs.writeFileSync(path.join(paths.DAYS, `${raw.date}.json`), JSON.stringify(raw, null, 2));
  } catch (err) {
    console.error('[sniper] archive', err.message || err);
  }
}

function todayIst(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function empty(date) {
  return {
    date,
    running: false,
    live: false,
    userId: null,
    session: null,
    lastTick: null,
    lastError: null,
    lastMessage: null,
    sessionOk: false,
  };
}

function load(now = new Date()) {
  const today = todayIst(now);
  try {
    const raw = JSON.parse(fs.readFileSync(paths.FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return empty(today);
    const keepLive = raw.live === true;
    const keepRunning = raw.running === true;
    const userId = raw.userId || null;
    if (raw.date !== today) {
      archiveDay(raw);
      return { ...empty(today), live: keepLive, running: keepRunning, userId };
    }
    const session =
      raw.session && typeof raw.session === 'object' && Array.isArray(raw.session.books) ? raw.session : null;
    return {
      ...empty(today),
      ...raw,
      date: today,
      running: keepRunning,
      live: keepLive,
      userId,
      session,
      sessionOk: raw.sessionOk === true,
    };
  } catch {
    return empty(today);
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(paths.FILE), { recursive: true });
  const tmp = `${paths.FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, paths.FILE);
}

function sessionActivity(session) {
  const books = session && Array.isArray(session.books) ? session.books : [];
  return books.reduce((n, b) => {
    const fills = Array.isArray(b.fills) ? b.fills.length : 0;
    const skips = Array.isArray(b.skips) ? b.skips.length : 0;
    const open = b.side && b.side !== 'flat' ? 1 : 0;
    const reason = String(b.reason || '').trim() ? 1 : 0;
    return n + fills + skips + open + reason;
  }, 0);
}

function takeSession(current, incoming, now = new Date()) {
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.books)) return current || null;
  const day = todayIst(now);
  if (incoming.day && incoming.day !== day) return current || null;
  if (sessionActivity(incoming) > 0 || sessionActivity(current) === 0) return incoming;
  return current;
}

function liveArmed(state) {
  return !!state.live;
}

function publicView(state) {
  const armed = liveArmed(state);
  return {
    running: !!state.running,
    live: !!state.live,
    lastTick: state.lastTick || null,
    lastError: state.lastError || null,
    lastMessage: state.lastMessage || null,
    sessionOk: !!state.sessionOk,
    dropletWatching: !!state.running,
    dropletPlacing: armed,
    session: state.session || null,
  };
}

module.exports = { FILE, paths, empty, load, save, liveArmed, publicView, todayIst, sessionActivity, takeSession, archiveDay };
