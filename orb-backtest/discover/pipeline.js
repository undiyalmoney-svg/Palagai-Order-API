'use strict';

const { runOrbBacktest, ENGINE_VERSION, clampConfig } = require('../engine');
const { generateCandidates, toEngineConfig, BASELINE_ID } = require('./candidates');
const { scoreTrades } = require('./metrics');
const { allDays, splitDays, walkForwardFolds, filterTrades } = require('./split');
const { rankCandidates } = require('./rank');

function simulateCandidate(symbolBars, candidate, capital) {
  const cfg = clampConfig(toEngineConfig(candidate, capital));
  const out = runOrbBacktest({ symbolBars, config: cfg });
  return out;
}

function packRow(candidate, fullOut, days, capital, split) {
  const fullTrades = fullOut.trades || [];
  const train = scoreTrades(filterTrades(fullTrades, split.train), capital, split.train);
  const validation = scoreTrades(filterTrades(fullTrades, split.validation), capital, split.validation);
  const oos = scoreTrades(filterTrades(fullTrades, split.oos), capital, split.oos);
  const full = scoreTrades(fullTrades, capital, days);
  return {
    candidate,
    trades: fullTrades,
    summary: fullOut.summary,
    crosses: fullOut.crosses,
    full,
    train,
    validation,
    oos,
  };
}

function dailyWinners(rows, days, recommendedId) {
  return (days || []).map((day) => {
    const scored = rows.map((row) => {
      const dayTrades = (row.trades || []).filter((t) => t.day === day);
      const net = dayTrades.reduce((s, t) => s + t.netRs, 0);
      return { row, dayTrades, net };
    });
    scored.sort((a, b) => b.net - a.net);
    const best = scored[0];
    const runner = scored[1];
    const rec = scored.find((s) => s.row.candidate.id === recommendedId);
    return {
      day,
      bestId: best && best.dayTrades.length ? best.row.candidate.id : null,
      bestName: best && best.dayTrades.length ? best.row.candidate.name : 'No trade',
      netPnl: best ? Math.round(best.net * 100) / 100 : 0,
      trades: best ? best.dayTrades.length : 0,
      stocks: best ? [...new Set(best.dayTrades.map((t) => t.symbol))] : [],
      entries: best ? best.dayTrades.map((t) => ({ symbol: t.symbol, side: t.side, in: t.entryT, out: t.exitT, qty: t.qty, netRs: t.netRs })) : [],
      runnerUpId: runner && runner.dayTrades.length ? runner.row.candidate.id : null,
      runnerUpNet: runner ? Math.round(runner.net * 100) / 100 : 0,
      gap: best && runner ? Math.round((best.net - runner.net) * 100) / 100 : 0,
      prospectiveId: recommendedId || null,
      prospectiveNet: rec ? Math.round(rec.net * 100) / 100 : null,
      selection: 'retrospective',
      note: 'Best configuration for this day is chosen after seeing the day’s simulated P/L. It was not knowable before the open.',
    };
  });
}

