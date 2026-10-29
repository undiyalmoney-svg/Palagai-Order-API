'use strict';

const crypto = require('crypto');
const { NIFTY_500 } = require('./universe');
const { deskAuthorization } = require('../market-desk/desk-auth');
const { sessionDate } = require('../research/time');
const { acquire, release, currentLock, resetLock } = require('./lock');
const { getDb } = require('./store');
const kite = require('../services/kite-market');
const { loadUniverseBars, parseNseEqMap } = require('./load-bars');
const {
  clampCapital,
  clampLiveCapital,
  namesFromCapital,
  deskConfig,
  runPdhFollowBook,
  LIVE_MAX_NAMES,
  LIVE_TARGET_R,
} = require('./pdh-desk');

const jobs = new Map();
let runningId = null;

const NIFTY_50_TOKEN = 256265;

function persistInput(from, to, capital) {
  const cfg = deskConfig(capital);
  return {
    from,
    to,
    liveToday: false,
    preset: 'pdh-follow',
    family: cfg.family,
    capital: cfg.capital,
    maxStocksPerDay: cfg.maxStocksPerDay,
    rankBy: cfg.rankBy,
    crowdFilter: cfg.crowdFilter,
    entryEnd: cfg.entryEnd,
    timeExit: cfg.timeExit,
    targetR: LIVE_TARGET_R,
    sizing: cfg.sizing,
  };
}

function addCalendarDays(day, delta) {
  const ms = Date.parse(`${day}T12:00:00+05:30`) + delta * 86400000;
  return sessionDate(new Date(ms));
}

