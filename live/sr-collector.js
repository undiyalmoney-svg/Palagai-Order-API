'use strict';
/**
 * S/R AUTOMATIC REAL-OPTION COLLECTOR — backend-driven, read-only.
 *
 * Runs inside the existing backend process (booted additively — it does NOT
 * modify or import the live-order worker) and, during market hours, polls the
 * validated underlying signal engine and captures the REAL option snapshot +
 * path via sr-observe.observe(). It places NO broker orders.
 *
 * Properties required by the spec:
 *   - Independent of the frontend: a setInterval in the backend; keeps running
 *     when the browser/Live tab closes.
 *   - Singleton: a heartbeat lockfile prevents duplicate collectors across a
 *     PM2 restart/reload (only one live instance polls).
 *   - Restart-safe: observe() reloads today's JSONL records and resumes path
 *     tracking on open observations — no duplicate entries.
 *   - Never throws out of a tick; API failures are recorded, not invented.
 *   - Central, configurable market hours / interval (env overrides).
 */
const fs = require('fs');
const path = require('path');
const store = require('./live.store');
const { observe, loadRecords, dashboard } = require('./sr-observe');

const DIR = path.join(__dirname, '..', 'sr-observations');
const STATUS_FILE = path.join(DIR, 'collector-status.json');
const LOCK_FILE = path.join(DIR, 'collector.lock');

const CONFIG = {
  MARKET_TIMEZONE: process.env.SR_MARKET_TZ || 'Asia/Kolkata', // fixed IST offset used below
  MARKET_OPEN: process.env.SR_MARKET_OPEN || '09:15',
  MARKET_CLOSE: process.env.SR_MARKET_CLOSE || '15:35',        // NSE index; extend for MCX crude
  COLLECTOR_INTERVAL_MS: Number(process.env.SR_INTERVAL_MS || 60000),
  INSTRUMENTS: (process.env.SR_INSTRUMENTS || 'nifty,banknifty').split(',').map((s) => s.trim()).filter(Boolean),
  LOTS: Number(process.env.SR_LOTS || 1),
};

const state = {
  running: false, startedAt: null, pid: process.pid,
  lastPoll: null, lastPollStatus: 'idle', lastError: null,
  lastSignalId: null, polls: 0, idleReason: null,
};
let timer = null;

// IST time-of-day 'HH:MM' and weekday check (offset +5:30, no DST in India).
function istParts(now = new Date()) {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  const hm = String(ist.getHours()).padStart(2, '0') + ':' + String(ist.getMinutes()).padStart(2, '0');
  return { hm, day: ist.getDay(), date: ist.toISOString().slice(0, 10) };
}
function isMarketHours(now = new Date()) {
  const { hm, day } = istParts(now);
  if (day === 0 || day === 6) return false;                    // weekend
  return hm >= CONFIG.MARKET_OPEN && hm <= CONFIG.MARKET_CLOSE;
}

// ── singleton lock (heartbeat) ───────────────────────────────────────────────
function lockIsLive() {
  try {
    const l = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    const fresh = Date.now() - l.ts < CONFIG.COLLECTOR_INTERVAL_MS * 3;
    if (l.pid === process.pid) return false;                   // our own lock: reclaimable
    if (!fresh) return false;                                  // stale: previous instance died
    try { process.kill(l.pid, 0); return true; } catch { return false; } // pid alive?
  } catch { return false; }
}
function writeLock() { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, ts: Date.now() })); } catch { /* ignore */ } }
function releaseLock() { try { const l = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); if (l.pid === process.pid) fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ } }

function writeStatus() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const recs = loadRecords();
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...state, config: CONFIG, dashboard: dashboard(recs, istParts().date), writtenAt: new Date().toISOString() }, null, 1));
  } catch (e) { /* never throw from status */ }
}

async function tick() {
  try {
    writeLock();                                               // heartbeat
    if (!isMarketHours()) { state.lastPollStatus = 'idle'; state.idleReason = 'outside market hours'; writeStatus(); return; }
    const auth = await store.getAnyAuthorization();
    if (!auth) { state.lastPollStatus = 'no-auth'; state.idleReason = 'no Kite token pushed'; writeStatus(); return; }
    const out = await observe(auth, { instruments: CONFIG.INSTRUMENTS, lots: CONFIG.LOTS });
    state.lastPoll = new Date().toISOString();
    state.lastPollStatus = 'ok'; state.idleReason = null; state.polls += 1;
    const recs = loadRecords();
    const last = recs[recs.length - 1];
    state.lastSignalId = last ? last.SIGNAL_ID : state.lastSignalId;
    writeStatus();
  } catch (e) {
    state.lastError = String(e.message || e);
    state.lastPollStatus = 'error';
    writeStatus();                                             // record failure, never invent data
  }
}

/** Idempotent, singleton-guarded boot. Safe to call from module load / an endpoint. */
function boot() {
  if (state.running) return { started: false, reason: 'already running in this process' };
  if (lockIsLive()) { state.lastPollStatus = 'standby'; state.idleReason = 'another collector holds the lock'; writeStatus(); return { started: false, reason: 'another collector instance holds the lock' }; }
  writeLock();
  state.running = true; state.startedAt = new Date().toISOString();
  timer = setInterval(() => { tick(); }, CONFIG.COLLECTOR_INTERVAL_MS);
  if (timer.unref) timer.unref();                              // don't keep the event loop alive on its own
  tick();                                                      // immediate first poll
  return { started: true };
}
function stopCollector() { if (timer) { clearInterval(timer); timer = null; } state.running = false; releaseLock(); }

/** Read-only status for the /sr-observe/status endpoint. Prefers the live file. */
function status() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); }
  catch {
    const recs = loadRecords();
    return { ...state, config: CONFIG, dashboard: dashboard(recs, istParts().date) };
  }
}

module.exports = { boot, stopCollector, status, tick, isMarketHours, CONFIG, _state: state };
