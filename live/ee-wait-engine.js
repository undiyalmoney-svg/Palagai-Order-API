'use strict';
/**
 * Entry / wait / exit scanner on OHLC bars.
 * No Genie / Trap / S/R DNA — only close vs prior highs/lows, confirmation wait,
 * then stop / target / time stop.
 */

const NIFTY_LOT_SIZE = 65;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function priorWindow(bars, i, lookback) {
  const from = Math.max(0, i - lookback);
  const slice = bars.slice(from, i);
  let maxHigh = -Infinity;
  let minLow = Infinity;
  for (const b of slice) {
    if (b.high > maxHigh) maxHigh = b.high;
    if (b.low < minLow) minLow = b.low;
  }
  return { maxHigh, minLow, prev: bars[i - 1] };
}

function rawSignal(entry, bars, i, lookback) {
  if (i < lookback) return 0;
  const bar = bars[i];
  const w = priorWindow(bars, i, lookback);
  if (entry === 'breakout') return bar.close > w.maxHigh ? 1 : 0;
  if (entry === 'breakdown') return bar.close < w.minLow ? -1 : 0;
  if (entry === 'thrust') {
    const prev = w.prev;
    if (!prev) return 0;
    return bar.close > bar.open && bar.close > prev.close ? 1 : 0;
  }
  if (entry === 'range_break') {
    if (bar.close > w.maxHigh) return 1;
    if (bar.close < w.minLow) return -1;
    return 0;
  }
  if (entry === 'btst') {
    // Rejection at a prior swing high, weak close → short (buy PE), typically hold overnight.
    if (!w.prev) return 0;
    const tagged = bar.high >= w.maxHigh;
    const weak = bar.close < bar.open && bar.close < (bar.high + bar.low) / 2;
    return tagged && weak ? -1 : 0;
  }
  return 0;
}

function confirmedSignal(entry, bars, i, lookback, wait) {
  const need = Math.max(1, wait);
  let dir = rawSignal(entry, bars, i, lookback);
  if (!dir) return 0;
  for (let k = 1; k < need; k += 1) {
    if (rawSignal(entry, bars, i - k, lookback) !== dir) return 0;
  }
  return dir;
}

function summarizeTrades(trades, lots, lotSize) {
  const L = Math.max(1, Math.floor(Number(lots)) || 1);
  const size = Number(lotSize) > 0 ? Number(lotSize) : NIFTY_LOT_SIZE;
  let points = 0;
  let wins = 0;
  let losses = 0;
  let maxDd = 0;
  let peak = 0;
  let equity = 0;
  for (const t of trades) {
    points += t.points;
    equity += t.points;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    if (t.points > 0) wins += 1;
    else if (t.points < 0) losses += 1;
  }
  const grossWin = trades.filter((t) => t.points > 0).reduce((s, t) => s + t.points, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.points < 0).reduce((s, t) => s + t.points, 0));
  return {
    trades: trades.length,
    wins,
    losses,
    points: Math.round(points * 100) / 100,
    rupees: Math.round(points * size * L),
    maxDrawdownPoints: Math.round(maxDd * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 99 : 0,
    lots: L,
    lotSize: size,
  };
}

/**
 * @param {Array<{date,open,high,low,close}>} bars
 * @param {{ entry, lookback, wait, hold, stopPct, targetPct }} spec
 */
