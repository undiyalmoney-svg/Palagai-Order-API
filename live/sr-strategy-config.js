'use strict';
/**
 * S/R STRATEGY CONFIG — THE SINGLE SOURCE for exit/entry rules.
 *
 * Paper (sr-breakout.controller.js) and Live (sr-live.js) BOTH read from here.
 * They previously kept separate copies of these values and silently diverged:
 * Live was running Bank with failStop (measured at -Rs239,478 on the
 * walk-forward test window, versus +Rs209,770 without it) and Crude with no
 * time exit at all, while Paper had neither. Paper results therefore did not
 * describe what Live was actually doing.
 *
 * Anything that changes how a trade is entered or exited belongs in this file
 * and nowhere else. Per-instrument market facts (tokens, lot sizes, session
 * hours) stay with each caller.
 */

/** Rupee loss cut-off PER LOT. 0 = none. Converted to points by the caller. */
const CUT_LOSS_RS = Object.freeze({ nifty: 5000, banknifty: 0, crude: 2500 });

/** Units per lot — needed to turn the rupee cut-off into points. */
const LOT_UNITS = Object.freeze({ nifty: 75, banknifty: 35, crude: 10 });

/** Default position size per instrument. */
const DEFAULT_LOTS = Object.freeze({ nifty: 1, banknifty: 1, crude: 5 });

/**
 * Entry + exit rules per instrument. Every value here was walk-forward tested
 * (train 2024-01..2025-07, scored on an untouched 2025-07..2026-09 window)
 * except Crude, which has only 89 days and is marked accordingly.
 */
const EXIT_RULES = Object.freeze({
  // Nifty — test window: net Rs423,416, losses -Rs78,451, PF 7.36, 88% win.
  //   maxRetestBars 2  entry meter: a retest slower than 2 bars is a stale
  //                    setup (1-2 bars average +Rs692/trade, 8+ bars -Rs391).
  //   lockArmPts/AtPts once +12 is reached, exit at +5 — every losing trade
  //                    went green first, half by +10 or more.
  //   giveUpBar/MinPts no +8 progress within 2 bars → leave; it is not paying.
  nifty: Object.freeze({
    wallMode: 'intraday', retest: true, timeStopBars: 6, maxRetestBars: 2,
    lockArmPts: 12, lockAtPts: 5, giveUpBar: 2, giveUpMinPts: 8,
    targetByScore: { 1: 20, 2: 20, 3: 20 },
  }),
  // Bank — 6 bars, NO failStop and NO rupee cut-off, both measured as harmful:
  //   9 bars + failStop  net -Rs239,478  PF 0.67
  //   6 bars, no failStop net +Rs209,770 PF 3.01  (same -Rs10,843 worst trade)
  // 84% of Bank trades that dip past -Rs3,000 still close as winners, so any
  // stop sells the winners. The shorter hold gets the same tail for free.
  banknifty: Object.freeze({
    wallMode: 'intraday', timeStopBars: 6,
    targetByScore: { 1: 20, 2: 20, 3: 20 },
  }),
  // Crude — had NO time exit, so losers rode to the 23:20 square-off (average
  // hold 179 min). 18 bars cuts that to ~69 min. IN-SAMPLE ONLY (89 days) and
  // still net negative: the edge is ~Rs4,270 against ~Rs27,120 of brokerage.
  crude: Object.freeze({
    wallMode: 'intraday', timeStopBars: 18,
    targetByScore: { 1: 20, 2: 25, 3: 30 },
  }),
});

/**
 * Full engine options for one instrument, including the rupee cut-off already
 * converted to points. This is what both Paper and Live must pass to
 * runSrBreakout so the two agree.
 */
function exitOptsFor(key) {
  const rules = EXIT_RULES[key];
  if (!rules) return {};
  const cut = CUT_LOSS_RS[key] || 0;
  const units = LOT_UNITS[key] || 0;
  // stopPts is per lot, so the stop distance stays fixed as size scales.
  return cut > 0 && units > 0 ? { ...rules, stopPts: cut / units } : { ...rules };
}

module.exports = { EXIT_RULES, CUT_LOSS_RS, LOT_UNITS, DEFAULT_LOTS, exitOptsFor };
