'use strict';
/**
 * ORB-RETEST-V1  — best configuration found in Phases 8-19.
 *
 * RESEARCH ONLY. Generates signals. Does NOT place, modify or cancel orders,
 * and imports nothing from the live broker path.
 *
 * RULES (frozen 2026-08-30, selected on DEV 2018-2019 only):
 *   Universe : 55 mid-cap NSE stocks (research-data/midcap-universe.json),
 *              chosen on 2022 liquidity + range width, before TEST was seen.
 *   Range    : 120-minute opening range = first 24 x 5-min bars (09:15-11:15).
 *   Breakout : first 5-min CLOSE beyond OR high (long) or OR low (short),
 *              before 14:45.
 *   ENTRY    : do NOT enter on the breakout. Wait for a RETEST - price trading
 *              back to the OR level within 12 bars. Enter at the NEXT bar's
 *              open after the retest bar. No entry if no retest.
 *   STOP     : 1.5 x OR width from fill. Wide on purpose - tight stops
 *              measured strictly worse across every variant tested.
 *   EXIT     : hold the FULL position to 15:15 (or the stop). NO profit target.
 *              A 1R partial and any R-multiple target were measured to DESTROY
 *              the edge (Phase 20): the return lives in the few trades that run
 *              far, and a target caps exactly those. NEVER an EMA-cross exit -
 *              measured the worst of 30 exit rules.
 *   SIZE     : one position per day, notional = 5 x equity (MIS intraday).
 *              Brokerage is capped at Rs20/order, so large positions cut the
 *              cost RATE from 0.106% to 0.054%.
 *
 * MEASURED EXPECTATION (do not skip this):
 *   Fixed Rs250k notional, hold-full exit, priority-ranked one trade/day:
 *   DEV 2018-19 +Rs219,102 | VALID 2020-22 +Rs209,116 | TEST 2023-26 +Rs138,821
 *   TEST t = 1.42. Positive in all three windows and down to 0.03% slippage.
 *   BUT t=1.42 is below the ~3.2 Bonferroni bar for ~250 tested configs, so this
 *   is the BEST result found, not a proven edge. Real mid-cap spreads were never
 *   measured (needs live market-hours depth); break-even is ~0.04% slippage/side.
 *   Green days ~49% - this is NOT an all-green strategy; it wins via fat tails.
 */
const OR_BARS = 24;          // 120 minutes of 5-min bars
const RETEST_MAX_BARS = 12;  // give up if no retest within an hour
const STOP_W = 1.5;          // stop = 1.5 x OR width
const PARTIAL_R = 1.5;       // scale out half at 1.5 x OR width
const NO_ENTRY_AFTER = '14:45';
const EXIT_TIME = '15:15';

/** bars: [{hm,o,h,l,c}] for ONE symbol, ONE day, chronological, 5-min. */
function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < OR_BARS + 2) return null;
  let hi = -Infinity, lo = Infinity;
  for (let i = 0; i < OR_BARS; i++) { hi = Math.max(hi, bars[i].h); lo = Math.min(lo, bars[i].l); }
  if (!(hi > lo)) return null;
  const width = hi - lo;

  let bIdx = null, dir = 0;
  for (let i = OR_BARS; i < bars.length - 1; i++) {
    if (bars[i].hm >= NO_ENTRY_AFTER) break;
    if (bars[i].c > hi) { bIdx = i; dir = +1; break; }
    if (bars[i].c < lo) { bIdx = i; dir = -1; break; }
  }
  if (bIdx == null) return null;

  const level = dir > 0 ? hi : lo;
  let rIdx = null;
  for (let j = bIdx + 1; j < Math.min(bIdx + 1 + RETEST_MAX_BARS, bars.length - 1); j++) {
    if (bars[j].hm >= NO_ENTRY_AFTER) break;
    if (dir > 0 ? bars[j].l <= level : bars[j].h >= level) { rIdx = j; break; }
  }
  if (rIdx == null) return null;               // no retest -> no trade

  const entryIdx = rIdx + 1;
  if (entryIdx >= bars.length) return null;
  const entry = bars[entryIdx].o;
  if (!(entry > 0)) return null;

  return {
    direction: dir > 0 ? 'BUY' : 'SELL',
    entryBarIndex: entryIdx,
    entryTime: bars[entryIdx].hm,
    entryPrice: entry,
    stopLoss: entry - dir * STOP_W * width,
    partialTarget: null, // intentionally no target - see EXIT note above
    exitTime: EXIT_TIME,
    orHigh: hi, orLow: lo, orWidth: width,
    breakoutTime: bars[bIdx].hm, retestTime: bars[rIdx].hm,
  };
}

function positionSize(equityRs, entryPrice, leverage = 5) {
  if (!(equityRs > 0 && entryPrice > 0)) return 0;
  return Math.floor((equityRs * leverage) / entryPrice);
}

module.exports = { evaluate, positionSize, OR_BARS, STOP_W, PARTIAL_R, RETEST_MAX_BARS };
