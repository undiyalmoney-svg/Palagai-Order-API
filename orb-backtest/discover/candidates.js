'use strict';

const BASELINE_ID = 'baseline-first15-twored-sl-eod-ms3-risk';

function baseline(capital = 40000) {
  return {
    id: BASELINE_ID,
    family: 'baseline',
    isBaseline: true,
    experimental: false,
    name: 'Original first-15 two-low SL/EOD',
    capital,
    pullbacksNeeded: 2,
    entryEnd: '14:30',
    timeExit: '15:15',
    targetR: null,
    trailAfterR: null,
    orMinPct: null,
    orMaxPct: null,
    minBreakPct: null,
    maxStocksPerDay: 3,
    sizing: 'risk',
    rankBy: 'time',
    crowdFilter: null,
    slippage: 0.0005,
  };
}

function describe(c) {
  const pull =
    c.pullbacksNeeded === 2
      ? 'two reverse 5-minute candles'
      : `${c.pullbacksNeeded} reverse 5-minute candles`;
  const entry =
    `Mark 09:15–09:30 high/low. A later 15-minute candle must fully close beyond that range. ` +
    `Then wait for ${pull}. Uptrend: next green candle high is entry, low is SL. ` +
    `Downtrend: next red candle low is entry, high is SL. Last new entry ${c.entryEnd} IST.`;
  const filters = [];
  if (c.orMinPct != null || c.orMaxPct != null) {
    filters.push(
      `opening-range width ${c.orMinPct != null ? (c.orMinPct * 100).toFixed(2) : '0'}%–${
        c.orMaxPct != null ? (c.orMaxPct * 100).toFixed(2) : '∞'
      }% of price`,
    );
  }
  if (c.minBreakPct != null) filters.push(`15-minute close at least ${(c.minBreakPct * 100).toFixed(3)}% beyond the range`);
  if (c.crowdFilter === 'skipShort') {
    filters.push('skip the day when 09:45 Nifty 500 breakout closes are ≤40% long (short-crowd)');
  } else if (c.crowdFilter === 'skipLong') {
    filters.push('skip the day when 09:45 Nifty 500 breakout closes are ≥60% long');
  } else if (c.crowdFilter === 'follow') {
    filters.push('only take the 09:45 majority side (≥60% long or ≤40% long); mixed days allow either');
  }
  const exitParts = ['Stop is the signal-candle low (long) or high (short); SL closes the whole trade'];
  if (c.targetR) exitParts.push(`fixed target ${c.targetR}R of the signal-candle range`);
  if (c.trailAfterR) exitParts.push(`experimental: after ${c.trailAfterR}R, trail stop to entry`);
  exitParts.push(`leftover positions exit at ${c.timeExit} IST${c.timeExit === '15:15' ? ' (EOD)' : ''}`);
  if (c.targetR) {
    exitParts.push('If stop and target could both trade in the same 5-minute bar, stop is filled first (conservative)');
  }
  return {
    entry,
    cutoff: `No new entries after ${c.entryEnd} IST`,
    exit: exitParts.join('. ') + '.',
    stopLoss: 'Signal-candle low (long) or high (short)',
    target: c.targetR ? `${c.targetR}R of signal-candle range` : 'None — decide from 30-minute marks / EOD',
    stockCount: `${c.maxStocksPerDay} names / day, first eligible by ${
      c.rankBy === 'orWidth'
        ? 'opening-range width at 09:30'
        : c.rankBy === 'stopPct'
          ? 'widest signal-candle stop as % of price'
          : 'entry time'
    }`,
    sizing:
      c.sizing === 'equal'
        ? `Equal notional ≈ capital / ${c.maxStocksPerDay} per name, 5× capital cap`
        : 'Risk-based: ~0.75% of capital per signal-candle range, 5× capital cap',
    filters: filters.length ? filters : ['None beyond the original first-15 two-low rule'],
  };
}

function candidateId(parts) {
  return parts.filter(Boolean).join('-');
}

function withId(row) {
  return { ...row, rules: describe(row) };
}

