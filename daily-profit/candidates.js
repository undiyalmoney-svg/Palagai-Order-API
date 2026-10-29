'use strict';

function describe(c) {
  const names = `${c.maxStocksPerDay} name${c.maxStocksPerDay === 1 ? '' : 's'} / day`;
  const rank =
    c.rankBy === 'time'
      ? 'first eligible by time'
      : c.rankBy === 'orWidth' || c.rankBy === 'rangePct'
        ? 'widest opening range'
        : c.rankBy === 'move'
          ? 'largest qualifying move'
          : 'widest signal stop %';
  const crowd =
    c.crowdFilter === 'skipShort'
      ? 'Skip 09:45 short-crowd days.'
      : c.crowdFilter === 'follow'
        ? 'Only the 09:45 majority side.'
        : 'No 09:45 crowd filter.';
  const exit = c.targetR
    ? `Stop plus ${c.targetR}R target; leftover at ${c.timeExit}.`
    : `Stop or ${c.timeExit} time exit. No automatic target.`;
  return {
    entry: c.entry,
    cutoff: `No new entries after ${c.entryEnd} IST`,
    exit,
    stopLoss: c.stopLoss,
    target: c.targetR ? `${c.targetR}R` : 'None',
    stockCount: `${names}, ranked by ${rank}`,
    sizing: c.sizing === 'equal' ? `Equal notional ≈ capital / ${c.maxStocksPerDay}` : 'Risk ~0.75% of capital per signal-candle range, 5× notional cap',
    filters: [crowd],
  };
}

function withId(row) {
  const id = [
    row.family,
    row.entryEnd.replace(':', ''),
    row.timeExit.replace(':', ''),
    row.targetR ? `t${row.targetR}` : 'eod',
    `n${row.maxStocksPerDay}`,
    row.rankBy || 'stop',
    row.crowdFilter || 'any',
    row.sizing || 'risk',
  ].join('-');
  return { ...row, id, rules: describe(row) };
}

