'use strict';
/**
 * S/R BREAKOUT strategy engine — RESEARCH / PAPER ONLY.
 *
 * Pure function over candle data. Imports nothing from the broker order path and
 * cannot place, modify, or cancel an order.
 *
 * Rules (from scripts/p43–p57 on NIFTY / Bank Nifty / Crude Oil Mini):
 *   - S/R = last CONFIRMED pivot high/low (pivotLen 5) on 15-min candles (causal).
 *   - ENTRY: 15-min body >= entryPts closing beyond the level, IN THE TREND
 *       direction (trend = close vs close[trendBars] on 15-min).
 *       close>resistance & up-trend -> BUY (CE); close<support & down-trend -> SELL (PE).
 *   - CONFIDENCE 1-3: 1 (with-trend) +1 big body (>=1.5x entryPts) +1 mid-gap
 *       (S/R gap within [gapLo,gapHi]). Higher score reaches bigger targets.
 *   - TARGET by confidence (targetByScore). Exit at +target or session square-off.
 *       No price stop — on options the premium is the loss cap.
 *   - DAILY RISK: stop the day after maxTradesPerDay, or once day P&L <= -dayLossStop
 *       or >= dayProfitTarget (all in points; caller converts to rupees).
 *
 * Input candles: [{date, open, high, low, close}] 5-min. Returns {trades, summary}
 * in POINTS; the caller applies lot / point-value for rupees.
 */

const PIVOT = 5;

const hhmm = d => String(d).slice(11, 16);
const ymd = d => String(d).slice(0, 10);