function weeklyWinners(rows, days, recommendedId) {
  const { isoWeek } = require('./metrics');
  const weeks = {};
  for (const day of days || []) {
    const w = isoWeek(day);
    (weeks[w] ||= { week: w, days: [] }).days.push(day);
  }
  return Object.keys(weeks)
    .sort()
    .map((week) => {
      const wdays = weeks[week].days;
      const scored = rows.map((row) => {
        const wtrades = (row.trades || []).filter((t) => wdays.includes(t.day));
        const net = wtrades.reduce((s, t) => s + t.netRs, 0);
        const byDay = {};
        for (const t of wtrades) {
          byDay[t.day] ||= 0;
          byDay[t.day] += t.netRs;
        }
        const dayNets = Object.values(byDay);
        return {
          row,
          net,
          trades: wtrades.length,
          winDays: dayNets.filter((n) => n > 0).length,
          loseDays: dayNets.filter((n) => n < 0).length,
          noTradeDays: wdays.length - Object.keys(byDay).length,
          bestDay: Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null,
          worstDay: Object.entries(byDay).sort((a, b) => a[1] - b[1])[0] || null,
          stocks: Object.values(
            wtrades.reduce((m, t) => {
              (m[t.symbol] ||= { symbol: t.symbol, netRs: 0 });
              m[t.symbol].netRs += t.netRs;
              return m;
            }, {}),
          ).sort((a, b) => b.netRs - a.netRs),
        };
      });
      scored.sort((a, b) => b.net - a.net);
      const best = scored[0];
      const runner = scored[1];
      const perCandidate = scored.map((s) => ({
        id: s.row.candidate.id,
        name: s.row.candidate.name,
        netPnl: Math.round(s.net * 100) / 100,
        trades: s.trades,
        isBaseline: !!s.row.candidate.isBaseline,
      }));
      return {
        week,
        days: wdays,
        bestId: best ? best.row.candidate.id : null,
        bestName: best ? best.row.candidate.name : null,
        netPnl: best ? Math.round(best.net * 100) / 100 : 0,
        trades: best ? best.trades : 0,
        winDays: best ? best.winDays : 0,
        loseDays: best ? best.loseDays : 0,
        noTradeDays: best ? best.noTradeDays : wdays.length,
        bestDay: best && best.bestDay ? { day: best.bestDay[0], netRs: Math.round(best.bestDay[1] * 100) / 100 } : null,
        worstDay: best && best.worstDay ? { day: best.worstDay[0], netRs: Math.round(best.worstDay[1] * 100) / 100 } : null,
        stocks: best ? best.stocks.slice(0, 8) : [],
        runnerUpId: runner ? runner.row.candidate.id : null,
        gap: best && runner ? Math.round((best.net - runner.net) * 100) / 100 : 0,
        recommendedId,
        selection: 'retrospective',
        note: 'Weekly winner is chosen after seeing the week. A different name can win each week than the single best candidate for the full range.',
        perCandidate,
      };
    });
}