function persistLiveInput(today) {
  const from = addCalendarDays(today, -7);
  const cfg = deskConfig(1, { liveLock: true });
  return {
    from,
    to: today,
    liveToday: true,
    preset: 'pdh-follow-live-lock',
    family: cfg.family,
    capital: 0,
    fundsRs: null,
    maxStocksPerDay: LIVE_MAX_NAMES,
    rankBy: cfg.rankBy,
    crowdFilter: cfg.crowdFilter,
    entryEnd: cfg.entryEnd,
    timeExit: cfg.timeExit,
    targetR: LIVE_TARGET_R,
    sizing: cfg.sizing,
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    simulated: true,
    liveOrders: false,
    input: job.input || null,
    progress: job.progress,
    error: job.error || null,
    warnings: job.warnings || [],
    missing: job.missing || [],
    result: job.result || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function listActive() {
  return [...jobs.values()].find((j) => j.status === 'running') || null;
}

function validDay(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

async function runJob(job, req) {
  const warnings = [];
  try {
    const authorization = await deskAuthorization(req);
    if (!authorization) {
      throw Object.assign(new Error('Connect Kite on Token first. Historical Backtest needs a live access token.'), {
        status: 400,
      });
    }
    const liveToday = !!job.input.liveToday;
    if (liveToday) {
      job.progress = { phase: 'funds', done: 0, total: NIFTY_500.length, symbol: null };
      job.updatedAt = new Date().toISOString();
      let funds;
      try {
        funds = await kite.fetchUserMargins(authorization);
      } catch {
        throw Object.assign(
          new Error('Could not read Kite funds. Refresh Token, then load live today again.'),
          { status: 401 },
        );
      }
      const cash = clampLiveCapital(funds && (funds.equityCash || funds.capitalRs));
      if (!(cash > 0)) {
        throw Object.assign(
          new Error('Kite equity cash is empty. Live today sizes from real funds, not the backtest capital box.'),
          { status: 400 },
        );
      }
      job.input.capital = cash;
      job.input.fundsRs = cash;
      job.input.maxStocksPerDay = LIVE_MAX_NAMES;
      job.input.targetR = LIVE_TARGET_R;
    }
    job.progress = { phase: 'instruments', done: 0, total: NIFTY_500.length, symbol: null };
    job.updatedAt = new Date().toISOString();

    const loaded = await loadUniverseBars({
      authorization,
      from: job.input.from,
      to: job.input.to,
      db: getDb(),
      shouldCancel: () => job.cancel,
      batchSize: 10,
      fillDay: liveToday ? job.input.to : null,
      alwaysRefreshFillDay: liveToday,
      onProgress: (p) => {
        job.progress = p;
        job.updatedAt = new Date().toISOString();
      },
    });
    warnings.push(...(loaded.warnings || []));
    job.warnings = warnings;
    job.missing = loaded.missing || [];
    if (!loaded.withBars) {
      throw Object.assign(
        new Error('Kite returned no 5-minute history for the Nifty 500 names in this range. Missing names are listed; prices are not invented.'),
        { status: 422 },
      );
    }

    job.progress = { phase: 'simulate', done: loaded.withBars, total: loaded.requested, symbol: null };
    const result = await runPdhFollowBook({
      symbolBars: loaded.symbolBars,
      capital: job.input.capital,
      liveLock: liveToday,
      fundsRs: liveToday ? job.input.fundsRs : null,
    });
    result.universe = {
      requested: loaded.requested,
      resolved: loaded.resolved,
      withBars: loaded.withBars,
      cacheHits: loaded.cacheHits,
      missing: loaded.missing,
      noCandles: loaded.gaps,
    };
    result.range = { from: job.input.from, to: job.input.to };
    result.warnings = warnings;
    job.result = result;
    job.warnings = warnings;
    job.status = 'done';
    job.progress = { phase: 'done', done: loaded.withBars, total: loaded.requested, symbol: null };
  } catch (err) {
    job.status = 'error';
    job.error = err.message || String(err);
    job.httpStatus = err.status || 500;
  } finally {
    job.updatedAt = new Date().toISOString();
    if (runningId === job.id) runningId = null;
    release(job.id);
  }
}

function startJob(req, body) {
  const active = listActive();
  const other = currentLock();
  if (active || other) {
    const err = new Error('A historical backtest is already running. Wait for it to finish.');
    err.status = 409;
    err.jobId = (active && active.id) || other;
    throw err;
  }
  const from = validDay(body?.from || body?.date);
  const to = validDay(body?.to || body?.from || body?.date);
  if (!from || !to) {
    const err = new Error('Choose a trading day or a from/to date range (YYYY-MM-DD).');
    err.status = 400;
    throw err;
  }
  if (from > to) {
    const err = new Error('The start date must be on or before the end date.');
    err.status = 400;
    throw err;
  }
  const today = sessionDate(new Date());
  if (to > today) {
    const err = new Error('The range cannot include future dates.');
    err.status = 400;
    throw err;
  }
  const span =
    (Date.parse(`${to}T00:00:00+05:30`) - Date.parse(`${from}T00:00:00+05:30`)) / 86400000;
  if (span > 60) {
    const err = new Error('Kite 5-minute history is requested in chunks of about 60 days. Keep the range to 60 calendar days or less.');
    err.status = 400;
    throw err;
  }
  const capital = clampCapital(body?.capital);
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'running',
    input: persistInput(from, to, capital),
    progress: { phase: 'queued', done: 0, total: NIFTY_500.length, symbol: null },
    warnings: [],
    missing: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancel: false,
  };
  jobs.set(id, job);
  runningId = id;
  acquire(id);
  setImmediate(() => {
    void runJob(job, req);
  });
  return publicJob(job);
}

function startLiveJob(req, _body) {
  const active = listActive();
  const other = currentLock();
  if (active || other) {
    const err = new Error('A historical backtest is already running. Wait for it to finish.');
    err.status = 409;
    err.jobId = (active && active.id) || other;
    throw err;
  }
  const today = sessionDate(new Date());
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'running',
    input: persistLiveInput(today),
    progress: { phase: 'queued', done: 0, total: NIFTY_500.length, symbol: null },
    warnings: [],
    missing: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancel: false,
  };
  jobs.set(id, job);
  runningId = id;
  acquire(id);
  setImmediate(() => {
    void runJob(job, req);
  });
  return publicJob(job);
}

function getJob(id) {
  return publicJob(jobs.get(String(id || '')));
}

function resetJobs() {
  jobs.clear();
  runningId = null;
  resetLock();
}

module.exports = {
  startJob,
  startLiveJob,
  getJob,
  listActive,
  publicJob,
  parseNseEqMap,
  resetJobs,
  NIFTY_50_TOKEN,
  namesFromCapital,
};