function generateCandidates({ capital = 40000, budget = 24 } = {}) {
  const cap = Number(capital) || 40000;
  const max = Math.max(8, Math.min(40, Math.floor(Number(budget) || 24)));
  const base = baseline(cap);
  const extras = [
    { family: 'entry_cutoff', entryEnd: '11:00', name: 'Last entry 11:00' },
    { family: 'entry_cutoff', entryEnd: '12:30', name: 'Last entry 12:30' },
    { family: 'exit_time', timeExit: '14:50', name: 'Time exit 14:50' },
    { family: 'exit_time', timeExit: '15:00', name: 'Time exit 15:00' },
    { family: 'target', targetR: 1, name: 'Fixed target 1R' },
    { family: 'target', targetR: 2, name: 'Fixed target 2R' },
    { family: 'stock_count', maxStocksPerDay: 1, name: 'Max 1 stock / day' },
    { family: 'stock_count', maxStocksPerDay: 5, name: 'Max 5 stocks / day' },
    { family: 'stock_count', maxStocksPerDay: 10, name: 'Max 10 stocks / day' },
    { family: 'sizing', sizing: 'equal', name: 'Equal notional sizing' },
    { family: 'entry_pattern', pullbacksNeeded: 1, name: 'One reverse candle then signal' },
    { family: 'entry_pattern', pullbacksNeeded: 3, name: 'Three reverse candles then signal' },
    {
      family: 'entry_quality',
      orMinPct: 0.002,
      orMaxPct: 0.03,
      experimental: true,
      name: 'Experimental OR-width 0.20%–3.00%',
    },
    {
      family: 'entry_quality',
      minBreakPct: 0.0004,
      experimental: true,
      name: 'Experimental 0.04% close-beyond-range',
    },
    {
      family: 'trailing',
      trailAfterR: 1,
      experimental: true,
      name: 'Experimental trail to entry after 1R',
    },
    {
      family: 'selection',
      rankBy: 'orWidth',
      experimental: true,
      name: 'Experimental pick widest OR first',
    },
    {
      family: 'selection',
      rankBy: 'stopPct',
      crowdFilter: 'skipShort',
      maxStocksPerDay: 5,
      experimental: true,
      name: 'Skip short-crowd 09:45, 5 widest stops (10k desk)',
    },
    {
      family: 'combo',
      rankBy: 'stopPct',
      crowdFilter: 'follow',
      orMinPct: 0.008,
      orMaxPct: 0.025,
      maxStocksPerDay: 5,
      experimental: true,
      name: 'Follow 09:45 + OR 0.80–2.50% + 5 widest stops',
    },
    {
      family: 'combo',
      entryEnd: '12:30',
      targetR: 2,
      maxStocksPerDay: 5,
      name: '12:30 cutoff + 2R + 5 stocks',
    },
    {
      family: 'combo',
      entryEnd: '12:30',
      maxStocksPerDay: 5,
      name: '12:30 cutoff + 5 stocks, no target',
    },
    {
      family: 'combo',
      targetR: 2,
      maxStocksPerDay: 1,
      name: '2R target + 1 stock',
    },
    {
      family: 'combo',
      trailAfterR: 1,
      timeExit: '15:15',
      experimental: true,
      name: 'Trail after 1R + EOD',
    },
  ];
  const out = [
    withId(base),
    ...extras.map((e) => {
      const row = { ...base, ...e, isBaseline: false, experimental: !!e.experimental, capital: cap };
      row.id = candidateId([
        e.family,
        e.entryEnd && `cut${e.entryEnd.replace(':', '')}`,
        e.timeExit && `xit${e.timeExit.replace(':', '')}`,
        e.targetR && `tgt${e.targetR}`,
        e.maxStocksPerDay && e.maxStocksPerDay !== 3 ? `ms${e.maxStocksPerDay}` : '',
        e.sizing === 'equal' ? 'eq' : '',
        e.pullbacksNeeded && e.pullbacksNeeded !== 2 ? `pb${e.pullbacksNeeded}` : '',
        e.orMinPct != null ? 'orw' : '',
        e.minBreakPct != null ? 'brk' : '',
        e.trailAfterR ? `tr${e.trailAfterR}` : '',
        e.rankBy === 'orWidth' ? 'orwrank' : '',
        e.rankBy === 'stopPct' ? 'stprank' : '',
        e.crowdFilter === 'skipShort' ? 'skipS' : e.crowdFilter === 'follow' ? 'cfollow' : e.crowdFilter === 'skipLong' ? 'skipL' : '',
      ]);
      return withId(row);
    }),
  ];
  const seen = new Set();
  return out.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  }).slice(0, max);
}

function toEngineConfig(candidate, capital) {
  return {
    capital: Number(capital) || candidate.capital || 40000,
    maxStocksPerDay: candidate.maxStocksPerDay,
    pullbacksNeeded: candidate.pullbacksNeeded,
    entryEnd: candidate.entryEnd,
    timeExit: candidate.timeExit,
    targetR: candidate.targetR,
    trailAfterR: candidate.trailAfterR,
    orMinPct: candidate.orMinPct,
    orMaxPct: candidate.orMaxPct,
    minBreakPct: candidate.minBreakPct,
    sizing: candidate.sizing,
    rankBy: candidate.rankBy,
    crowdFilter: candidate.crowdFilter || null,
    slippage: candidate.slippage,
  };
}

module.exports = {
  BASELINE_ID,
  baseline,
  describe,
  generateCandidates,
  toEngineConfig,
};
