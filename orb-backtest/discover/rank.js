'use strict';

const { minTradesRequired } = require('./metrics');

function periodMetrics(row, prefer) {
  if (prefer === 'oos' && row.oos && row.oos.sessionDays) return row.oos;
  if (prefer === 'validation' && row.validation && row.validation.sessionDays) return row.validation;
  if (row.oos && row.oos.sessionDays) return row.oos;
  if (row.validation && row.validation.sessionDays) return row.validation;
  return row.full;
}

function evidenceOk(m, minTrades) {
  return m && m.trades >= minTrades;
}

function neverProfitableLabel(m) {
  return !(m && m.netPnl > 0);
}

function rankCandidates(rows, split) {
  const sessionDays = (split.oos && split.oos.length) || (split.train && split.train.length) || 0;
  const minTrades = minTradesRequired(sessionDays);
  const scored = rows.map((row) => {
    const oos = periodMetrics(row, 'oos');
    const val = periodMetrics(row, 'validation');
    const train = row.train || row.full;
    return { ...row, oos, val, train, selectOn: split.mode };
  });

  const withEvidence = scored.filter((r) => evidenceOk(r.oos, minTrades) || evidenceOk(r.full, minTrades));
  const pool = withEvidence.length ? withEvidence : scored;

  const byNet = [...pool].sort((a, b) => b.oos.netPnl - a.oos.netPnl || b.oos.profitFactor - a.oos.profitFactor);
  const positive = pool.filter((r) => r.oos.netPnl > 0 && evidenceOk(r.oos, Math.max(3, Math.floor(minTrades / 2))));
  const byDd = [...positive].sort((a, b) => a.oos.maxDrawdown - b.oos.maxDrawdown || b.oos.netPnl - a.oos.netPnl);
  const byRisk = [...positive].sort((a, b) => {
    const ar = a.oos.netPnl / Math.max(1, a.oos.maxDrawdown);
    const br = b.oos.netPnl / Math.max(1, b.oos.maxDrawdown);
    return br - ar || b.oos.netPnl - a.oos.netPnl;
  });
  const byWeek = [...pool].sort((a, b) => b.oos.profitableWeekPct - a.oos.profitableWeekPct || b.oos.netPnl - a.oos.netPnl);

  const balanced = [...positive].sort((a, b) => {
    const as =
      (a.oos.netPnl > 0 ? 1 : 0) * 4 +
      (a.oos.profitFactor >= 1.2 ? 2 : a.oos.profitFactor >= 1 ? 1 : 0) +
      a.oos.profitableWeekPct * 3 +
      (a.oos.returnPct > 0 ? 1 : 0) -
      Math.min(2, a.oos.maxDrawdown / Math.max(1, a.oos.netPnl || 1));
    const bs =
      (b.oos.netPnl > 0 ? 1 : 0) * 4 +
      (b.oos.profitFactor >= 1.2 ? 2 : b.oos.profitFactor >= 1 ? 1 : 0) +
      b.oos.profitableWeekPct * 3 +
      (b.oos.returnPct > 0 ? 1 : 0) -
      Math.min(2, b.oos.maxDrawdown / Math.max(1, b.oos.netPnl || 1));
    return bs - as || b.oos.netPnl - a.oos.netPnl;
  });

  const robust =
    split.mode !== 'in_sample' && balanced[0] && balanced[0].oos.netPnl > 0 && balanced[0].oos.profitFactor >= 1
      ? balanced[0]
      : null;

  const leaderboard = byNet.map((r, i) => ({
    rank: i + 1,
    id: r.candidate.id,
    name: r.candidate.name,
    family: r.candidate.family,
    isBaseline: !!r.candidate.isBaseline,
    experimental: !!r.candidate.experimental,
    rules: r.candidate.rules,
    config: r.candidate,
    netPnl: r.oos.netPnl,
    returnPct: r.oos.returnPct,
    maxDrawdown: r.oos.maxDrawdown,
    profitFactor: r.oos.profitFactor,
    expectancy: r.oos.expectancy,
    trades: r.oos.trades,
    weeks: r.oos.weeks,
    profitableWeekPct: r.oos.profitableWeekPct,
    profitableDayPct: r.oos.profitableDayPct,
    capitalUtilized: r.oos.capitalUtilized,
    stockConcentration: r.oos.stockConcentration,
    validationStatus:
      split.mode === 'in_sample'
        ? 'in_sample'
        : r.oos.sessionDays
          ? r.oos.netPnl > 0 && r.oos.profitFactor >= 1
            ? 'oos_positive'
            : 'oos_reported'
          : 'insufficient_oos',
    profitable: r.oos.netPnl > 0,
    trainNet: r.train.netPnl,
    validationNet: r.val.netPnl,
    oosNet: r.oos.netPnl,
    walkForwardNet: r.walkForward ? r.walkForward.netPnl : null,
    fragile: r.train.netPnl > 0 && r.oos.netPnl <= 0,
  }));

  return {
    minTrades,
    candidatesEvaluated: rows.length,
    splitMode: split.mode,
    splitNote: split.note,
    rankings: {
      highestNet: byNet[0] ? byNet[0].candidate.id : null,
      lowestDrawdownPositive: byDd[0] ? byDd[0].candidate.id : null,
      bestRiskAdjusted: byRisk[0] ? byRisk[0].candidate.id : null,
      mostConsistentWeeks: byWeek[0] ? byWeek[0].candidate.id : null,
      bestBalancedRobust: robust ? robust.candidate.id : null,
    },
    recommended: robust
      ? {
          id: robust.candidate.id,
          name: robust.candidate.name,
          rules: robust.candidate.rules,
          config: robust.candidate,
          oos: robust.oos,
          validation: robust.val,
          train: robust.train,
          why: [
            `Chosen on training days, compared on validation, reported on out-of-sample (${split.mode}).`,
            `Out-of-sample net ${robust.oos.netPnl} with profit factor ${robust.oos.profitFactor} and max drawdown ${robust.oos.maxDrawdown}.`,
            robust.candidate.isBaseline
              ? 'The original first-15 two-low book is the recommended candidate in this search.'
              : 'This is an experimental or OFAT variation — not silently applied to the original book.',
            robust.fragile ? 'Train was profitable and out-of-sample was not — treat as fragile.' : 'Train and out-of-sample agree on sign or sample is in-sample only.',
          ],
          risks: [
            `${rows.length} configurations were tested; some apparent edge can be selection luck.`,
            'Nifty 500 coverage gaps are not filled with synthetic prices.',
            'Same-bar stop vs target uses stop first when both could trade.',
            neverProfitableLabel(robust.oos) ? 'This candidate is not profitable out of sample.' : 'Past simulated P/L is not a live-trading guarantee.',
          ],
        }
      : null,
    noRobust:
      !robust
        ? 'No sufficiently robust profitable strategy found in this search.'
        : null,
    leaderboard,
  };
}

module.exports = { rankCandidates, periodMetrics };
