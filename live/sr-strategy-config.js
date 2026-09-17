'use strict';
/**
 * S/R STRATEGY CONFIG — THE SINGLE SOURCE for exit/entry rules.
 *
 * Play (Paper === Live): mark S/R → wait for with-trend 15m breakout close →
 * confirm direction (CE vs PE) → retest the broken wall on a later 5m bar →
 * enter ATM CE (bull) or PE (bear). Do not enter on the raw breakout 15m bar
 * (its own 5m prints). Confirm is first-class (breakoutTime /
 * confirmationTime / entryTime) on every engine trade.
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
const CUT_LOSS_RS = Object.freeze({ nifty: 5000, banknifty: 3500, crude: 2500 });
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

/** Units per lot — with `lots`, turns a rupee figure into points.
 *  NSE index lots from the Jan 2026 series: Nifty 65 (was 75), Bank 30 (was 35).
 *  Paper ₹ and Live day-stop points MUST use these, or Paper prints a number
 *  Kite can never pay (20 Bank pts × 35 = ₹700 vs a 30-qty lot). */
const LOT_UNITS = Object.freeze({ nifty: 65, banknifty: 30, crude: 10 });

/**
 * Daily risk brakes, in rupees. Paper previously defaulted these to 0 (off)
 * while Live defaulted to 3500 — so an un-set field meant "no brake" on one
 * desk and "Rs3,500" on the other. Shared here so both agree.
 * NOTE: the brake can only block the NEXT trade; it cannot close one already
 * open. That is what capStopToDayBudget is for on the Nifty book.
 */
const DAY_LOSS_STOP_RS = 3500;
const DAY_PROFIT_TARGET_RS = 3500;
/** Trade Bot (Nifty + Bank): up to two directional ATM options per book per day.
 *  1/day was the 15.4 peak of the TIME/stop/structure grid (Jun–Sep option ₹59,175).
 *  2/day is the only knob that strictly raises Jun–Sep net without an August
 *  CLOSE bucket (option ₹95,225, Aug +₹10,216, CLOSE n=0). Not 4-lot / not NRML. */
const MAX_TRADES_PER_DAY = 2;

/** Default position size per instrument. */
const DEFAULT_LOTS = Object.freeze({ nifty: 1, banknifty: 1, crude: 5 });

/**
 * Protective option SL rupee cap for S/R Live/Paper. Auto Bot DNA is ₹300/lot
 * and wick-dumps S/R TARGET winners. 0 = do not apply that cap (Bank: no
 * rupee stop). Nifty/Crude match the index cut so the stop is the strategy,
 * not Trap v2.
 */
