# PHASE 2.6 — DATA AUDIT + FIRST REAL BACKTEST
2026-08-28. No orders placed. No live trading.

## TWO CORRECTIONS TO PHASE 2.5

1. I said Phase 3 was ~3 years of forward collection away. WRONG, and wrong
   because I assumed instead of testing. Kite serves NIFTY 5-minute and
   1-minute INDEX candles back to 2015 — 215,188 bars over 2,881 sessions,
   zero failed windows. And NSE F&O bhavcopy serves DAILY option OHLC for
   every contract including expired ones, back to 2015, free. The data
   largely existed. You were right to push.

2. The apparent edge found in the first pass was LOOK-AHEAD. Detail below.

## A. DATA AUDIT

  INDEX INTRADAY   NIFTY 50, NSE, 5-min, 2015-01-09 -> 2026-08-27
                   215,188 bars / 2,881 sessions / 74.7 per session
                   (expected 75 for 09:15-15:30) / 0 failed fetch windows
                   OHLC yes, volume n/a for index, timestamps IST from Kite
  OPTION INTRADAY  NOT AVAILABLE. Expired contracts drop out of Kite's
                   /instruments, so their tokens are unresolvable; the local
                   archive stores metadata only and is currently inert.
  OPTION DAILY     AVAILABLE AND COMPLETE. NSE F&O bhavcopy, both legacy
                   (2015-2024) and UDiFF (2024+) formats verified fetchable.
                   Carries expiry, strike, CE/PE, OHLC, settle, OI, volume,
                   UNDERLYING PRICE and lot size. Survivorship-complete:
                   each day's file lists every contract alive that day.
  ON DISK ALREADY  2,858 equity bhavcopy days, 2,874 MTO days, Nifty daily
                   close, 1.33M announcements, corp actions.

## B. BACKTEST READINESS

  >>> BACKTEST READY WITH LIMITATIONS <<<

  READY: the index-level entry signal is fully testable on 11 years of real
  5-minute data with no look-ahead and no modelling. This is decisive on its
  own — an entry with no directional edge on the index cannot be rescued by
  any option overlay.
  LIMITATION: intraday option premium is not observable for expired
  contracts, so option P&L must be modelled (delta + theta + explicit
  slippage). Daily option OHLC can calibrate and validate that model but
  cannot resolve it to 5-minute granularity.

## C. BASELINE BACKTEST — AND THE LOOK-AHEAD IT EXPOSED

FIRST PASS, entry at the engine's reported signal.entryPrice:

  Window   n     signed 45-min move   t-stat      matched-random control
  DEV     2744         +4.42 pts       12.98        -0.01 pts  (t=-0.03)
  VALID   2316         +9.13 pts       13.30        +1.15 pts  (t= 1.34)
  TEST    1926         +9.21 pts       10.83        -1.36 pts  (t=-1.47)
  ALL     6986         +7.30 pts       20.63        -0.05 pts  (t=-0.11)

That looks like a large, robust, control-verified edge in all three windows.
It is not real.

THE LOOK-AHEAD, MEASURED DIRECTLY:

  signal.entryPrice lies INSIDE the signal bar's own high/low range in
  100.0% of 6,986 signals.
  mean signed( barClose  - entryPrice ) = +6.67 pts
  mean signed( nextOpen  - entryPrice ) = +6.67 pts

The engine reports an intrabar level (the pierce/reclaim price) as the entry.
By the time that bar has CLOSED and the signal exists, price has already
moved ~6.7 points past it in the signal direction. That 6.67 pts is
essentially the entire apparent edge of 4.42-9.21 pts.

SECOND PASS, entry forced to the NEXT BAR'S OPEN (earliest obtainable price):

  Window   signed 45-min move   t-stat
  DEV           +0.04 pts        0.12
  VALID         +1.62 pts        2.46
  TEST          +0.27 pts        0.33

The edge disappears. What remains is indistinguishable from zero.