function cutoffLab(rows) {
  const axes = [
    { key: 'entryEnd', label: 'Entry cutoff' },
    { key: 'timeExit', label: 'Exit time' },
    { key: 'targetR', label: 'Target R' },
    { key: 'maxStocksPerDay', label: 'Max stocks / day' },
    { key: 'sizing', label: 'Sizing' },
    { key: 'pullbacksNeeded', label: 'Reverse candles' },
  ];
  return axes.map((axis) => ({
    axis: axis.key,
    label: axis.label,
    points: rows
      .filter((r) => r.candidate.family === 'baseline' || r.candidate.family === axis.key.replace('End', '_cutoff').replace('timeExit', 'exit_time') || r.candidate[axis.key] != null)
      .map((r) => ({
        id: r.candidate.id,
        value: r.candidate[axis.key],
        netPnl: r.full.netPnl,
        maxDrawdown: r.full.maxDrawdown,
        trades: r.full.trades,
        profitableWeekPct: r.full.profitableWeekPct,
        isBaseline: !!r.candidate.isBaseline,
      })),
  }));
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function capitalSensitivity(symbolBars, candidate, capitals, onProgress) {
  const out = [];
  const list = capitals || [20000, 40000, 80000, 160000];
  for (let i = 0; i < list.length; i += 1) {
    const capital = list[i];
    if (onProgress) onProgress({ phase: 'sensitivity', done: i, total: list.length + 3, symbol: `capital-${capital}` });
    const sim = simulateCandidate(symbolBars, { ...candidate, capital }, capital);
    const m = scoreTrades(sim.trades, capital, allDays(symbolBars));
    out.push({
      capital,
      netPnl: m.netPnl,
      returnPct: m.returnPct,
      maxDrawdown: m.maxDrawdown,
      trades: m.trades,
      capitalUtilized: m.capitalUtilized,
    });
    await yieldEventLoop();
  }
  return out;
}

async function costSensitivity(symbolBars, candidate, capital, onProgress) {
  const slips = [0, 0.0005, 0.001];
  const out = [];
  for (let i = 0; i < slips.length; i += 1) {
    const slippage = slips[i];
    if (onProgress) onProgress({ phase: 'sensitivity', done: i + 4, total: 7, symbol: `slip-${slippage}` });
    const sim = simulateCandidate(symbolBars, { ...candidate, slippage }, capital);
    const m = scoreTrades(sim.trades, capital, allDays(symbolBars));
    out.push({ slippage, netPnl: m.netPnl, trades: m.trades, maxDrawdown: m.maxDrawdown });
    await yieldEventLoop();
  }
  return out;
}

async function runDiscovery({ symbolBars, capital = 40000, budget = 24, coverage = null, onProgress = null }) {
  const days = allDays(symbolBars);
  const split = splitDays(days);
  const candidates = generateCandidates({ capital, budget });
  const rows = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    if (onProgress) onProgress({ phase: 'simulate', done: i, total: candidates.length, symbol: c.id });
    rows.push(packRow(c, simulateCandidate(symbolBars, c, capital), days, capital, split));
    await yieldEventLoop();
  }

  const folds = walkForwardFolds(days);
  if (folds.length) {
    for (const row of rows) {
      const wfTrades = [];
      for (const fold of folds) {
        const foldTrades = filterTrades(row.trades, fold.test);
        wfTrades.push(...foldTrades);
      }
      row.walkForward = scoreTrades(wfTrades, capital, folds.flatMap((f) => f.test));
    }
  }

  const ranking = rankCandidates(rows, split);
  const recId = ranking.recommended ? ranking.recommended.id : BASELINE_ID;
  const recRow = rows.find((r) => r.candidate.id === recId) || rows.find((r) => r.candidate.isBaseline) || rows[0];

  const capitals = [Math.round(capital / 2), capital, capital * 2, capital * 4].filter((n) => n >= 1000 && n <= 10_000_000);

  const slimBoard = ranking.leaderboard.map((r) => {
    const row = rows.find((x) => x.candidate.id === r.id);
    return {
      ...r,
      entryRule: row.candidate.rules.entry,
      cutoff: row.candidate.rules.cutoff,
      exitRule: row.candidate.rules.exit,
      stopLoss: row.candidate.rules.stopLoss,
      target: row.candidate.rules.target,
      stockCount: row.candidate.maxStocksPerDay,
      sizing: row.candidate.sizing,
    };
  });

  return {
    simulated: true,
    liveOrders: false,
    engineVersion: ENGINE_VERSION,
    capital,
    days,
    split,
    coverage,
    candidatesEvaluated: candidates.length,
    minTrades: ranking.minTrades,
    noRobust: ranking.noRobust,
    recommended: ranking.recommended
      ? {
          ...ranking.recommended,
          trades: recRow.trades,
          stocks: recRow.full.stocks,
          equityCurve: recRow.full.equityCurve,
          summary: recRow.summary,
        }
      : null,
    rankings: ranking.rankings,
    leaderboard: slimBoard,
    dailyWinners: dailyWinners(rows, days, ranking.recommended && ranking.recommended.id),
    weeklyWinners: weeklyWinners(rows, days, ranking.recommended && ranking.recommended.id),
    cutoffLab: cutoffLab(rows),
    capitalSensitivity: recRow ? await capitalSensitivity(symbolBars, recRow.candidate, capitals, onProgress) : [],
    costSensitivity: recRow ? await costSensitivity(symbolBars, recRow.candidate, capital, onProgress) : [],
    baseline: {
      id: BASELINE_ID,
      metrics: (rows.find((r) => r.candidate.isBaseline) || rows[0]).full,
    },
    walkForwardFolds: folds.length,
    candidateTrades: Object.fromEntries(rows.map((r) => [r.candidate.id, r.trades])),
    assumptions: [
      'Simulated MIS research. No live orders are placed.',
      'The original first-15 two-low SL/EOD book is always included as the baseline and is never silently rewritten.',
      'Experimental filters (OR width, breakout distance, trailing stop, OR-width ranking) are separate candidates.',
      'Stock selection uses only information available at entry time (clock time or 09:30 opening-range width). Same-day P/L is never used to pick names.',
      'Daily and weekly winners are retrospective unless the recommended candidate’s that-day result is shown as prospective.',
      'History is never invented. Missing Nifty 500 names are listed in coverage.',
    ],
  };
}

module.exports = { runDiscovery, simulateCandidate, dailyWinners, weeklyWinners };