function to15(bars5) {
  const by = new Map();
  for (const b of bars5) {
    const hm = hhmm(b.date); const [H, M] = hm.split(':').map(Number);
    const mm = H * 60 + Math.floor(M / 15) * 15;
    const key = ymd(b.date) + '|' + mm;
    let g = by.get(key);
    if (!g) { g = { d: ymd(b.date), min: mm, hm: String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'), o: b.open, h: b.high, l: b.low, c: b.close }; by.set(key, g); }
    else { g.h = Math.max(g.h, b.high); g.l = Math.min(g.l, b.low); g.c = b.close; }
  }
  return [...by.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.min - b.min);
}

/**
 * opts: {
 *   entryPts, trendBars=20, gapLo, gapHi,           // signal + confidence
 *   targetByScore={1,2,3}, cutHm='', entryStartHm, entryEndHm, squareOffHm,
 *   maxTradesPerDay=3, dayLossStop=0, dayProfitTarget=0   // 0 = off (in points)
 * }
 */
function runSrBreakout(bars5, opts) {
  const entryPts = num(opts.entryPts, 27);
  const trendBars = num(opts.trendBars, 20);
  const gapLo = num(opts.gapLo, 0);
  const gapHi = num(opts.gapHi, Infinity);
  const tbs = opts.targetByScore || {};
  const targetByScore = { 1: num(tbs[1], 0), 2: num(tbs[2], 0), 3: num(tbs[3], 0) };
  const cutHm = opts.cutHm || '';
  const entryStartHm = opts.entryStartHm || '09:45';
  const entryEndHm = opts.entryEndHm || '14:30';
  const squareOffHm = opts.squareOffHm || '15:15';
  const maxTradesPerDay = num(opts.maxTradesPerDay, 3);
  const dayLossStop = num(opts.dayLossStop, 0);
  const dayProfitTarget = num(opts.dayProfitTarget, 0);

  const bars15 = to15(bars5);
  const day5 = new Map();
  for (const b of bars5) { const d = ymd(b.date); if (!day5.has(d)) day5.set(d, []); day5.get(d).push(b); }

  const n = bars15.length;
  const isPH = new Array(n).fill(false), isPL = new Array(n).fill(false);
  for (let j = PIVOT; j < n - PIVOT; j++) {
    let ph = true, pl = true;
    for (let k = j - PIVOT; k <= j + PIVOT; k++) { if (k === j) continue; if (bars15[k].h >= bars15[j].h) ph = false; if (bars15[k].l <= bars15[j].l) pl = false; }
    isPH[j] = ph; isPL[j] = pl;
  }

  const trades = [];
  let lastRes = null, lastSup = null;
  const dayState = new Map();   // date -> {trades, pnl, stopped}
  for (let i = 0; i < n; i++) {
    const j = i - PIVOT;
    if (j >= 0) { if (isPH[j]) lastRes = bars15[j].h; if (isPL[j]) lastSup = bars15[j].l; }
    const b = bars15[i];
    if (b.hm < entryStartHm || b.hm > entryEndHm) continue;
    if (cutHm && b.hm >= cutHm) continue;
    if (lastRes == null || lastSup == null || i < trendBars) continue;

    let st = dayState.get(b.d);
    if (!st) { st = { trades: 0, pnl: 0, stopped: false }; dayState.set(b.d, st); }
    if (st.stopped || st.trades >= maxTradesPerDay) continue;

    const body = b.c - b.o;
    const trend = b.c - bars15[i - trendBars].c;
    let dir = 0, level = null;
    if (body >= entryPts && b.c > lastRes && trend > 0) { dir = 1; level = lastRes; }
    else if (-body >= entryPts && b.c < lastSup && trend < 0) { dir = -1; level = lastSup; }
    if (!dir) continue;

    // confidence score
    const gap = lastRes - lastSup;
    let score = 1;                                   // with-trend (we only take these)
    if (Math.abs(body) >= entryPts * 1.5) score++;   // big body
    if (gap >= gapLo && gap < gapHi) score++;        // mid gap
    const target = targetByScore[score] || 0;

    const entry = b.c;
    const after = (day5.get(b.d) || []).filter(x => hhmm(x.date) > b.hm && hhmm(x.date) <= squareOffHm);
    if (!after.length) continue;
    let exit = after[after.length - 1].close, exitTime = hhmm(after[after.length - 1].date), reason = 'CLOSE';
    if (target > 0) {
      for (const bar of after) {
        const fav = dir * ((dir > 0 ? bar.high : bar.low) - entry);
        if (fav >= target) { exit = entry + dir * target; exitTime = hhmm(bar.date); reason = 'TARGET'; break; }
      }
    }
    const pts = dir * (exit - entry);
    st.trades++; st.pnl += pts;
    trades.push({
      date: b.d, side: dir > 0 ? 'BUY' : 'SELL', option: dir > 0 ? 'CE' : 'PE',
      confidence: score, entryTime: b.hm, entryPrice: round2(entry), level: round2(level),
      bodyPts: round2(body), target, exitTime, exitPrice: round2(exit), exitReason: reason, points: round2(pts),
    });
    // daily risk stop (checked after the trade completes)
    if (dayLossStop > 0 && st.pnl <= -dayLossStop) st.stopped = true;
    if (dayProfitTarget > 0 && st.pnl >= dayProfitTarget) st.stopped = true;
  }

  const wins = trades.filter(t => t.points > 0);
  const losers = trades.filter(t => t.points <= 0);
  const summary = {
    trades: trades.length,
    wins: wins.length,
    losses: losers.length,
    winPct: trades.length ? Math.round((100 * wins.length) / trades.length) : 0,
    profitPoints: round2(wins.reduce((a, t) => a + t.points, 0)),
    lossPoints: round2(losers.reduce((a, t) => a + t.points, 0)),
    grossPoints: round2(trades.reduce((a, t) => a + t.points, 0)),
    tgtHitPct: trades.length ? Math.round((100 * trades.filter(t => t.exitReason === 'TARGET').length) / trades.length) : 0,
    tradingDays: dayState.size,
  };
  return { trades, summary };
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

module.exports = { runSrBreakout, to15 };