function generateCandidates({ capital = 10000, budget = 24 } = {}) {
  const max = Math.max(10, Math.min(40, Math.floor(Number(budget) || 24)));
  const base = {
    capital,
    entryEnd: '14:30',
    timeExit: '15:15',
    targetR: null,
    sizing: 'risk',
    rankBy: 'stopPct',
    crowdFilter: null,
    pullbacksNeeded: 2,
    experimental: false,
  };
  const raw = [
    {
      ...base,
      family: 'orb_winner',
      isBaseline: true,
      name: 'First-15 two-low skip-short 5 widest (₹10k book)',
      maxStocksPerDay: 5,
      crowdFilter: 'skipShort',
      entry: 'Mark 09:15–09:30. Later 15-minute must fully close beyond. Two reverse 5-minute candles, then the signal candle.',
      stopLoss: 'Signal-candle low (long) or high (short)',
    },
    {
      ...base,
      family: 'orb_original',
      name: 'First-15 two-low, 3 names by time',
      maxStocksPerDay: 3,
      rankBy: 'time',
      capital: Math.max(capital, 40000),
      entry: 'Original first-15 two-low book. First three eligible names by fill time.',
      stopLoss: 'Signal-candle low or high',
    },
    {
      ...base,
      family: 'or30_break',
      name: 'First-30 range break, 5 widest stops',
      maxStocksPerDay: 5,
      entry: 'Mark 09:15–09:45 high/low. A later 5-minute bar must fully close beyond that range. Buy/sell stop on the close bar.',
      stopLoss: 'Opposite side of the first-30 range',
    },
    {
      ...base,
      family: 'or30_break',
      name: 'First-30 range break, 3 names, 1R',
      maxStocksPerDay: 3,
      targetR: 1,
      entry: 'First-30 range break with a 1R target.',
      stopLoss: 'Opposite side of the first-30 range',
    },
    {
      ...base,
      family: 'or30_break',
      name: 'First-30 range break, 1 name',
      maxStocksPerDay: 1,
      entry: 'First-30 range break, single name with the widest stop.',
      stopLoss: 'Opposite side of the first-30 range',
    },
    {
      ...base,
      family: 'gap_continue',
      name: 'Gap continue after first 15',
      maxStocksPerDay: 5,
      minGap: 0.004,
      rankBy: 'move',
      entry: 'Gap vs prior close ≥0.40%. First 15-minute candle must continue the gap. Enter the first-15 extreme.',
      stopLoss: 'Opposite extreme of the first 15',
    },
    {
      ...base,
      family: 'gap_fade',
      name: 'Gap fade after first 15 fails',
      maxStocksPerDay: 3,
      minGap: 0.008,
      rankBy: 'move',
      entry: 'Gap ≥0.80%. First 15 closes back through the open. Fade the gap.',
      stopLoss: 'Opposite extreme of the first 15',
    },
    {
      ...base,
      family: 'vwap_reclaim',
      name: 'Session VWAP reclaim after 10:00',
      maxStocksPerDay: 5,
      entryStart: '10:00',
      entry: 'After 10:00, first 5-minute close back across session VWAP in a reclaim / lose. Stop is VWAP or the signal extreme.',
      stopLoss: 'VWAP or signal-candle extreme, whichever is tighter',
    },
    {
      ...base,
      family: 'pdh_break',
      name: 'Prior-day high/low break',
      maxStocksPerDay: 5,
      entry: 'After 09:45, a 5-minute bar fully closes beyond the prior session high or low.',
      stopLoss: 'The prior-day level that was broken',
    },
    {
      ...base,
      family: 'morning_thrust',
      name: '09:15–10:00 thrust continuation',
      maxStocksPerDay: 5,
      minRet: 0.007,
      rankBy: 'move',
      entry: 'If the 09:15–10:00 move is at least 0.70%, continue that side at 10:00. Stop is the morning extreme.',
      stopLoss: 'High/low of 09:15–10:00',
    },
    {
      ...base,
      family: 'morning_thrust',
      name: 'Morning thrust, 3 names, 1.5R',
      maxStocksPerDay: 3,
      minRet: 0.007,
      targetR: 1.5,
      rankBy: 'move',
      entry: 'Morning thrust with a 1.5R target.',
      stopLoss: 'High/low of 09:15–10:00',
    },
    {
      ...base,
      family: 'open_fade',
      name: 'Wide first-15 fade toward the open',
      maxStocksPerDay: 3,
      minOrPct: 0.012,
      entry: 'First 15 range ≥1.20%. After two reverse 5-minute candles, fade toward the open.',
      stopLoss: 'Signal-candle extreme',
    },
    {
      ...base,
      family: 'ema_cross',
      name: 'EMA 9/21 cross after 10:00',
      maxStocksPerDay: 3,
      entryStart: '10:00',
      entry: 'First 5-minute EMA 9/21 cross after 10:00. Stop is the last three-bar extreme.',
      stopLoss: '3-bar swing opposite the cross',
    },
    {
      ...base,
      family: 'nr30_break',
      name: 'Narrow first-30 then break',
      maxStocksPerDay: 5,
      maxOrPct: 0.008,
      entry: 'First 30-minute range ≤0.80% of price, then a later 5-minute close beyond that range.',
      stopLoss: 'Opposite side of the first-30 range',
    },
    {
      ...base,
      family: 'or30_break',
      name: 'First-30 break, skip short-crowd',
      maxStocksPerDay: 5,
      crowdFilter: 'skipShort',
      entry: 'First-30 range break, sit out 09:45 short-crowd sessions.',
      stopLoss: 'Opposite side of the first-30 range',
    },
    {
      ...base,
      family: 'pdh_break',
      name: 'Prior-day break, follow 09:45 crowd',
      maxStocksPerDay: 5,
      crowdFilter: 'follow',
      entry: 'Prior-day high/low break, only the 09:45 majority side.',
      stopLoss: 'The prior-day level',
    },
    {
      ...base,
      family: 'vwap_reclaim',
      name: 'VWAP reclaim, time exit 14:50',
      maxStocksPerDay: 5,
      timeExit: '14:50',
      entry: 'VWAP reclaim, flatten leftover at 14:50.',
      stopLoss: 'VWAP or signal extreme',
    },
    {
      ...base,
      family: 'gap_continue',
      name: 'Gap continue, 1 name',
      maxStocksPerDay: 1,
      minGap: 0.005,
      rankBy: 'move',
      entry: 'Largest qualifying gap-continue name only.',
      stopLoss: 'Opposite extreme of the first 15',
    },
    {
      ...base,
      family: 'or30_break',
      name: 'First-30 break, equal notional, 5 names',
      maxStocksPerDay: 5,
      sizing: 'equal',
      entry: 'First-30 break sized as equal notional slices.',
      stopLoss: 'Opposite side of the first-30 range',
    },
    {
      ...base,
      family: 'morning_thrust',
      name: 'Morning thrust, 8 names (hard research cap)',
      maxStocksPerDay: 8,
      minRet: 0.006,
      rankBy: 'move',
      entry: 'Morning thrust with up to 8 names. Quantity still respects 0.75% risk and 5× buy-power.',
      stopLoss: 'High/low of 09:15–10:00',
    },
  ];
  return raw.slice(0, max).map(withId);
}

module.exports = { generateCandidates, describe };
