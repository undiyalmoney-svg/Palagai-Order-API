'use strict';
/**
 * Stockkraft-style confluence on OHLC+volume:
 *   LEVEL (POC / value edge) + WALL (high-volume node) + DELTA flip.
 *
 * Honest limits: NSE daily bars have no bid/ask tape or Bookmap heatmap.
 * Delta = signed volume (close vs open). Wall = high-volume price bin.
 */

const { summarizeTrades, NIFTY_LOT_SIZE } = require('./ee-wait-engine');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function barDelta(bar) {
  const vol = Math.max(0, num(bar.volume) || 1);
  const body = num(bar.close) - num(bar.open);
  if (body > 0) return vol;
  if (body < 0) return -vol;
  return 0;
}

function priceStep(bars) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  const span = hi - lo;
  if (!(span > 0)) return Math.max(0.05, num(bars[bars.length - 1]?.close) * 0.001);
  return span / 40;
}

function binOf(px, step) {
  return Math.round(px / step) * step;
}

function volumeProfile(bars, step) {
  const bins = new Map();
  let total = 0;
  for (const b of bars) {
    const lo = num(b.low);
    const hi = num(b.high);
    const vol = Math.max(0, num(b.volume) || 1);
    if (!(hi >= lo) || !(vol > 0)) continue;
    const n = Math.max(1, Math.round((hi - lo) / step) + 1);
    const each = vol / n;
    for (let k = 0; k < n; k += 1) {
      const px = binOf(lo + k * ((hi - lo) / Math.max(1, n - 1)), step);
      bins.set(px, (bins.get(px) || 0) + each);
      total += each;
    }
  }
  const ranked = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const poc = ranked[0][0];
  const pocVol = ranked[0][1];
  const ordered = [...bins.keys()].sort((a, b) => a - b);
  let lo = 0;
  let nearest = Infinity;
  for (let i = 0; i < ordered.length; i += 1) {
    const d = Math.abs(ordered[i] - poc);
    if (d < nearest) {
      nearest = d;
      lo = i;
    }
  }
  let hi = lo;
  let covered = pocVol;
  const need = total * 0.7;
  while (covered < need && (lo > 0 || hi < ordered.length - 1)) {
    const nextLo = lo > 0 ? bins.get(ordered[lo - 1]) || 0 : -1;
    const nextHi = hi < ordered.length - 1 ? bins.get(ordered[hi + 1]) || 0 : -1;
    if (nextHi >= nextLo) {
      hi += 1;
      covered += nextHi;
    } else {
      lo -= 1;
      covered += nextLo;
    }
  }
  const val = ordered[lo];
  const vah = ordered[hi];
  const median = ranked[Math.floor(ranked.length / 2)][1];
  return { poc, val, vah, pocVol, valVol: bins.get(val) || 0, vahVol: bins.get(vah) || 0, median, step, total };
}

function near(px, level, pct) {
  if (!level || !(px > 0)) return false;
  return Math.abs(px - level) / level * 100 <= pct;
}

function wallAt(profile, level, wallMult) {
  if (!profile || !level) return false;
  let vol = 0;
  if (level === profile.poc) vol = profile.pocVol;
  else if (level === profile.val) vol = profile.valVol;
  else if (level === profile.vah) vol = profile.vahVol;
  else vol = profile.pocVol;
  return vol >= profile.median * wallMult;
}

function confluenceSignal(bars, i, spec) {
  const lookback = Math.max(10, Number(spec.lookback) || 20);
  if (i < lookback + 1) return 0;
  const slice = bars.slice(i - lookback, i);
  const step = priceStep(slice);
  const profile = volumeProfile(slice, step);
  if (!profile) return 0;
  const bar = bars[i];
  const prev = bars[i - 1];
  const d = barDelta(bar);
  const pd = barDelta(prev);
  const levelPct = Number(spec.levelPct) || 0.35;
  const wallMult = Number(spec.wallMult) || 1.4;
  const atVal = near(bar.close, profile.val, levelPct) || near(bar.low, profile.val, levelPct);
  const atPoc = near(bar.close, profile.poc, levelPct);
  const atVah = near(bar.close, profile.vah, levelPct) || near(bar.high, profile.vah, levelPct);
  const flipUp = pd < 0 && d > 0;
  const flipDn = pd > 0 && d < 0;
  if ((atVal || atPoc) && wallAt(profile, atVal ? profile.val : profile.poc, wallMult) && flipUp) {
    return { dir: 1, profile, reason: atVal ? 'val_wall_delta' : 'poc_wall_delta' };
  }
  if ((atVah || atPoc) && wallAt(profile, atVah ? profile.vah : profile.poc, wallMult) && flipDn) {
    return { dir: -1, profile, reason: atVah ? 'vah_wall_delta' : 'poc_wall_delta' };
  }
  return 0;
}

