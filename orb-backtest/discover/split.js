'use strict';

function allDays(symbolBars) {
  const set = new Set();
  for (const byDay of Object.values(symbolBars || {})) {
    for (const day of Object.keys(byDay || {})) set.add(day);
  }
  return [...set].sort();
}

function splitDays(days) {
  const sorted = [...new Set(days || [])].sort();
  if (sorted.length < 6) {
    return { train: sorted, validation: [], oos: [], mode: 'in_sample', note: 'Fewer than 6 sessions — no held-out split. All figures are in-sample.' };
  }
  const n = sorted.length;
  const a = Math.max(2, Math.floor(n * 0.5));
  const b = Math.max(a + 1, Math.floor(n * 0.75));
  return {
    train: sorted.slice(0, a),
    validation: sorted.slice(a, b),
    oos: sorted.slice(b),
    mode: 'train_val_oos',
    note: 'Candidates are chosen on training days, compared on validation, and reported on out-of-sample days that were not used to pick a winner.',
  };
}

function walkForwardFolds(days) {
  const sorted = [...new Set(days || [])].sort();
  if (sorted.length < 8) return [];
  const size = Math.max(2, Math.floor(sorted.length / 4));
  const folds = [];
  for (let start = 0; start + size * 2 <= sorted.length; start += size) {
    folds.push({
      train: sorted.slice(0, start + size),
      test: sorted.slice(start + size, Math.min(sorted.length, start + size * 2)),
    });
  }
  return folds;
}

function filterBars(symbolBars, days) {
  const allow = new Set(days || []);
  const out = {};
  for (const [symbol, byDay] of Object.entries(symbolBars || {})) {
    const next = {};
    for (const [day, bars] of Object.entries(byDay || {})) {
      if (allow.has(day)) next[day] = bars;
    }
    if (Object.keys(next).length) out[symbol] = next;
  }
  return out;
}

function filterTrades(trades, days) {
  const allow = new Set(days || []);
  return (trades || []).filter((t) => allow.has(t.day));
}

module.exports = { allDays, splitDays, walkForwardFolds, filterBars, filterTrades };
