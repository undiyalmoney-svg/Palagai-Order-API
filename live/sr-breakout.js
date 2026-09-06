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
  // Time exit: if a trade hasn't hit target within N 5-min bars, exit at market.
  // Validated to beat hold-to-close (cuts the big losers; winners pay fast). 0=off.
  const timeStopBars = num(opts.timeStopBars, 0);
  // Bars before this date only warm up S/R + trend; they produce no reported
  // trades. Lets a single-day / live-today run see signals from the open.
  const reportFromDate = opts.reportFromDate || '';
  // Wall mode: 'pivot' = confirmed multi-day pivot (default); 'intraday' = the
  // break of the prior N 15-min candles' high/low (the intraday range breakout).
  const wallMode = opts.wallMode === 'intraday' ? 'intraday' : 'pivot';
  const intradayLookback = num(opts.intradayLookback, 3);
  const failStop = !!opts.failStop;               // exit if the broken level fails to hold
  const retest = !!opts.retest;                   // enter on the pullback to the broken level (NIFTY_RETEST_V1)

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
    if (i < trendBars) continue;
    if (reportFromDate && b.d < reportFromDate) continue;  // warm-up day: skip trade

    // Resolve the wall(s) for this bar per mode.
    let wallHi = lastRes, wallLo = lastSup;
    if (wallMode === 'intraday') {
      // prior N 15-min candles on the SAME day (need them, else skip)
      if (i < intradayLookback || bars15[i - intradayLookback].d !== b.d) continue;
      wallHi = -Infinity; wallLo = Infinity;
      for (let k = i - intradayLookback; k < i; k++) { if (bars15[k].d !== b.d) { wallHi = null; break; } wallHi = Math.max(wallHi, bars15[k].h); wallLo = Math.min(wallLo, bars15[k].l); }
      if (wallHi == null) continue;
    }
    if (wallHi == null || wallLo == null) continue;

    let st = dayState.get(b.d);
    if (!st) { st = { trades: 0, pnl: 0, stopped: false }; dayState.set(b.d, st); }
    if (st.stopped || st.trades >= maxTradesPerDay) continue;

    const body = b.c - b.o;
    const trend = b.c - bars15[i - trendBars].c;
    // ENTRY per mode:
    //  pivot   : big candle (>= entryPts) closing beyond the pivot wall, with trend.
    //  intraday: close breaks the prior-N-candle high/low, with trend (the
    //            intraday range breakout — a big body is not required, the range
    //            break IS the signal).
    let dir = 0, level = null;
    if (wallMode === 'intraday') {
      if (b.c > wallHi && trend > 0) { dir = 1; level = wallHi; }
      else if (b.c < wallLo && trend < 0) { dir = -1; level = wallLo; }
    } else {
      if (body >= entryPts && b.c > wallHi && trend > 0) { dir = 1; level = wallHi; }
      else if (-body >= entryPts && b.c < wallLo && trend < 0) { dir = -1; level = wallLo; }
    }
    if (!dir) continue;

    // confidence score
    const gap = (lastRes != null && lastSup != null) ? lastRes - lastSup : 0;
    let score = 1;                                   // with-trend (we only take these)
    if (Math.abs(body) >= entryPts * 1.5) score++;   // big body
    if (gap >= gapLo && gap < gapHi) score++;        // mid gap
    const target = targetByScore[score] || 0;

    const breakoutPrice = b.c, breakoutTime = b.hm;
    let entry = b.c, entryTime = b.hm, retestTime = null;
    let after = (day5.get(b.d) || []).filter(x => hhmm(x.date) > b.hm && hhmm(x.date) <= squareOffHm);
    if (!after.length) continue;
    if (retest) {
      // Wait CAUSALLY for price to pull back to the broken level, then enter there.
      // No look-ahead: we scan forward bar-by-bar and enter on the first touch; if
      // the retest never comes, no trade is taken.
      const hi = after.findIndex(x => (dir > 0 ? x.low <= level : x.high >= level));
      if (hi < 0 || hi + 1 >= after.length) continue;      // retest never confirmed → skip
      entry = level; entryTime = hhmm(after[hi].date); retestTime = entryTime;
      after = after.slice(hi + 1);
    }
    let exit = after[after.length - 1].close, exitTime = hhmm(after[after.length - 1].date), reason = 'CLOSE';
    for (let bi = 0; bi < after.length; bi++) {
      const bar = after[bi];
      const fav = dir * ((dir > 0 ? bar.high : bar.low) - entry);
      if (target > 0 && fav >= target) { exit = entry + dir * target; exitTime = hhmm(bar.date); reason = 'TARGET'; break; }
      // FAIL-STOP: the broken level did not hold (price closed back through it) → cut it.
      if (failStop && (dir > 0 ? bar.close < level : bar.close > level)) { exit = bar.close; exitTime = hhmm(bar.date); reason = 'FAIL'; break; }
      // TIME EXIT: not paying by the time limit → get out at market (this bar's close).
      if (timeStopBars > 0 && bi >= timeStopBars - 1) { exit = bar.close; exitTime = hhmm(bar.date); reason = 'TIME'; break; }
    }
    const pts = dir * (exit - entry);
    st.trades++; st.pnl += pts;
    trades.push({
      date: b.d, side: dir > 0 ? 'BUY' : 'SELL', option: dir > 0 ? 'CE' : 'PE',
      confidence: score, entryTime, entryPrice: round2(entry), level: round2(level),
      breakoutTime, breakoutPrice: round2(breakoutPrice), retestTime,
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