FULL TRADE SIMULATION, realistic fill, pre-declared grid stop {15,20,25,30}
x target {1.5,2,2.5}R, selection on DEV only, slippage 1.0 pt, theta Rs40:

  ALL TWELVE CONFIGURATIONS LOSE, IN ALL THREE WINDOWS.
  DEV expectancy      -Rs121 to -Rs127 per trade   PF 0.51-0.54
  DEV-selected (stop 20 / 2.5R):
     DEV   n=2744  win 35.8%  exp -Rs121  PF 0.54  t=-12.64
     VALID n=2316  win 40.2%  exp  -Rs84  PF 0.77  t= -5.40
     TEST  n=1926  win 36.3%  exp -Rs134  PF 0.68  t= -7.49

  Sensitivity: still negative at the most generous assumption tested
  (0.5 pt slippage, Rs40 theta): DEV -Rs105, VALID -Rs67, TEST -Rs118.

  Observed win rate 35.8-40.2% against a ~49% breakeven. Exactly what the
  Phase 2 arithmetic predicted.

## D. STOP ANALYSIS (empirical, real paths, 45-min hold)

  MAE percentiles at real signals, index points:
    Window   median   p75    p90    p95
    DEV        5.2    12.3   22.3   30.7
    VALID      8.7    22.8   42.1   54.9
    TEST      11.3    27.8   47.5   63.3

  % of signals stopped by noise before 45 min:
    stop 15pt  DEV 19%  VALID 36%  TEST 42%
    stop 20pt  DEV 12%  VALID 29%  TEST 34%
    stop 25pt  DEV  8%  VALID 22%  TEST 28%
    stop 30pt  DEV  5%  VALID 17%  TEST 22%

  R-multiple reachability within 45 min (DEV, survivors only):
    stop 20pt -> 31% reach 1R, 15% reach 1.5R, 8% reach 2R, 2% reach 3R
  The DNA's 3.5R target is reached by ~2% of trades inside the holding
  period. V1's 24.8-pt stop is NOT supported: MAE dispersion roughly doubles
  from DEV to TEST, so no single fixed point-stop is stable across regimes.
  Moot in any case — with no edge there is nothing for a stop to protect.

## E. LIMITATIONS THAT COULD MATERIALLY BIAS RESULTS

  1 Option P&L is modelled (delta 0.5 flat, theta Rs40, slippage as a point
    charge). Real fills would include spread, IV skew and gamma. Direction
    is unaffected: the index-level edge is ~zero before any option layer.
  2 Same-bar stop/target ambiguity resolved as STOP-first (conservative).
  3 Entry at next-bar open ignores the sub-bar path; a limit order might do
    better or might not fill at all. Not modelled.
  4 Expiry-day and T-1 not separated (needs the F&O expiry calendar). Given
    the null result this cannot rescue anything, but it is a real gap.
  5 6,986 trades over 2,706 sessions are NOT independent observations —
    up to 3 per session. Session-clustered errors would widen the intervals,
    which only weakens an already-null result.

## F. SAFETY

  Real orders placed:        NO
  Orders modified/cancelled: NO
  realOrders default:        false (LiveBroker constructed realOrders:false;
                             live requires realOrders:true in the Start
                             payload AND a pushed Kite token)
  liveGreenStartConfig():    STILL PRESENT, returns realOrders:true, called
                             by nothing. RETAINED ONLY BECAUSE THIS PHASE
                             MODIFIES NO CODE. Recommend deletion.
  Backtest order capability: DISABLED — both scripts are pure functions over
                             a local JSON file and import no broker module.

## LIVE DEFECT UNCOVERED BY THIS TEST

  This is not only a backtest artifact. live.worker.js toLiveOpen() sets
  indexEntry = replayOpen.entry, i.e. the same unobtainable intrabar price,
  and live-broker.js derives the protective stop from
  indexRisk = |indexEntry - indexStop|. The live system therefore anchors
  its risk calculation to a price it never actually got, understating true
  risk by ~6.7 index points on average. Add to the audit defect list.

## G. RECOMMENDATION

  >>> PROCEED TO RESEARCH <<<

  Meaning precisely: the DATA and the HARNESS are now validated and ready —
  11 years of real intraday index data, a leakage-free replay, a matched
  control, a pre-declared grid, and cost/slippage sensitivity. What is
  missing is a valid ENTRY. The existing Trap V2 entry is disproven under
  realistic execution and must not be deployed.

  LIVE TRADING: NO-GO. Unchanged and unconditional.
