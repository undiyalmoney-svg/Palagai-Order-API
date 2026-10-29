'use strict';

const crypto = require('crypto');
const { NIFTY_500 } = require('./universe');
const {
  barsFromCandles,
  groupByDay,
  clampConfig,
  runOrbBacktest,
} = require('./engine');
const kite = require('../services/kite-market');
const { deskAuthorization } = require('../market-desk/desk-auth');
const { sessionDate } = require('../research/time');
const { acquire, release, currentLock, resetLock } = require('./lock');

const jobs = new Map();
let runningId = null;

function withSingleBookDefaults(body = {}) {
  if (body.preset === 'original' || body.desk === 'original') return body;
  if (body.preset === 'winner' || body.desk === 'winner') return { ...body, preset: 'winner' };
  if (body.rankBy || Object.prototype.hasOwnProperty.call(body, 'crowdFilter')) return body;
  const next = { ...body, preset: 'winner' };
  const capital = Number(body.capital);
  const names = Number(body.maxStocksPerDay);
  if (!Number.isFinite(capital) || capital === 40000) delete next.capital;
  if (!Number.isFinite(names) || names === 3) delete next.maxStocksPerDay;
  return next;
}

function persistInput(from, to, cfg, body) {
  const preset = body?.preset === 'winner' || body?.desk === 'winner' ? 'winner' : undefined;
  return {
    from,
    to,
    ...(preset ? { preset } : {}),
    capital: cfg.capital,
    maxStocksPerDay: cfg.maxStocksPerDay,
    pullbacksNeeded: cfg.pullbacksNeeded,
    entryEnd: cfg.entryEnd,
    timeExit: cfg.timeExit,
    targetR: cfg.targetR,
    trailAfterR: cfg.trailAfterR,
    orMinPct: cfg.orMinPct,
    orMaxPct: cfg.orMaxPct,
    minBreakPct: cfg.minBreakPct,
    sizing: cfg.sizing,
    rankBy: cfg.rankBy,
    crowdFilter: cfg.crowdFilter,
    slippage: cfg.slippage,
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

/** Kite /instruments/NSE dump — EQ rows only. Do not use parseInstrumentsCsv (Nifty 50/Bank only). */
function parseNseEqMap(csv, symbols) {
  const want = new Set((symbols || []).map((s) => String(s).toUpperCase()));
  const map = new Map();
  for (const line of String(csv || '').split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 12) continue;
    const exchange = (cols[11] || '').trim().toUpperCase();
    const itype = (cols[9] || '').trim().toUpperCase();
    if (exchange !== 'NSE' || itype !== 'EQ') continue;
    const sym = (cols[2] || '').trim().toUpperCase();
    if (want.size && !want.has(sym)) continue;
    const token = Number(cols[0]) || 0;
    if (!token) continue;
    map.set(sym, {
      instrumentToken: token,
      tradingSymbol: (cols[2] || '').trim(),
      exchange: 'NSE',
      instrumentType: 'EQ',
    });
  }
  return map;
}

async function resolveNseEq(authorization, symbols) {
  const csv = await kite.fetchInstrumentsCsv(authorization, 'NSE');
  return parseNseEqMap(csv, symbols);
}

/** NSE Nifty 50 index — well-known Kite token; skip the filtered instrument dump. */
const NIFTY_50_TOKEN = 256265;

async function fetchSymbolBars(authorization, token, from, to) {
  const candles = await kite.fetchHistoricalInterval(authorization, token, from, to, '5minute', {
    chunkGapMs: 350,
  });
  return groupByDay(barsFromCandles(candles));
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
    const cfg = clampConfig(job.input);
    const from = job.input.from;
    const to = job.input.to;
    job.progress = { phase: 'instruments', done: 0, total: NIFTY_500.length, symbol: null };
    job.updatedAt = new Date().toISOString();

    const inst = await resolveNseEq(authorization, NIFTY_500);
    const missing = NIFTY_500.filter((s) => !inst.has(s));
    const resolved = NIFTY_500.filter((s) => inst.has(s));
    job.missing = missing;
    if (!resolved.length) {
      throw Object.assign(new Error('No Nifty 500 NSE EQ tokens were found in the Kite instrument dump.'), {
        status: 400,
      });
    }

    const symbolBars = {};
    const gaps = [];
    for (let i = 0; i < resolved.length; i += 1) {
      if (job.cancel) throw Object.assign(new Error('Cancelled'), { status: 499 });
      const symbol = resolved[i];
      job.progress = { phase: 'candles', done: i, total: resolved.length, symbol };
      job.updatedAt = new Date().toISOString();
      try {
        if (i) await new Promise((r) => setTimeout(r, 350));
        const bars = await fetchSymbolBars(authorization, inst.get(symbol).instrumentToken, from, to);
        const days = Object.keys(bars);
        if (!days.length) {
          gaps.push(symbol);
          continue;
        }
        symbolBars[symbol] = bars;
      } catch (err) {
        const msg = String(err.message || err);
        if (/401|403|incorrect|token|session/i.test(msg)) {
          throw Object.assign(new Error('Kite session expired or was rejected. Refresh Token, then run again.'), {
            status: 401,
          });
        }
        if (/429|too many/i.test(msg)) {
          warnings.push(`Rate limited on ${symbol}; waiting and continuing.`);
          await new Promise((r) => setTimeout(r, 2000));
          i -= 1;
          continue;
        }
        gaps.push(symbol);
        warnings.push(`${symbol}: ${msg}`);
      }
    }

    if (!Object.keys(symbolBars).length) {
      throw Object.assign(
        new Error('Kite returned no 5-minute history for the Nifty 500 names in this range. Check the dates and token permissions.'),
        { status: 422 },
      );
    }

    job.progress = { phase: 'simulate', done: resolved.length, total: resolved.length, symbol: null };
    const result = runOrbBacktest({ symbolBars, config: cfg });
    result.universe = {
      requested: NIFTY_500.length,
      resolved: resolved.length,
      withBars: Object.keys(symbolBars).length,
      missing,
      noCandles: gaps,
    };
    result.range = { from, to };
    result.warnings = warnings;
    result.note =
      'Results are a simulated historical ORB book on retrieved Kite 5-minute candles. They are not live trading P&L.';
    job.result = result;
    job.warnings = warnings;
    job.status = 'done';
    job.progress = { phase: 'done', done: resolved.length, total: resolved.length, symbol: null };
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
  const deskBody = withSingleBookDefaults(body);
  const cfg = clampConfig(deskBody);
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'running',
    input: persistInput(from, to, cfg, deskBody),
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
  getJob,
  listActive,
  publicJob,
  parseNseEqMap,
  resetJobs,
  NIFTY_50_TOKEN,
};
