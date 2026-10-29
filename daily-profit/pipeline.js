'use strict';

const { scoreTrades, minTradesRequired } = require('../orb-backtest/discover/metrics');
const { allDays, splitDays, walkForwardFolds, filterTrades } = require('../orb-backtest/discover/split');
const { generateCandidates } = require('./candidates');
const { simulateDesk, dailyBooks } = require('./portfolio');
const { ENGINE_VERSION } = require('./simulate');

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function worstDayNet(byDay) {
  const vals = Object.values(byDay || {});
  if (!vals.length) return 0;
  return Math.min(...vals);
}

function avgDaily(net, sessionDays) {
  return sessionDays ? net / sessionDays : 0;
}

function enrich(m, capital) {
  const worst = worstDayNet(m.byDay);
  const wins = Object.values(m.byDay || {}).filter((n) => n > 0).reduce((s, n) => s + n, 0);
  const loseDays = Object.values(m.byDay || {}).filter((n) => n < 0);
  const avgLoseDay = loseDays.length ? loseDays.reduce((s, n) => s + n, 0) / loseDays.length : 0;
  return {
    ...m,
    avgDailyReturn: avgDaily(m.netPnl, m.sessionDays),
    worstDay: Math.round(worst * 100) / 100,
    losingDaySeverity: Math.round(avgLoseDay * 100) / 100,
    wipeout: wins > 0 && Math.abs(worst) >= wins * 0.8,
    ddPct: capital > 0 ? m.maxDrawdown / capital : 0,
  };
}

function rankRows(rows, split, capital) {
  const sessionDays = (split.oos && split.oos.length) || (split.train && split.train.length) || 0;
  const minTrades = minTradesRequired(sessionDays);
  const scored = rows.map((row) => ({
    ...row,
    oos: enrich(row.oos, capital),
    val: enrich(row.validation, capital),
    train: enrich(row.train, capital),
    full: enrich(row.full, capital),
  }));

  const evidence = scored.filter((r) => r.oos.trades >= Math.max(3, Math.floor(minTrades / 2)) || r.full.trades >= minTrades);
  const pool = evidence.length ? evidence : scored;

  const robustPool = pool.filter((r) => {
    const m = r.oos.sessionDays ? r.oos : r.full;
    if (!(m.netPnl > 0) || m.profitFactor < 1) return false;
    if (m.ddPct > 0.25) return false;
    if (m.wipeout) return false;
    if (m.sessionDays >= 5 && m.profitableDayPct < 0.35) return false;
    return true;
  });

  const balanced = [...robustPool].sort((a, b) => {
    const score = (r) => {
      const m = r.oos.sessionDays ? r.oos : r.full;
      return (
        (m.netPnl > 0 ? 4 : 0) +
        (m.profitFactor >= 1.2 ? 2 : m.profitFactor >= 1 ? 1 : 0) +
        m.profitableDayPct * 3 +
        m.profitableWeekPct * 2 +
        Math.min(2, m.netPnl / Math.max(1, m.maxDrawdown)) -
        (m.wipeout ? 3 : 0) -
        Math.min(2, Math.abs(m.worstDay) / Math.max(1, capital * 0.05))
      );
    };
    return score(b) - score(a) || b.oos.netPnl - a.oos.netPnl;
  });

  const byNet = [...pool].sort((a, b) => b.oos.netPnl - a.oos.netPnl);
  const byDay = [...pool].sort((a, b) => b.oos.profitableDayPct - a.oos.profitableDayPct || b.oos.netPnl - a.oos.netPnl);
  const byRisk = [...robustPool].sort((a, b) => {
    const ar = a.oos.netPnl / Math.max(1, a.oos.maxDrawdown);
    const br = b.oos.netPnl / Math.max(1, b.oos.maxDrawdown);
    return br - ar;
  });

  const rec = split.mode !== 'in_sample' && balanced[0] ? balanced[0] : null;

  const leaderboard = byNet.map((r, i) => ({
    rank: i + 1,
    id: r.candidate.id,
    name: r.candidate.name,
    family: r.candidate.family,
    isBaseline: !!r.candidate.isBaseline,
    rules: r.candidate.rules,
    config: {
      family: r.candidate.family,
      maxStocksPerDay: r.candidate.maxStocksPerDay,
      rankBy: r.candidate.rankBy,
      crowdFilter: r.candidate.crowdFilter,
      sizing: r.candidate.sizing,
      entryEnd: r.candidate.entryEnd,
      timeExit: r.candidate.timeExit,
      targetR: r.candidate.targetR,
    },
    netPnl: r.oos.netPnl,
    returnPct: r.oos.returnPct,
    avgDailyReturn: r.oos.avgDailyReturn,
    maxDrawdown: r.oos.maxDrawdown,
    worstDay: r.oos.worstDay,
    profitableDayPct: r.oos.profitableDayPct,
    profitableWeekPct: r.oos.profitableWeekPct,
    profitFactor: r.oos.profitFactor,
    trades: r.oos.trades,
    capitalUtilized: r.oos.capitalUtilized,
    validationStatus:
      split.mode === 'in_sample' ? 'in_sample' : r.oos.sessionDays ? (r.oos.netPnl > 0 && r.oos.profitFactor >= 1 ? 'oos_positive' : 'oos_reported') : 'insufficient_oos',
    profitable: r.oos.netPnl > 0,
    wipeout: r.oos.wipeout,
    trainNet: r.train.netPnl,
    validationNet: r.val.netPnl,
    oosNet: r.oos.netPnl,
  }));

  return {
    minTrades,
    recommended: rec
      ? {
          id: rec.candidate.id,
          name: rec.candidate.name,
          family: rec.candidate.family,
          rules: rec.candidate.rules,
          config: rec.candidate,
          oos: rec.oos,
          validation: rec.val,
          train: rec.train,
          trades: rec.trades,
          stocks: rec.full.stocks,
          equityCurve: rec.full.equityCurve,
          why: [
            'Chosen on training days, compared on validation, reported on unseen out-of-sample days.',
            `Out-of-sample net ₹${rec.oos.netPnl} · profit factor ${rec.oos.profitFactor} · max drawdown ₹${rec.oos.maxDrawdown} · profitable days ${(rec.oos.profitableDayPct * 100).toFixed(0)}%.`,
            rec.oos.wipeout ? 'A single losing day erased most winning days — treated as fragile if it still passed other gates.' : 'No single losing day erased 80% of winning-day profits on the reported sample.',
            'Combined daily book P/L after estimated brokerage, STT, exchange, stamp and 0.05% slippage. Not a live-trading guarantee.',
          ],
          risks: [
            `${rows.length} methods were tested; some apparent edge can be selection luck.`,
            'Nifty 500 gaps are not filled with synthetic prices.',
            'Daily profit is not guaranteed. Past simulated P/L can fail out of sample.',
          ],
        }
      : null,
    noRobust: rec ? null : 'No sufficiently robust profitable method found on unseen data. Nothing is recommended.',
    rankings: {
      highestNet: byNet[0] ? byNet[0].candidate.id : null,
      mostGreenDays: byDay[0] ? byDay[0].candidate.id : null,
      bestRiskAdjusted: byRisk[0] ? byRisk[0].candidate.id : null,
      bestBalancedRobust: rec ? rec.candidate.id : null,
    },
    leaderboard,
  };
}

