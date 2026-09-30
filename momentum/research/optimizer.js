'use strict';

const { runBacktest } = require('../backtest/backtester');
const { PortfolioDecisionEngine } = require('../engine/portfolio-decision-engine');
const { resolveParams, paramsHash, withOverrides } = require('../config/defaults');
const { makeRng } = require('../utils/rng');
const { round } = require('../utils/math');
const { addDays } = require('../utils/dates');

/**
 * Strategy research: choose parameters on TRAIN, confirm on VALIDATION, and
 * report the untouched OUT-OF-SAMPLE segment last (only for the finalists).
 * A walk-forward mode repeats "fit on a rolling window, test on the next
 * window" and stitches the test windows into one out-of-sample curve.
 *
 * The search is deliberately small and the objective robust (it uses the worse
 * of train and validation, penalises drawdown and thin trade counts), and the
 * result carries explicit overfitting flags. It cannot promise future returns.
 */

const SEARCH_SPACE = {
  horizon: ['DAILY', 'WEEKLY', 'MONTHLY'],
  minScore: [54, 58, 62, 66, 70],
  maxPositions: [6, 8, 10, 12],
  stopAtrMult: [2, 2.5, 3, 3.5],
  trailAtrMult: [2.5, 3, 4, 5],
  riskPerTradePct: [0.0075, 0.01, 0.0125],
  replaceMinScoreGain: [8, 12, 16],
};

const engine = new PortfolioDecisionEngine();

function objective(m) {
  if (!m || !m.days) return -10;
  let s = m.sharpe;
  s -= (Math.max(0, m.maxDrawdownPct - 20) / 10) * 0.5;
  if (m.roundTrips < 15) s -= (15 - m.roundTrips) * 0.05;
  if (m.cagrPct < 0) s -= 0.5;
  return round(s, 3);
}

function splitDates(panel, params, from, to, ratios = [0.5, 0.25, 0.25]) {
  const firstUsable = Math.min(...panel.symbols().map((s) => panel.meta.get(s).firstIdx)) + params.minHistoryBars;
  const start = Math.max(firstUsable, panel.indexOnOrBefore(from) < 0 ? 0 : panel.indexOnOrBefore(from));
  const end = panel.indexOnOrBefore(to);
  if (end - start < 500) throw new Error('Need at least ~2 years of usable history to split into train / validation / out-of-sample');
  const n = end - start;
  const t1 = start + Math.floor(n * ratios[0]);
  const t2 = start + Math.floor(n * (ratios[0] + ratios[1]));
  return {
    train: { from: panel.dates[start], to: panel.dates[t1] },
    validation: { from: panel.dates[t1 + 1], to: panel.dates[t2] },
    oos: { from: panel.dates[t2 + 1], to: panel.dates[end] },
  };
}

function sampleCandidates(base, space, n, seed) {
  const rng = makeRng(`opt:${seed}`);
  const keys = Object.keys(space);
  const out = [{ label: 'baseline', overrides: {} }];
  const seen = new Set([paramsHash(resolveParams(base))]);
  let guard = 0;
  while (out.length < n + 1 && guard < n * 20) {
    guard += 1;
    const overrides = {};
    for (const k of keys) overrides[k] = space[k][Math.floor(rng.rand() * space[k].length)];
    if (overrides.horizon !== base.horizon) {
      delete overrides.stopAtrMult;
      delete overrides.trailAtrMult;
    }
    const p = withOverrides(base, { ...overrides, id: 'candidate' });
    const h = paramsHash(p);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push({ label: `c${out.length}`, overrides });
  }
  return out;
}

function evaluate(panel, base, overrides, seg, cfg) {
  const params = withOverrides(base, { ...overrides, id: 'candidate' });
  try {
    const r = runBacktest({ panel, params, capital: cfg.capital, from: seg.from, to: seg.to, costs: cfg.costs, slippageBps: cfg.slippageBps, keepTimeline: false, lean: true, engine });
    return r.metrics;
  } catch {
    return null;
  }
}

const slim = (m) =>
  m && {
    cagrPct: m.cagrPct,
    totalReturnPct: m.totalReturnPct,
    maxDrawdownPct: m.maxDrawdownPct,
    sharpe: m.sharpe,
    sortino: m.sortino,
    winRatePct: m.winRatePct,
    profitFactor: m.profitFactor,
    roundTrips: m.roundTrips,
    turnoverPerYear: m.turnoverPerYear,
    benchmarkCagrPct: m.benchmarkCagrPct,
    days: m.days,
  };

