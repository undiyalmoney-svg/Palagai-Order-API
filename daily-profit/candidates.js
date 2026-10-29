'use strict';

const { pdhFollowCandidate } = require('../orb-backtest/pdh-desk');

function describe(c) {
  return c.rules || {
    entry: c.entry,
    cutoff: `No new entries after ${c.entryEnd || '14:30'} IST`,
    exit: c.targetR
      ? `Stop plus ${c.targetR}R target; leftover at ${c.timeExit}.`
      : `Stop or ${c.timeExit || '15:15'} time exit. No automatic target.`,
    stopLoss: c.stopLoss,
    target: c.targetR ? `${c.targetR}R` : 'None',
    stockCount: `${c.maxStocksPerDay} name${c.maxStocksPerDay === 1 ? '' : 's'} / day`,
    sizing:
      c.sizing === 'equal'
        ? `Equal notional ≈ capital / ${c.maxStocksPerDay}`
        : 'Risk ~0.75% of capital per signal-candle range, 5× notional cap',
    filters: ['Only the 09:45 majority side.'],
  };
}

function generateCandidates({ capital = 10000 } = {}) {
  const row = pdhFollowCandidate(capital);
  return [{ ...row, isBaseline: true, rules: describe(row) }];
}

module.exports = { generateCandidates, describe };
