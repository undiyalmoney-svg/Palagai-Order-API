'use strict';

const crypto = require('crypto');
const { NIFTY_500 } = require('../orb-backtest/universe');
const { deskAuthorization } = require('../market-desk/desk-auth');
const { sessionDate } = require('../research/time');
const { getDb, saveExperiment, loadExperiment, listExperiments } = require('../orb-backtest/store');
const { loadUniverseBars } = require('../orb-backtest/load-bars');
const { generateCandidates } = require('./candidates');
const { runDailyProfit } = require('./pipeline');
const { ENGINE_VERSION } = require('./simulate');
const { acquire, release, currentLock, resetLock } = require('../orb-backtest/lock');

const memory = new Map();
let runningId = null;

function validDay(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function stripHeavy(result) {
  if (!result) return null;
  const { candidateTrades, ...rest } = result;
  return {
    ...rest,
    recommended: rest.recommended
      ? { ...rest.recommended, trades: (rest.recommended.trades || []).slice(0, 400) }
      : null,
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    simulated: true,
    liveOrders: false,
    kind: 'daily-profit',
    progress: job.progress,
    error: job.error || null,
    coverage: job.coverage || null,
    warnings: job.warnings || [],
    result: stripHeavy(job.result),
    engineVersion: job.engineVersion || ENGINE_VERSION,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    input: job.input,
  };
}

function persist(job) {
  try {
    saveExperiment(getDb(), job);
  } catch {
    /* disk optional in tests */
  }
}

async function runJob(job, req) {
  const warnings = [];
  try {
    const authorization = await deskAuthorization(req);
    if (!authorization) {
      throw Object.assign(new Error('Connect Kite on Token first. Daily profit discovery needs a live access token.'), {
        status: 400,
      });
    }
    job.progress = { phase: 'instruments', done: 0, total: NIFTY_500.length, symbol: null };
    persist(job);
    const loaded = await loadUniverseBars({
      authorization,
      from: job.input.from,
      to: job.input.to,
      db: getDb(),
      shouldCancel: () => job.cancel,
      batchSize: 10,
      onProgress: (p) => {
        job.progress = p;
        job.updatedAt = new Date().toISOString();
        const size = p.batchSize || 10;
        if (p.phase !== 'candles' || p.done % size === 0 || (p.done + 1) % size === 0) persist(job);
      },
    });
    warnings.push(...(loaded.warnings || []));
    job.warnings = warnings;
    job.coverage = {
      requested: loaded.requested,
      resolved: loaded.resolved,
      withBars: loaded.withBars,
      cacheHits: loaded.cacheHits,
      missing: loaded.missing,
      noCandles: loaded.gaps,
      from: job.input.from,
      to: job.input.to,
      complete: loaded.withBars === loaded.requested,
    };
    if (!loaded.withBars) {
      throw Object.assign(
        new Error('Kite returned no 5-minute history for the Nifty 500 names in this range. Missing names are listed; prices are not invented.'),
        { status: 422 },
      );
    }
    job.progress = { phase: 'simulate', done: 0, total: generateCandidates({ budget: job.input.budget }).length, symbol: null };
    persist(job);
    const result = await runDailyProfit({
      symbolBars: loaded.symbolBars,
      capital: job.input.capital,
      budget: job.input.budget,
      coverage: job.coverage,
      onProgress: (p) => {
        job.progress = p;
        job.updatedAt = new Date().toISOString();
        persist(job);
      },
    });
    result.warnings = warnings;
    job.result = result;
    job.status = 'done';
    job.progress = { phase: 'done', done: result.candidatesEvaluated, total: result.candidatesEvaluated, symbol: null };
  } catch (err) {
    job.status = 'error';
    job.error = err.message || String(err);
  } finally {
    job.updatedAt = new Date().toISOString();
    persist(job);
    if (runningId === job.id) runningId = null;
    release(job.id);
  }
}

function startJob(req, body) {
  if (runningId || currentLock()) {
    const err = new Error('A historical research job is already running. Wait for it to finish.');
    err.status = 409;
    err.jobId = runningId || currentLock();
    throw err;
  }
  const from = validDay(body?.from || body?.date);
  const to = validDay(body?.to || body?.from || body?.date);
  if (!from || !to) {
    const err = new Error('Choose a from/to date range (YYYY-MM-DD).');
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
  if (span > 180) {
    const err = new Error('Keep the search to 180 calendar days. Kite 5-minute history is fetched in ~60-day chunks and cached.');
    err.status = 400;
    throw err;
  }
  const capital = Math.max(1000, Math.min(10_000_000, Number(body?.capital) || 10000));
  const budget = Math.max(10, Math.min(40, Math.floor(Number(body?.budget) || 20)));
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'running',
    input: { from, to, capital, budget },
    progress: { phase: 'queued', done: 0, total: NIFTY_500.length, symbol: null },
    warnings: [],
    coverage: null,
    result: null,
    error: null,
    engineVersion: ENGINE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancel: false,
    simulated: true,
    liveOrders: false,
  };
  memory.set(id, job);
  runningId = id;
  acquire(id, 'discover');
  persist(job);
  setImmediate(() => {
    void runJob(job, req);
  });
  return publicJob(job);
}

function getJob(id) {
  const live = memory.get(String(id || ''));
  if (live) return publicJob(live);
  try {
    const stored = loadExperiment(getDb(), id);
    return stored ? publicJob(stored) : null;
  } catch {
    return null;
  }
}

function listJobs() {
  try {
    return listExperiments(getDb()).filter((e) => String(e.engineVersion || '').includes('daily-profit'));
  } catch {
    return [...memory.values()].map(publicJob);
  }
}

function resetJobs() {
  memory.clear();
  runningId = null;
  resetLock();
}

function rawJob(id) {
  const live = memory.get(String(id || ''));
  if (live) return live;
  try {
    return loadExperiment(getDb(), id);
  } catch {
    return null;
  }
}

function getCandidateDetail(jobId, candidateId) {
  const job = rawJob(jobId);
  if (!job || !job.result) return null;
  const row = (job.result.leaderboard || []).find((r) => r.id === candidateId);
  if (!row) return null;
  const trades = (job.result.candidateTrades && job.result.candidateTrades[candidateId]) || [];
  return { simulated: true, liveOrders: false, candidate: row, trades };
}

module.exports = {
  startJob,
  getJob,
  listJobs,
  resetJobs,
  getCandidateDetail,
  publicJob,
};