function runOptimization({ panel, baseParams, from, to, capital = 1_000_000, costs, slippageBps = 5, candidates = 20, seed = 'v1', space = SEARCH_SPACE, topK = 3, onProgress = () => {}, shouldCancel = () => false }) {
  const base = resolveParams(baseParams);
  const splits = splitDates(panel, base, from, to);
  const cfg = { capital, costs, slippageBps };
  const list = sampleCandidates(base, space, candidates, seed);
  const rows = [];
  let done = 0;
  const total = list.length * 2 + topK * 3;
  const tick = () => {
    done += 1;
    onProgress(Math.min(0.99, done / total));
    if (shouldCancel()) throw Object.assign(new Error('Cancelled'), { cancelled: true });
  };
  for (const c of list) {
    const train = evaluate(panel, base, c.overrides, splits.train, cfg);
    tick();
    const validation = evaluate(panel, base, c.overrides, splits.validation, cfg);
    tick();
    const ot = objective(train);
    const ov = objective(validation);
    rows.push({ label: c.label, overrides: c.overrides, train: slim(train), validation: slim(validation), trainObjective: ot, validationObjective: ov, robustObjective: Math.min(ot, ov) });
  }
  rows.sort((a, b) => b.robustObjective - a.robustObjective);
  const baselineRow = rows.find((r) => r.label === 'baseline');
  const finalists = rows.slice(0, topK);
  if (baselineRow && !finalists.includes(baselineRow)) finalists.push(baselineRow);
  for (const f of finalists) {
    f.oos = slim(evaluate(panel, base, f.overrides, splits.oos, cfg));
    tick();
    f.oosObjective = objective(f.oos);
    const flags = [];
    if (f.validationObjective < 0.5 * f.trainObjective && f.trainObjective > 0) flags.push('Validation objective is less than half of train - likely overfit to the train period');
    if (f.oos && f.oosObjective < 0.5 * f.validationObjective && f.validationObjective > 0) flags.push('Out-of-sample objective collapses versus validation');
    if (f.train && f.train.roundTrips < 20) flags.push('Few trades in the train period - statistically weak');
    if (f.oos && f.oos.cagrPct <= (f.oos.benchmarkCagrPct ?? -Infinity)) flags.push('Does not beat buy-and-hold NIFTY out of sample');
    f.overfitFlags = flags;
    f.params = {
      overrides: f.overrides,
      hash: paramsHash(withOverrides(base, { ...f.overrides, id: 'candidate' })),
    };
  }
  const best = finalists.filter((f) => f.label !== 'baseline').sort((a, b) => b.robustObjective - a.robustObjective)[0] || baselineRow;
  const baselineOos = baselineRow?.oos;
  let verdict;
  if (!best || !best.oos) verdict = 'No valid candidate.';
  else if (best.label === 'baseline') verdict = 'The current parameters are already the most robust choice among the candidates tested. Keep them.';
  else if (best.overfitFlags.length) verdict = `Best candidate ${best.label} has warning flags (${best.overfitFlags.length}). Do not adopt without further review.`;
  else if (baselineOos && best.oosObjective <= objective(baselineOos)) verdict = `Best candidate ${best.label} did not improve on the current parameters out of sample. Keep the current parameters.`;
  else verdict = `Candidate ${best.label} improved robustly across train, validation and out-of-sample. Consider adopting it, then paper trade first.`;
  onProgress(1);
  return {
    kind: 'OPTIMIZE',
    splits,
    candidatesTested: list.length,
    seed,
    space: Object.keys(space),
    ranked: rows.slice(0, 12),
    finalists,
    best: best ? { label: best.label, overrides: best.overrides, hash: best.params?.hash } : null,
    verdict,
    caveat: 'Parameter search always finds something that looks good in the past. Only the out-of-sample segment (never used to choose parameters) is indicative, and even that is one historical path.',
  };
}

/**
 * Walk-forward: for each window, pick the best of a small candidate set on the
 * training span, then trade the FOLLOWING span with it. Stitches test spans.
 */