const OPTION_SL_MAX_RS = Object.freeze({ nifty: 5000, banknifty: 3500, crude: 2500 });

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
  //   giveUpBar/MinPts OFF (15.9). Stall give-up (no +12 by bar 4) was the
  //     16 Sep Nifty PE −₹351 Live cut. TRAIN+OOS: turning it off raises
  //     Jun–Sep option ₹ vs 15.8, keeps August CLOSE n=0, and still lets the
  //     rupee STOP + TIME hold cap run. Re-arm only if a later OOS shows
  //     stall-bleed TIME cannot cover.
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
    wallMode: 'intraday', retest: true, confirm: 'retest', confirmAfterBreakout: true, timeStopBars: 6, maxRetestBars: 2,
    // 15 Sep 2026 hold-to-close blew August paper: option ₹20,163 profit vs
    // ₹30,444 loss (NET −₹10,281), 20 CLOSE holds = −₹18,137. TIME 6 (30 min)
    // on the same entries flips Aug to +₹7,875 and keeps Jun/Jul/Sep green.
    // FAIL stays off (1-bar wall close still scratches the move). TARGET 0.
    // 15.5 added stall give-up (no +12 by bar 4). 15.9 turns it OFF: it is a
    // shared Paper===Live early cut the desk hates, and on Kite 5m 2026-01..
    // 09-16 it is not required for August (CLOSE n=0 with TIME 6 + rupee stop).
    lockArmPts: 0, lockAtPts: 0, giveUpBar: 0, giveUpMinPts: 0,
    minScore: 1,
    capStopToDayBudget: true,
    failStop: false,
    targetByScore: { 1: 0, 2: 0, 3: 0 },
    // 15.8: STRUCTURE take-profit OFF. The chart still draws the box; we do
    // not flatten when the index completes it. Walk-forward TRAIN 2021-01..
    // 2025-12 (60/60 green, closeN=1) preferred TIME 6 + box off over TIME 0
    // (TIME 0 recreates August CLOSE bleed on 2026 OOS).
    structureExit: false,
    minStructurePts: 0,
  }),
  // Bank — 8 bars (40 min) TIME. 15.6 was TIME 6; 16 Sep hunt on Jun–Sep
  // option ₹ (Trade Bot month UI) lifts TIME 8 to ₹108,303 vs 15.6 ₹103,089
  // with every month still green (Aug ₹9,957 → ₹10,648). TIME 0 / session
  // hold is rejected (Aug CLOSE bleed). Nifty stays TIME 6 — TIME 8 there
  // turns the 16 Sep 11:50 PE into a STOP and drops Jun–Sep net.
  // 2026-08-10→09-08 looked better at 4-bar TIME (one loser −40.6 → −8 pts).
  // Kite 5m 2026-06-01→09-14 (live token) reverses that: 4-bar TIME
  //   loss ₹6,142 → ₹7,469  net ₹79,698 → ₹77,792  (one extra loser).
  // Keep 6. This is still NOT a price stop.
  // Arm level swept on both windows; +10 is the most profitable overall AND
  // loses less than the +12 it replaced:
  //   +6  train Rs266,895  test Rs190,685  combined Rs457,580  loss -Rs24,010
  //   +8  train Rs251,023  test Rs201,980  combined Rs453,003  loss -Rs30,684
  //   +10 train Rs259,113  test Rs206,867  combined Rs465,981  loss -Rs42,343  <-
  //   +12 train Rs248,759  test Rs211,022  combined Rs459,780  loss -Rs58,488
  //   +15 train Rs257,306  test Rs201,411  combined Rs458,716  loss -Rs95,574
  // Train and test disagree on the single best value (train likes +6, test
  // likes +12), so the combined figure is used rather than either alone.
  // The same audit run on Nifty applies here even more strongly: 75% of Bank's
  // losing trades reached +10 pts or more before reversing (Nifty was 50%), and
  // 30 of 76 got within 5 pts of the +20 target. Locking at +5 once +12 is
  // reached cuts total losses 60% (-Rs146,767 -> -Rs58,488) while net edges up.
  // NOT applied to Bank, each measured and rejected:
  //   giveUpBar/MinPts — costs Rs47k of net (b2<8: Rs162,875 vs Rs211,602).
  //     Bank enters on the raw breakout, not a retest, so there is more early
  //     noise and it needs longer to get going than Nifty does.
  //   [SUPERSEDED] "maxRetestBars not applicable, Bank has no retest entry" —
  //     the retest was simply never TRIED on Bank. It is now enabled and is the
  //     single biggest improvement this book has had (see below).
  //   entry filters   — no LOWER bound helps; body size, extension and
  //     confidence score all return 92-98% win across every bucket. An upper
  //     body cap did help while Bank entered on the raw breakout, but the
  //     retest supersedes it (see below).
  //   failStop — still harmful on this window (Aug −₹335, not green).
  //   rupee cut-off WITHOUT TIME (session hold) — still harmful: Bank ₹5,000
  //     alone made Aug −₹11,044. WITH TIME 6 the recovery those stops killed
  //     does not happen inside 30 min, so Bank ₹2,500 RAISES Jun–Sep net
  //     ₹51,936 → ₹59,175 and keeps every month green.
  //   capStopToDayBudget is NOT set here, and cannot be: it only tightens an
  //     existing stop, and Bank deliberately has none. Giving Bank a Rs3,500
  //     stop so the day cap could bind turns +Rs211,022 into -Rs211,330
  //     (PF 6.06 -> 0.64) and produces 84 days past -Rs3,500 instead of 3.
  //     Bank's worst day (-Rs10,383) must be managed by LOT SIZE, not a stop.
  //   RETEST ENTRY (retest + maxRetestBars 2). Never tried on Bank until now,
  //     and it changes the book the way it changed Nifty: do not enter on the
  //     breakout close, wait for price to pull back to the broken level.
  //     Untouched TEST window, versus the old raw-breakout entry:
  //       raw breakout   net Rs202,361  losses -Rs30,824  PF 10.2  worst -Rs5,899
  //       retest + mrb2  net Rs301,110  losses  -Rs8,580  PF 44.7  worst -Rs3,563
  //     +Rs98,749 net, 72% less loss, worst trade cut 40%, 99% win, Rs1,145/day.
  //     Better on BOTH windows (train Rs227,609 -> Rs411,572), so not a test-set
  //     artefact. maxRetestBars 1/2/3 is a plateau (test Rs275k/Rs283k/Rs286k)
  //     that falls off a cliff at 4+ (Rs262k, losses -Rs36,844).
  //   maxBodyPts REMOVED. It was bounding the tail while Bank entered on the raw
  //     breakout, but the retest makes it redundant AND costly: with retest, no
  //     cap beats cap-150 on both windows (train Rs411,572 vs Rs354,753, test
  //     Rs301,110 vs Rs283,075) at identical -Rs8,580 losses. Requiring a
  //     pullback already excludes the spent, over-extended moves.
  banknifty: Object.freeze({
    wallMode: 'intraday', timeStopBars: 8,
    retest: true, confirm: 'retest', confirmAfterBreakout: true, maxRetestBars: 2,
    failStop: false,
    // TIME 6 + ₹2,500 index/option stop. Product stays MIS (not NRML).
    // Not +20 TARGET. Session-hold without a stop was August's Bank CLOSE
    // bucket (CE 20 Aug −₹3,074 / −190 pts).
    // 15.9: same give-up OFF as Nifty. Bank lock 50/25 was rejected: 15 Sep
    // 13:35 PE TIME +₹1,211 became LOCK +₹323 in 10 min.
    lockArmPts: 0, lockAtPts: 0,
    giveUpBar: 0, giveUpMinPts: 0,
    targetByScore: { 1: 0, 2: 0, 3: 0 },
    // 15.8: STRUCTURE off + Bank cut ₹3,500 (was ₹2,500). TRAIN 2021-01..
    // 2025-12 freeze among TIME 6/8 anti-CLOSE variants. OOS 2026-01..09-16
    // 9/9 green, no CLOSE bucket. TIME 0 / TIME 12 vetoed (CLOSE returns).
    structureExit: false,
    minStructurePts: 0,
    // 15.6: skip Bank CE below the day's first print / PE above it (causal
    // cousin of "CE on a down day"). Jun–Sep option ₹ 98,568 → 103,089
    // (PF 3.21 → 3.49, loss ₹44,537 → ₹41,460, Aug still +₹9,957). Does not
    // scratch 15 Sep Nifty 10:35 PE TIME +₹802 or Bank 13:35 PE TIME +₹1,211.
    // Same filter on Nifty costs ₹10k net — Bank only.
    // 15.7: TIME 8 (not 6). Same session-align. Bank ₹2,500 stop stays —
    // tightening to ₹1,500 cuts 16 Sep STOP but costs ~₹12k Jun–Sep.
    // 15.8: Bank ₹3,500. Same TIME 8 / sessionAlign. 16 Sep paper STOP is
    // worse (−₹1,864 vs −₹1,354); Sep month and 2026 OOS still greener.
    sessionAlign: true,
  }),
  // Crude — had NO time exit, so losers rode to the 23:20 square-off (average
  // hold 179 min). 18 bars cuts that to ~69 min. IN-SAMPLE ONLY (89 days) and
  // still net negative: the edge is ~Rs4,270 against ~Rs27,120 of brokerage.
  // Crude — body band 20-40 + profit lock. IN-SAMPLE ONLY (89 days).
  // Crude's problem was never the exit: gross edge was ~Rs4,270 against
  // Rs27,120 of brokerage, so it needed FEWER, BETTER trades, not tighter
  // stops. Gross per trade by body size (cost is Rs120):
  //     0-20 Rs2  |  20-40 Rs79  |  40-70 -Rs60  |  70+ Rs30
  // Filtering to 20-40 raises gross per trade Rs20 -> Rs54 and gross per lot
  // Rs4,440 -> Rs9,120 on FEWER trades, which drops break-even from ~7 lots to
  // under 2. Checked on each half separately: Rs50/trade and Rs56/trade, where
  // UNFILTERED the first half loses Rs19/trade. That consistency is the point.
  // Still not profitable at 1 lot (Rs54 < Rs120 cost) — it needs 3+ lots.
  crude: Object.freeze({
    wallMode: 'intraday', timeStopBars: 18,
    minBodyPts: 20, maxBodyPts: 40,
    lockArmPts: 8, lockAtPts: 5,
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

/**
 * Paper ₹ vehicle. Live Nifty buys ATM CE/PE. Paper defaults to the same;
 * pass niftyVehicle=fut to re-price as pts × 65. Bank/Crude stay options.
 */
function paperVehicleFor(instrumentKey, liveVehicle, requested) {
  if (instrumentKey !== 'nifty') return liveVehicle || 'option';
  const v = String(requested || '').toLowerCase().trim();
  if (v === 'option' || v === 'opt' || v === 'cepe' || v === 'ce/pe') return 'option';
  if (v === 'fut' || v === 'future' || v === 'futures') return 'fut';
  return liveVehicle || 'option';
}

module.exports = {
  EXIT_RULES, CUT_LOSS_RS, LOT_UNITS, DEFAULT_LOTS, OPTION_SL_MAX_RS, exitOptsFor,
  DAY_LOSS_STOP_RS, DAY_PROFIT_TARGET_RS, MAX_TRADES_PER_DAY, paperVehicleFor,
  STRATEGY_ID: 'sr-breakout',
  STRATEGY_VERSION: 'sr-breakout.2026-09-17.1',
};
