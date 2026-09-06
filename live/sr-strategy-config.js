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
  // Nifty — test window: net Rs428,791, losses -Rs73,450, PF 7.87, 88% win.
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
  // Bank — 6 bars + profit lock. Test window: net Rs211,602, losses -Rs58,488,
  // PF 6.07, 96% win.
  // The same audit run on Nifty applies here even more strongly: 75% of Bank's
  // losing trades reached +10 pts or more before reversing (Nifty was 50%), and
  // 30 of 76 got within 5 pts of the +20 target. Locking at +5 once +12 is
  // reached cuts total losses 60% (-Rs146,767 -> -Rs58,488) while net edges up.
  // NOT applied to Bank, each measured and rejected:
  //   giveUpBar/MinPts — costs Rs47k of net (b2<8: Rs162,875 vs Rs211,602).
  //     Bank enters on the raw breakout, not a retest, so there is more early
  //     noise and it needs longer to get going than Nifty does.
  //   maxRetestBars   — not applicable, Bank has no retest entry.
  //   entry filters   — none found. Body size, extension past the wall and
  //     confidence score all score 92-98% win and Rs249-354/trade across every
  //     bucket, so there is nothing to filter on. Bank's entries are uniformly
  //     good; its losses were purely an exit problem.
  //   failStop / rupee cut-off — both harmful: 9 bars + failStop is
  //     -Rs239,478 (PF 0.67), and a Rs4,000 cut turns +Rs213,758 into
  //     -Rs202,151, because 84% of trades that dip past -Rs3,000 still win.
  banknifty: Object.freeze({
    wallMode: 'intraday', timeStopBars: 6,
    lockArmPts: 12, lockAtPts: 5,
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