function runWalkForward({ panel, baseParams, from, to, capital = 1_000_000, costs, slippageBps = 5, trainMonths = 24, testMonths = 6, candidates = 6, seed = 'wf', space = SEARCH_SPACE, onProgress = () => {}, shouldCancel = () => false }) {
  const base = resolveParams(baseParams);
  const firstUsable = Math.min(...panel.symbols().map((s) => panel.meta.get(s).firstIdx)) + base.minHistoryBars;
  let start = panel.dates[Math.max(firstUsable, panel.indexOnOrBefore(from) < 0 ? 0 : panel.indexOnOrBefore(from))];
  const end = panel.dates[panel.indexOnOrBefore(to)];
  const list = sampleCandidates(base, space, candidates, seed);
  const windows = [];
  let cursor = start;
  const addMonths = (d, m) => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCMonth(dt.getUTCMonth() + m);
    return dt.toISOString().slice(0, 10);
  };
  for (;;) {
    const trainTo = addMonths(cursor, trainMonths);
    if (trainTo >= end) break;
    const testFrom = addDays(trainTo, 1);
    const testTo = addMonths(trainTo, testMonths) > end ? end : addMonths(trainTo, testMonths);
    if (testFrom >= testTo) break;
    windows.push({ trainFrom: cursor, trainTo, testFrom, testTo });
    if (testTo >= end) break;
    cursor = addMonths(cursor, testMonths);
  }
  if (!windows.length) throw new Error('Not enough history for walk-forward with the chosen window lengths');
  const cfg = { capital, costs, slippageBps };
  const out = [];
  const stitched = [];
  let idxDone = 0;
  const totalSteps = windows.length * (list.length + 1);
  const step = () => {
    idxDone += 1;
    onProgress(Math.min(0.99, idxDone / totalSteps));
    if (shouldCancel()) throw Object.assign(new Error('Cancelled'), { cancelled: true });
  };
  let level = 1;
  for (const w of windows) {
    let best = null;
    for (const c of list) {
      const m = evaluate(panel, base, c.overrides, { from: w.trainFrom, to: w.trainTo }, cfg);
      step();
      const o = objective(m);
      if (!best || o > best.o) best = { c, o, m };
    }
    const testParams = withOverrides(base, { ...best.c.overrides, id: 'wf' });
    let test = null;
    try {
      test = runBacktest({ panel, params: testParams, capital, from: w.testFrom, to: w.testTo, costs, slippageBps, keepTimeline: false, lean: true, engine });
    } catch {
      test = null;
    }
    step();
    const ret = test ? test.metrics.totalReturnPct / 100 : 0;
    level *= 1 + ret;
    stitched.push({ to: w.testTo, level: round(level, 4) });
    out.push({
      ...w,
      chosen: best.c.label,
      overrides: best.c.overrides,
      trainObjective: best.o,
      test: test ? slim(test.metrics) : null,
      benchmarkReturnPct: test?.metrics.benchmarkReturnPct ?? null,
    });
  }
  const testRets = out.filter((w) => w.test).map((w) => w.test.totalReturnPct);
  const benchRets = out.filter((w) => w.test).map((w) => w.benchmarkReturnPct ?? 0);
  const beat = out.filter((w) => w.test && w.test.totalReturnPct > (w.benchmarkReturnPct ?? 0)).length;
  const years = Math.max(0.25, (new Date(out[out.length - 1].testTo) - new Date(out[0].testFrom)) / (365.25 * 86_400_000));
  const stitchedReturn = level - 1;
  let benchLevel = 1;
  for (const r of benchRets) benchLevel *= 1 + r / 100;
  onProgress(1);
  return {
    kind: 'WALK_FORWARD',
    trainMonths,
    testMonths,
    windows: out,
    stitched,
    summary: {
      windows: out.length,
      windowsBeatingBenchmark: beat,
      stitchedReturnPct: round(stitchedReturn * 100, 2),
      stitchedCagrPct: round((Math.pow(level, 1 / years) - 1) * 100, 2),
      benchmarkStitchedReturnPct: round((benchLevel - 1) * 100, 2),
      avgTestWindowReturnPct: testRets.length ? round(testRets.reduce((a, b) => a + b, 0) / testRets.length, 2) : 0,
      worstTestWindowPct: testRets.length ? Math.min(...testRets) : 0,
    },
    caveat: 'Every test window uses parameters chosen only from data before it. Each window starts flat (no carried positions), so stitched returns are an approximation of continuous trading.',
  };
}

module.exports = { runOptimization, runWalkForward, splitDates, objective, SEARCH_SPACE };