async function runDailyProfit({ symbolBars, capital = 10000, budget = 24, coverage = null, onProgress = null }) {
  const days = allDays(symbolBars);
  const split = splitDays(days);
  const candidates = generateCandidates({ capital, budget });
  const rows = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    if (onProgress) onProgress({ phase: 'simulate', done: i, total: candidates.length, symbol: c.id });
    const sim = await simulateDesk(symbolBars, c, c.capital || capital);
    const train = scoreTrades(filterTrades(sim.trades, split.train), capital, split.train);
    const validation = scoreTrades(filterTrades(sim.trades, split.validation), capital, split.validation);
    const oos = scoreTrades(filterTrades(sim.trades, split.oos), capital, split.oos);
    const full = scoreTrades(sim.trades, capital, days);
    rows.push({
      candidate: c,
      trades: sim.trades,
      signals: sim.signals,
      train,
      validation,
      oos,
      full,
    });
    await yieldEventLoop();
  }

  const folds = walkForwardFolds(days);
  for (const row of rows) {
    if (!folds.length) continue;
    const wf = [];
    for (const fold of folds) wf.push(...filterTrades(row.trades, fold.test));
    row.walkForward = scoreTrades(wf, capital, folds.flatMap((f) => f.test));
  }

  const ranking = rankRows(rows, split, capital);
  const recRow = ranking.recommended ? rows.find((r) => r.candidate.id === ranking.recommended.id) : null;
  const books = recRow ? dailyBooks(recRow.trades, recRow.signals, days, capital) : [];
  const lastBook = books.length ? books[books.length - 1] : null;

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
          dailyBooks: books,
          lastBook,
        }
      : null,
    lastBook,
    dailyBooks: books,
    rankings: ranking.rankings,
    leaderboard: ranking.leaderboard,
    weekly: weeklyFromBooks(books),
    walkForwardFolds: folds.length,
    candidateTrades: Object.fromEntries(rows.map((r) => [r.candidate.id, r.trades])),
    assumptions: [
      'Simulated MIS research across multiple entry families. No live orders are placed.',
      'Families include first-15 ORB, first-30 break, gap continue/fade, VWAP reclaim, prior-day break, morning thrust, open fade, EMA cross, and narrow-range break.',
      'Portfolio size is a searched variable (1 / 3 / 5 / 8). Quantity uses ~0.75% capital risk or equal notional, capped at 5× capital.',
      'Ranking uses out-of-sample combined book P/L, green-day rate, drawdown, and whether one loser wipes the winners — not win rate alone.',
      'If no method is profitable and stable on unseen days, the engine reports that honestly.',
      'History is never invented. Missing Nifty 500 names stay listed in coverage.',
    ],
    note: 'Daily profit is not guaranteed. This is a historical research recommendation only.',
  };
}

function weeklyFromBooks(books) {
  const { isoWeek } = require('../orb-backtest/discover/metrics');
  const weeks = {};
  for (const b of books || []) {
    const w = isoWeek(b.day);
    const row = (weeks[w] ||= { week: w, days: [], netPnl: 0, trades: 0, winDays: 0, loseDays: 0 });
    row.days.push(b.day);
    row.netPnl += b.netPnl;
    row.trades += b.trades;
    if (b.netPnl > 0) row.winDays += 1;
    if (b.netPnl < 0) row.loseDays += 1;
  }
  return Object.values(weeks)
    .map((w) => ({ ...w, netPnl: Math.round(w.netPnl * 100) / 100 }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

module.exports = { runDailyProfit, rankRows, enrich };