function simulate(bars, spec, opts = {}) {
  const entry = spec.entry;
  const lookback = Math.max(1, Number(spec.lookback) || 3);
  const wait = Math.max(1, Number(spec.wait) || 1);
  const hold = Math.max(1, Number(spec.hold) || 2);
  const stopPct = Number(spec.stopPct) || 0.8;
  const targetPct = Number(spec.targetPct) || 1.2;
  const killFailures = spec.killFailures !== false;
  const fromDate = opts.fromDate || '';
  const toDate = opts.toDate || '9999-12-31';
  const trades = [];
  let pos = null;
  let cooldown = 0;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const inWindow = (!fromDate || bar.date >= fromDate) && bar.date <= toDate;

    if (pos) {
      const held = i - pos.entryIndex;
      let exitPx = null;
      let reason = null;
      if (pos.dir === 1) {
        const stopPx = pos.entry * (1 - stopPct / 100);
        const tgtPx = pos.entry * (1 + targetPct / 100);
        if (held >= 1 && bar.low <= stopPx) {
          exitPx = stopPx;
          reason = 'stop';
        } else if (bar.high >= tgtPx) {
          exitPx = tgtPx;
          reason = 'target';
        } else if (killFailures && held >= 1 && bar.close < pos.entry) {
          exitPx = bar.close;
          reason = 'fail_kill';
        }
      } else {
        const stopPx = pos.entry * (1 + stopPct / 100);
        const tgtPx = pos.entry * (1 - targetPct / 100);
        if (held >= 1 && bar.high >= stopPx) {
          exitPx = stopPx;
          reason = 'stop';
        } else if (bar.low <= tgtPx) {
          exitPx = tgtPx;
          reason = 'target';
        } else if (killFailures && held >= 1 && bar.close > pos.entry) {
          exitPx = bar.close;
          reason = 'fail_kill';
        }
      }
      if (!exitPx && held >= hold) {
        if (killFailures && (bar.close - pos.entry) * pos.dir <= 0) {
          exitPx = bar.close;
          reason = 'fail_kill';
        } else {
          exitPx = bar.close;
          reason = 'time';
        }
      }
      if (exitPx != null) {
        const points = (exitPx - pos.entry) * pos.dir;
        trades.push({
          side: pos.dir === 1 ? 'BUY' : 'SELL',
          entryTime: pos.entryDate,
          exitTime: bar.date,
          exitReason: reason,
          entry: pos.entry,
          exit: exitPx,
          points: Math.round(points * 100) / 100,
          instrumentName: 'Nifty 50',
          optionSymbol: pos.dir === 1 ? 'CE' : 'PE',
        });
        pos = null;
        cooldown = 1;
      }
    }

    if (pos || !inWindow) continue;
    if (cooldown > 0) {
      cooldown -= 1;
      continue;
    }
    const dir = confirmedSignal(entry, bars, i, lookback, wait);
    if (!dir) continue;
    pos = { dir, entry: bar.close, entryDate: bar.date, entryIndex: i };
  }

  return {
    spec: { entry, lookback, wait, hold, stopPct, targetPct, killFailures },
    trades,
    open: pos
      ? {
          direction: pos.dir === 1 ? 'BUY' : 'SELL',
          entry: pos.entry,
          entryTime: pos.entryDate,
          indexEntry: pos.entry,
        }
      : null,
  };
}

function specGrid() {
  const out = [];
  for (const entry of ['breakout', 'breakdown', 'thrust', 'range_break', 'btst']) {
    for (const lookback of [2, 3, 5, 8]) {
      for (const wait of [1, 2, 3]) {
        for (const hold of [1, 2, 3, 5]) {
          for (const stopPct of [0.5, 0.8, 1.2]) {
            for (const targetPct of [0.8, 1.2, 1.8, 2.5]) {
              out.push({ entry, lookback, wait, hold, stopPct, targetPct, killFailures: true });
            }
          }
        }
      }
    }
  }
  return out;
}

function specGridLite() {
  const out = [];
  for (const entry of ['thrust', 'range_break', 'breakdown', 'btst']) {
    for (const lookback of [3, 5, 8]) {
      for (const wait of [1, 2]) {
        for (const hold of [1, 3, 5]) {
          for (const stopPct of [0.5, 1.2]) {
            for (const targetPct of [1.2, 2.5]) {
              out.push({ entry, lookback, wait, hold, stopPct, targetPct, killFailures: true });
            }
          }
        }
      }
    }
  }
  return out;
}

function score(stats) {
  if (!stats.trades) return -1e9;
  return stats.points - stats.maxDrawdownPoints * 0.25 + Math.min(stats.trades, 40) * 0.01;
}

