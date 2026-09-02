'use strict';
/**
 * S/R BREAKOUT strategy engine — RESEARCH / PAPER ONLY.
 *
 * Pure function over candle data. Imports nothing from the broker order path and
 * cannot place, modify, or cancel an order. Powers the Paper tab.
 *
 * Rules (validated in scripts/p43–p48 on NIFTY, Bank Nifty, Crude Oil Mini):
 *   - S/R = last CONFIRMED pivot high/low (pivotLen 5) on 15-min candles (causal).
 *   - Entry (15-min): body (close−open) ≥ entryPts in the break direction AND the
 *       candle closes beyond the level. body ≥ bigPts to qualify (the selectivity
 *       filter). close>resistance → BUY (CE) ; close<support → SELL (PE).
 *       Only before `cutHm` (index recipe; pass '' to allow all session for crude).
 *   - Exit (5-min): take profit at +targetPts if reached; otherwise hold to the
 *       session square-off. No price stop-loss — on options the premium is the SL.
 *
 * Input candles: array of { date:'YYYY-MM-DDTHH:MM...', open, high, low, close }
 * (Kite 5-min). Returns { trades, summary } in POINTS; the caller applies lot /
 * point-value for ₹.
 */

const PIVOT = 5;

function hhmm(dateStr) { return String(dateStr).slice(11, 16); }
function ymd(dateStr) { return String(dateStr).slice(0, 10); }

/** Build 15-min candles from 5-min, per day, bucketed :00/:15/:30/:45. */
function to15(bars5) {
  const by = new Map();
  for (const b of bars5) {
    const hm = hhmm(b.date); const [H, M] = hm.split(':').map(Number);
    const mm = H * 60 + Math.floor(M / 15) * 15;
    const key = ymd(b.date) + '|' + mm;
    let g = by.get(key);
    if (!g) {
      g = { d: ymd(b.date), min: mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.open, h: b.high, l: b.low, c: b.close };
      by.set(key, g);
    } else { g.h = Math.max(g.h, b.high); g.l = Math.min(g.l, b.low); g.c = b.close; }
  }
  return [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.min - b.min);
}

/**
 * Run the strategy on one instrument's 5-min candle series.
 * opts: { entryPts, bigPts, targetPts, cutHm, entryStartHm, entryEndHm, squareOffHm }
 */
function runSrBreakout(bars5, opts) {
  const entryPts = Number(opts.entryPts) || 27;
  const bigPts = Number(opts.bigPts) || 0;           // 0 = no big-candle filter
  const targetPts = Number(opts.targetPts) || 0;     // 0 = hold to close
  const cutHm = opts.cutHm || '';                     // '' = no early cutoff
  const entryStartHm = opts.entryStartHm || '09:45';
  const entryEndHm = opts.entryEndHm || '14:30';
  const squareOffHm = opts.squareOffHm || '15:15';

  const bars15 = to15(bars5);
  const day5 = new Map();
  for (const b of bars5) { const d = ymd(b.date); if (!day5.has(d)) day5.set(d, []); day5.get(d).push(b); }

  // causal pivots
  const n = bars15.length;
  const isPH = new Array(n).fill(false), isPL = new Array(n).fill(false);
  for (let j = PIVOT; j < n - PIVOT; j++) {
    let ph = true, pl = true;
    for (let k = j - PIVOT; k <= j + PIVOT; k++) {
      if (k === j) continue;
      if (bars15[k].h >= bars15[j].h) ph = false;
      if (bars15[k].l <= bars15[j].l) pl = false;
    }
    isPH[j] = ph; isPL[j] = pl;
  }

  const trades = [];
  let lastRes = null, lastSup = null;
  for (let i = 0; i < n; i++) {
    const j = i - PIVOT;
    if (j >= 0) { if (isPH[j]) lastRes = bars15[j].h; if (isPL[j]) lastSup = bars15[j].l; }
    const b = bars15[i];
    if (b.hm < entryStartHm || b.hm > entryEndHm) continue;
    if (cutHm && b.hm >= cutHm) continue;
    const body = b.c - b.o;
    let dir = 0, level = null;
    if (body >= entryPts && lastRes != null && b.c > lastRes) { dir = 1; level = lastRes; }
    else if (-body >= entryPts && lastSup != null && b.c < lastSup) { dir = -1; level = lastSup; }
    if (!dir) continue;
    if (bigPts && Math.abs(body) < bigPts) continue;

    const entry = b.c;
    const after = (day5.get(b.d) || []).filter((x) => hhmm(x.date) > b.hm && hhmm(x.date) <= squareOffHm);
    if (!after.length) continue;
    let exit = after[after.length - 1].close, exitTime = hhmm(after[after.length - 1].date), reason = 'CLOSE';
    if (targetPts > 0) {
      for (const bar of after) {
        const fav = dir * ((dir > 0 ? bar.high : bar.low) - entry);
        if (fav >= targetPts) { exit = entry + dir * targetPts; exitTime = hhmm(bar.date); reason = 'TARGET'; break; }
      }
    }
    trades.push({
      date: b.d,
      side: dir > 0 ? 'BUY' : 'SELL',
      option: dir > 0 ? 'CE' : 'PE',
      entryTime: b.hm,
      entryPrice: round2(entry),
      level: round2(level),
      bodyPts: round2(body),
      exitTime,
      exitPrice: round2(exit),
      exitReason: reason,
      points: round2(dir * (exit - entry)),
    });
  }

  const wins = trades.filter((t) => t.points > 0);
  const losers = trades.filter((t) => t.points <= 0);
  const summary = {
    trades: trades.length,
    wins: wins.length,
    losses: losers.length,
    winPct: trades.length ? Math.round((100 * wins.length) / trades.length) : 0,
    profitPoints: round2(wins.reduce((a, t) => a + t.points, 0)),      // total profit (winners)
    lossPoints: round2(losers.reduce((a, t) => a + t.points, 0)),      // total loss (losers, negative)
    grossPoints: round2(trades.reduce((a, t) => a + t.points, 0)),     // net
    tgtHitPct: trades.length ? Math.round((100 * trades.filter((t) => t.exitReason === 'TARGET').length) / trades.length) : 0,
  };
  return { trades, summary };
}

function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

module.exports = { runSrBreakout, to15 };
