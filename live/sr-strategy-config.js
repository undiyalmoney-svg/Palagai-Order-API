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

/**
 * Rupee loss cut-off — a TOTAL position figure, not per lot. The caller divides
 * by perPoint (unitsPerLot x lots), so the rupee risk is the same at any size
 * and only the point distance changes. It was per-lot before, which meant the
 * rupee risk doubled with every lot while the daily brake (already a total)
 * stayed fixed: at 2 lots a "Rs3,500 day" allowed a -Rs4,999 trade, at 5 lots
 * -Rs5,374. The two must scale the same way or the caps are meaningless above
 * one lot.
 */
const CUT_LOSS_RS = Object.freeze({ nifty: 5000, banknifty: 0, crude: 2500 });
// Nifty's cut-off is a TOTAL rupee figure (see above), so the rupee risk is the
// same at any lot size and only the point distance moves.
// A Rs2,000 ceiling was tried and REVERTED. It does cap the worst single trade
// (verified -Rs2,000 / -Rs1,999 / -Rs1,999 / -Rs2,002 at 1/2/5/10 lots), but it
// is worse on every other measure INCLUDING total losses, because tightening
// the stop converts recoverable trades into realised losses:
//   TEST window   Rs5,000 -> net Rs435,224  losses -Rs29,544  PF 18.29  14 red days
//                 Rs2,000 -> net Rs389,348  losses -Rs51,990  PF  9.92  26 red days
//   5 YEARS       Rs5,000 -> Rs17,48,369    Rs2,000 -> Rs15,32,555
// A tighter ceiling is not the same thing as losing less money. Only reinstate
// Rs2,000 if a hard per-trade ceiling is required for reasons outside P&L.

/** Units per lot — with `lots`, turns a rupee figure into points. */
const LOT_UNITS = Object.freeze({ nifty: 75, banknifty: 35, crude: 10 });

/**
 * Daily risk brakes, in rupees. Paper previously defaulted these to 0 (off)
 * while Live defaulted to 3500 — so an un-set field meant "no brake" on one
 * desk and "Rs3,500" on the other. Shared here so both agree.
 * NOTE: the brake can only block the NEXT trade; it cannot close one already
 * open. That is what capStopToDayBudget is for on the Nifty book.
 */
const DAY_LOSS_STOP_RS = 3500;
const DAY_PROFIT_TARGET_RS = 3500;

/** Default position size per instrument. */
const DEFAULT_LOTS = Object.freeze({ nifty: 1, banknifty: 1, crude: 5 });

/**
 * Entry + exit rules per instrument. Every value here was walk-forward tested
 * (train 2024-01..2025-07, scored on an untouched 2025-07..2026-09 window)
 * except Crude, which has only 89 days and is marked accordingly.
 */
const EXIT_RULES = Object.freeze({
  // Nifty — test window: net Rs389,348, PF 9.92, worst trade -Rs2,000,
  // worst DAY -Rs2,360 (Rs2,000 cut-off + Rs2,000 daily brake).
  //   maxRetestBars 2  entry meter: a retest slower than 2 bars is a stale
  //                    setup (1-2 bars average +Rs692/trade, 8+ bars -Rs391).
  //   lockArmPts/AtPts once +8 is reached, exit at +5 — every losing trade
  //                    went green first, half by +10 or more.
  //     The arm level is what decides how many losers get rescued: once armed,
  //     the exit sits above entry so the trade cannot end as a loss. Sweeping
  //     it on the TEST window, losses fall monotonically as it drops —
  //       +15 -Rs106,073 | +12 -Rs73,450 | +10 -Rs51,138 | +8 -Rs31,198 |
  //       +6 -Rs20,135 — while net stays flat or improves.
  //     +8 chosen over +6 (which scores marginally better, Rs440,601 vs
  //     Rs433,570) because +6 leaves only a 1-point band between arming and
  //     exiting, which real slippage would swallow. +8 keeps 3 points.
  //   giveUpBar/MinPts no +8 progress within 2 bars → leave; it is not paying.
  //   capStopToDayBudget  the per-trade stop never exceeds what is LEFT of the
  //     day's loss budget. The daily brake alone cannot stop a trade that is
  //     already open — it only blocks the NEXT one — so a Rs5,000 cut against a
  //     Rs3,500 day allowed -Rs5,514 days. With the cap, a day already down
  //     Rs2,000 gives the next trade a Rs1,500 stop, not Rs5,000.
  //     Test window: net Rs433,570 -> Rs435,224, losses -Rs31,198 -> -Rs29,544,
  //     worst trade -Rs5,000 -> -Rs3,346, worst DAY -Rs5,514 -> -Rs3,860.
  //     It only ever TIGHTENS an existing stop, never creates one.
  //   giveUpFloorPts   TESTED AND NOT ADOPTED. The give-up exits at the bar
  //     CLOSE, so a violent bar can crystallise a big loss (worst over 5 years:
  //     -49 pts / -Rs3,690 on a trade whose best was +5.6). A floor that skips
  //     the give-up when already deeper than 10 pts down looked good on the
  //     2024-25 train and 2025-26 test windows (+Rs7,195 / +Rs5,797 net, lower
  //     losses), but on the untouched 2021-2023 stretch it was WORSE on exactly
  //     the metric that matters: losses -Rs69,780 -> -Rs73,444, PF 14.51 ->
  //     13.85, worst day -Rs2,467 -> -Rs4,610. It relabels give-ups as stops
  //     rather than removing the damage. The option exists in the engine
  //     (default 0 = off); leave it off unless a longer study says otherwise.
  nifty: Object.freeze({
    wallMode: 'intraday', retest: true, timeStopBars: 6, maxRetestBars: 2,
    lockArmPts: 8, lockAtPts: 5, giveUpBar: 2, giveUpMinPts: 8,
    capStopToDayBudget: true,
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
  //   capStopToDayBudget is NOT set here, and cannot be: it only tightens an
  //     existing stop, and Bank deliberately has none. Giving Bank a Rs3,500
  //     stop so the day cap could bind turns +Rs211,022 into -Rs211,330
  //     (PF 6.06 -> 0.64) and produces 84 days past -Rs3,500 instead of 3.
  //     Bank's worst day (-Rs10,383) must be managed by LOT SIZE, not a stop.
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
function exitOptsFor(key, lots = 1) {
  const rules = EXIT_RULES[key];
  if (!rules) return {};
  const cut = CUT_LOSS_RS[key] || 0;
  const units = LOT_UNITS[key] || 0;
  const perPoint = units * Math.max(1, lots);
  // TOTAL rupees -> points, so the rupee risk is identical at any lot size.
  return cut > 0 && perPoint > 0 ? { ...rules, stopPts: cut / perPoint } : { ...rules };
}

module.exports = {
  EXIT_RULES, CUT_LOSS_RS, LOT_UNITS, DEFAULT_LOTS, exitOptsFor,
  DAY_LOSS_STOP_RS, DAY_PROFIT_TARGET_RS,
};