function splitFolds(bars, folds) {
  const n = bars.length;
  if (n < 80) {
    const cut = Math.floor(n * 0.7);
    return [{ train: bars.slice(0, cut), test: bars.slice(cut) }];
  }
  const out = [];
  const foldN = Math.max(2, Math.min(folds || 3, 4));
  const chunk = Math.floor(n / (foldN + 1));
  for (let f = 0; f < foldN; f += 1) {
    const trainEnd = chunk * (f + 1);
    const testEnd = Math.min(n, trainEnd + chunk);
    if (testEnd - trainEnd < 20) continue;
    out.push({ train: bars.slice(0, trainEnd), test: bars.slice(trainEnd, testEnd) });
  }
  return out.length ? out : [{ train: bars.slice(0, Math.floor(n * 0.7)), test: bars.slice(Math.floor(n * 0.7)) }];
}

function rankGrid(bars, grid, lots, lotSize, folds) {
  let best = null;
  for (const spec of grid) {
    const oosTrades = [];
    let trainPoints = 0;
    let trainFolds = 0;
    for (const fold of folds) {
      const train = summarizeTrades(simulate(fold.train, spec).trades, lots, lotSize);
      if (train.trades < 8) continue;
      trainPoints += train.points;
      trainFolds += 1;
      oosTrades.push(...simulate(fold.test, spec).trades);
    }
    if (!trainFolds || !oosTrades.length) continue;
    const oos = summarizeTrades(oosTrades, lots, lotSize);
    if (oos.points <= 0) continue;
    const row = {
      spec,
      trainPoints: Math.round((trainPoints / trainFolds) * 100) / 100,
      oos,
      foldsUsed: trainFolds,
      score: score(oos) + (oos.points > 0 ? 50 : 0),
    };
    if (!best || row.score > best.score) best = row;
  }
  return best;
}

function searchSpecs(bars, opts = {}) {
  const lots = opts.lots || 1;
  const lotSize = opts.lotSize || NIFTY_LOT_SIZE;
  const grid = opts.grid || specGrid();
  const folds = splitFolds(bars, opts.folds);
  const best = rankGrid(bars, grid, lots, lotSize, folds);
  const full = best ? simulate(bars, best.spec) : { trades: [], spec: null, open: null };
  const btstFull = opts.skipChecks
    ? null
    : (() => {
        let row = null;
        for (const spec of grid.filter((s) => s.entry === 'btst' && s.hold === 1)) {
          const st = summarizeTrades(simulate(bars, spec).trades, lots, lotSize);
          if (!st.trades) continue;
          if (!row || st.points > row.full.points) row = { spec, full: st };
        }
        return row;
      })();
  const btst = opts.skipChecks
    ? null
    : rankGrid(
        bars,
        grid.filter((s) => s.entry === 'btst' && s.hold === 1),
        lots,
        lotSize,
        folds,
      );
  return {
    best,
    full: best
      ? { spec: best.spec, ...summarizeTrades(full.trades, lots, lotSize), tradeCount: full.trades.length }
      : null,
    checks: {
      btstOvernight: btst
        ? { spec: btst.spec, oos: btst.oos, full: btstFull?.full || null }
        : btstFull,
    },
    folds: folds.length,
    combos: grid.length,
    lots,
    lotSize,
    note:
      'Walk-forward on NSE Nifty 50 daily OHLC. Losers are killed on the first close against the entry (fail_kill); winners may run to target or hold. Specs with OOS net ≤ 0 are discarded. Rupees = index points × lot size × lots. Not a guaranteed daily profit.',
  };
}

function dailyBarsFromFiveMinute(candles) {
  const byDay = new Map();
  for (const c of candles || []) {
    const date = String(c.date || c.time || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const o = num(c.open);
    const h = num(c.high);
    const l = num(c.low);
    const cl = num(c.close);
    const v = num(c.volume);
    const row = byDay.get(date);
    if (!row) {
      byDay.set(date, { date, open: o, high: h, low: l, close: cl, volume: v });
    } else {
      row.high = Math.max(row.high, h);
      row.low = Math.min(row.low, l);
      row.close = cl;
      row.volume = (row.volume || 0) + v;
    }
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
  NIFTY_LOT_SIZE,
  simulate,
  summarizeTrades,
  searchSpecs,
  specGrid,
  specGridLite,
  rawSignal,
  confirmedSignal,
  dailyBarsFromFiveMinute,
};
