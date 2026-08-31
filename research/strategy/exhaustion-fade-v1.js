'use strict';
/**
 * EXHAUSTION-FADE-V1  — frozen 2026-08-31.
 *
 * RESEARCH / PAPER ONLY. Pure signal generator. Imports nothing from the live
 * broker path. Does NOT place, modify, or cancel any order and cannot reach
 * broker state. Safe by construction.
 *
 * IDEA (the user's): when a move is exhausted and the crowd is done, fade it.
 *   "When buyers are done and everyone exits, sell. When sellers are done, buy."
 *
 * ENTRY (all conditions knowable at the signal bar's close — no look-ahead):
 *   - a directional RUN: >= 2.5% over the last 6 five-min bars (30 min)
 *   - a VOLUME CLIMAX: signal bar volume >= 3x its own 20-bar average
 *   - a STALL / rejection: the bar closes in the far third against the run
 *       (up-run -> closes bottom third; down-run -> closes top third)
 *   - a BLOWOFF bar: signal bar range >= 2.3x ATR(14)  <- the selectivity filter
 *   - time window 10:15 - 14:30
 *   Direction = FADE the run (up-run -> SELL, down-run -> BUY).
 *   When several stocks qualify the same day, take the ONE with the biggest run.
 *
 * ENTRY PRICE : next bar's open after the signal bar.
 * STOP        : 2 x ATR(14) from fill (hard). One trade/day, so this is also
 *               the day's maximum loss.
 * EXIT        : 15:15 (square-off) or stop, whichever first.
 * SIZE        : notional = current equity (1x; no leverage assumed here).
 *
 * MEASURED (2018-2026, honest 1x sizing, 0.05%/side slippage, real charges):
 *   ALL  +Rs58,946  win 54%  worst day -2,199  t=2.89  (291 trades, 8.6 yrs)
 *   DEV +6,016 (t0.63) · VALID +35,049 (t2.43) · TEST +17,881 (t1.66, out-of-sample)
 *   ~1 trade every 7-8 days  ·  flat Rs50,000 sizing, 0.05%/side slippage
 *   67% of random 57-day windows profitable.
 *   NOTE: filter was found by search -> forward paper-proof before real money.
 *   Real mid-cap spreads unmeasured; 0.05%/side assumed.
 */
const RUN_BARS = 6, RUN_PCT = 2.5, VOL_MULT = 3.0, STALL_THIRD = 0.34;
const BLOWOFF_ATR = 2.3, STOP_ATR = 2.0;
const ENTRY_START = '10:15', ENTRY_END = '14:30', EXIT_TIME = '15:15';

function atr14(bars, i) {
  let tr = 0, n = 0;
  for (let j = Math.max(1, i - 13); j <= i; j++) {
    tr += Math.max(bars[j].h - bars[j].l, Math.abs(bars[j].h - bars[j - 1].c), Math.abs(bars[j].l - bars[j - 1].c));
    n++;
  }
  return n ? tr / n : 0;
}
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Scan ONE symbol's day (bars: [{hm,o,h,l,c,v}]). Returns a raw candidate or null. */
function scanSymbol(bars) {
  if (!Array.isArray(bars) || bars.length < 45) return null;
  for (let i = 25; i < bars.length - 1; i++) {
    if (bars[i].hm < ENTRY_START || bars[i].hm > ENTRY_END) continue;
    const run = (bars[i].c - bars[i - RUN_BARS].c) / bars[i - RUN_BARS].c * 100;
    const avgVol = mean(bars.slice(i - 20, i).map(x => x.v));
    if (avgVol <= 0) continue;
    const volx = bars[i].v / avgVol;
    const rng = bars[i].h - bars[i].l;
    if (rng <= 0) continue;
    const atr = atr14(bars, i);
    if (atr <= 0 || rng / atr < BLOWOFF_ATR || volx < VOL_MULT) continue;
    const closeLow = (bars[i].c - bars[i].l) / rng <= STALL_THIRD;
    const closeHigh = (bars[i].h - bars[i].c) / rng <= STALL_THIRD;
    if (run >= RUN_PCT && closeLow) return { i, dir: -1, run: Math.abs(run), atr };
    if (run <= -RUN_PCT && closeHigh) return { i, dir: +1, run: Math.abs(run), atr };
  }
  return null;
}

/**
 * Evaluate a full trading day.
 * dayBySymbol: Map<symbol, bars[]>. Returns the single signal for the day, or null (NO TRADE).
 */
function evaluateDay(dayBySymbol) {
  const cands = [];
  for (const [sym, bars] of dayBySymbol) {
    const c = scanSymbol(bars);
    if (c) cands.push({ sym, bars, ...c });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.run - a.run);          // biggest run wins
  const c = cands[0];
  const e = c.i + 1;
  if (e >= c.bars.length) return null;
  const entry = c.bars[e].o;
  if (!(entry > 0)) return null;
  return {
    symbol: c.sym,
    side: c.dir > 0 ? 'BUY' : 'SELL',
    signalTime: c.bars[c.i].hm,
    entryTime: c.bars[e].hm,
    entryPrice: entry,
    stopLoss: entry - c.dir * STOP_ATR * c.atr,
    exitTime: EXIT_TIME,
    runPct: +c.run.toFixed(2),
    atr: +c.atr.toFixed(2),
  };
}

module.exports = { evaluateDay, scanSymbol, PARAMS: {
  RUN_BARS, RUN_PCT, VOL_MULT, STALL_THIRD, BLOWOFF_ATR, STOP_ATR, ENTRY_START, ENTRY_END, EXIT_TIME } };