function simulateOrderFlow(bars, spec, opts = {}) {
  const lookback = Math.max(10, Number(spec.lookback) || 20);
  const hold = Math.max(1, Number(spec.hold) || 3);
  const stopPct = Number(spec.stopPct) || 0.6;
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
        const wallStop = pos.wall != null ? pos.wall * (1 - 0.05 / 100) : null;
        const stopPx = wallStop != null ? Math.min(pos.entry * (1 - stopPct / 100), wallStop) : pos.entry * (1 - stopPct / 100);
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
        const wallStop = pos.wall != null ? pos.wall * (1 + 0.05 / 100) : null;
        const stopPx = wallStop != null ? Math.max(pos.entry * (1 + stopPct / 100), wallStop) : pos.entry * (1 + stopPct / 100);
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
        exitPx = bar.close;
        reason = killFailures && (bar.close - pos.entry) * pos.dir <= 0 ? 'fail_kill' : 'time';
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
          setup: pos.setup,
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
    const hit = confluenceSignal(bars, i, { ...spec, lookback });
    if (!hit || !hit.dir) continue;
    pos = {
      dir: hit.dir,
      entry: bar.close,
      entryDate: bar.date,
      entryIndex: i,
      wall: hit.dir === 1 ? hit.profile.val : hit.profile.vah,
      setup: hit.reason,
    };
  }

  return {
    spec: {
      engine: 'order-flow',
      entry: 'confluence',
      lookback,
      hold,
      stopPct,
      targetPct,
      levelPct: Number(spec.levelPct) || 0.35,
      wallMult: Number(spec.wallMult) || 1.4,
      killFailures,
    },
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

function orderFlowGrid() {
  const out = [];
  for (const lookback of [15, 20, 30, 50]) {
    for (const hold of [2, 3, 5]) {
      for (const stopPct of [0.4, 0.6, 1.0]) {
        for (const targetPct of [0.8, 1.2, 2.0]) {
          for (const levelPct of [0.25, 0.4, 0.6]) {
            for (const wallMult of [1.2, 1.6]) {
              out.push({
                engine: 'order-flow',
                entry: 'confluence',
                lookback,
                hold,
                stopPct,
                targetPct,
                levelPct,
                wallMult,
                killFailures: true,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

function orderFlowGridLite() {
  const out = [];
  for (const lookback of [20, 30]) {
    for (const hold of [2, 5]) {
      for (const stopPct of [0.6, 1.0]) {
        for (const targetPct of [1.2, 2.0]) {
          for (const levelPct of [0.4, 0.6]) {
            out.push({
              engine: 'order-flow',
              entry: 'confluence',
              lookback,
              hold,
              stopPct,
              targetPct,
              levelPct,
              wallMult: 1.2,
              killFailures: true,
            });
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
  const foldN = Math.max(2, Math.min(folds || 3, 4));
  const chunk = Math.floor(n / (foldN + 1));
  const out = [];
  for (let f = 0; f < foldN; f += 1) {
    const trainEnd = chunk * (f + 1);
    const testEnd = Math.min(n, trainEnd + chunk);
    if (testEnd - trainEnd < 15) continue;
    out.push({ train: bars.slice(0, trainEnd), test: bars.slice(trainEnd, testEnd) });
  }
  return out.length ? out : [{ train: bars.slice(0, Math.floor(n * 0.7)), test: bars.slice(Math.floor(n * 0.7)) }];
}

function searchOrderFlow(bars, opts = {}) {
  const lots = opts.lots || 1;
  const lotSize = opts.lotSize || NIFTY_LOT_SIZE;
  const grid = opts.grid || (opts.lite ? orderFlowGridLite() : orderFlowGrid());
  const folds = splitFolds(bars, opts.folds);
  let best = null;
  for (const spec of grid) {
    const oosTrades = [];
    let trainPoints = 0;
    let trainFolds = 0;
    for (const fold of folds) {
      const train = summarizeTrades(simulateOrderFlow(fold.train, spec).trades, lots, lotSize);
      if (train.trades < 4) continue;
      trainPoints += train.points;
      trainFolds += 1;
      oosTrades.push(...simulateOrderFlow(fold.test, spec).trades);
    }
    if (!trainFolds || !oosTrades.length) continue;
    const oos = summarizeTrades(oosTrades, lots, lotSize);
    if (oos.points <= 0) continue;
    const row = {
      spec,
      trainPoints: Math.round((trainPoints / trainFolds) * 100) / 100,
      oos,
      foldsUsed: trainFolds,
      score: score(oos) + 50,
    };
    if (!best || row.score > best.score) best = row;
  }
  const full = best ? simulateOrderFlow(bars, best.spec) : { trades: [], spec: null, open: null };
  return {
    engine: 'order-flow',
    best,
    full: best
      ? { spec: best.spec, ...summarizeTrades(full.trades, lots, lotSize), tradeCount: full.trades.length }
      : null,
    folds: folds.length,
    combos: grid.length,
    lots,
    lotSize,
    note:
      'Order-flow confluence on NSE daily OHLC+volume. LEVEL = POC/VAL/VAH. WALL = high-volume node (not a live heatmap). DELTA = signed volume from candle body (not bid/ask tape). Specs with OOS net ≤ 0 are discarded. Not guaranteed profit.',
  };
}

module.exports = {
  barDelta,
  volumeProfile,
  confluenceSignal,
  simulateOrderFlow,
  searchOrderFlow,
  orderFlowGrid,
  orderFlowGridLite,
  NIFTY_LOT_SIZE,
};
