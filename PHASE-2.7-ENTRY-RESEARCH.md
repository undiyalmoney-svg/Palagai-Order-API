# PHASE 2.7 — CAUSAL ENTRY RESEARCH
2026-08-28. Research only. No orders placed. Live NO-GO unchanged.
dataset d83efc3b9b6feb4d (215,188 bars, 2,881 sessions) · harness p27-research.js / p27-events.js

## A. RESEARCH SUMMARY

  Hypotheses tested (primary, frozen before results)   17
  Surviving DEV at Bonferroni t>2.94                    4
  Surviving DEV + VALID as STATES                       4
  Surviving conversion to TRADEABLE EVENTS              0
  Reaching TEST                                         0
  TEST WINDOW: NEVER OPENED.

  Total tests incl. 4 event conversions = 21. Bonferroni 0.05/21 = 0.0024.

## HARNESS INTEGRITY

  Look-ahead injection test: PASS. Every bar after i is multiplied
  (o*1.5, h*1.6, l*0.4, c*1.5) at 5 probe points and every feature is
  re-computed; 0 of 5 changed. The harness aborts if any changes.
  Execution rule enforced structurally: signal from bar i -> entry at
  OPEN of bar i+1, never intrabar, never bar i close.
  Statistics session-clustered (one observation per session), because
  intra-session signals are not independent.

## B. HYPOTHESIS LEDGER (DEV mean pts / session-clustered t)

  ID  definition                                  DEV mean     t      status
  M1  ret3 continuation > median range              0.283    1.46   REJECTED ns
  M2  ret6 continuation > median range              0.135    0.64   REJECTED ns
  M3  ret12 continuation > median range             0.136    0.61   REJECTED ns
  M4  OR30 breakout continuation                   -1.403   -3.76   state-survivor
  M5  prior-session H/L breakout                   -3.628   -7.01   state-survivor
  R1  single-bar > p90 range -> fade               -0.272   -0.67   REJECTED ns
  R2  extension >1.5ATR from sma20 -> fade          1.058    3.47   state-survivor
  R3  failed OR breakout -> fade                   -5.755  -12.69   state-survivor
  R4  ret6 > 2ATR -> fade                           0.158    0.47   REJECTED ns
  V1  compression -> expansion breakout            -0.936   -1.30   REJECTED ns
  V2  range>p90 -> continuation                     0.272    0.67   REJECTED ns
  V3  range<p25 -> ret3 continuation               -0.029   -0.16   REJECTED ns
  S1  3-bar HH+HL / LH+LL structure                 0.002    0.01   REJECTED ns
  S2  >=3 consecutive directional bars             -0.054   -0.25   REJECTED ns
  G1  gap>0.3% -> continuation                     -0.033   -0.08   REJECTED ns
  G2  gap>0.3% -> fade                              0.033    0.08   REJECTED ns
  G3  small gap -> ret6 continuation               -0.044   -0.16   REJECTED ns

  EVENT CONVERSIONS (one signal per session, the only tradeable form):
  ID     DEV mean    t     VALID mean    t     matched control (DEV)   status
  E-M4      0.48    0.80       0.24     0.14        -0.95 (t=-1.47)   REJECTED
  E-M5      0.28    0.41       0.62     0.36        -0.62 (t=-0.79)   REJECTED
  E-R3     -1.41   -2.57      -0.29    -0.21        -1.27 (t=-1.97)   REJECTED
  E-R2     -1.28   -2.20       0.88     0.60         0.95 (t= 1.63)   REJECTED

## C. TOP CANDIDATES

  NONE. No candidate survived to the candidate stage. Nothing was frozen,
  so nothing was eligible for TEST.

## D. FALSE DISCOVERIES — THE CENTRAL FINDING

  D1  THE STATE / EVENT ILLUSION. M4, M5, R2 and R3 all passed DEV at
      Bonferroni AND replicated in VALID with the same sign. R3 reached
      t = -12.69 in DEV and -9.93 in VALID, with a direction-matched
      control at ~0. It looked overwhelming.

      It was an artifact of averaging over a PERSISTENT STATE. R3 fired
      25,533 times across 878 sessions — 29 signals per session. "Price is
      below the OR high after exceeding it" is a condition that stays true
      for most of a session; sampling it every 5 minutes is not 25,533
      observations, and it is not 25,533 tradeable entries.

      Converted to one event per session — the only executable form — the
      effect vanished:
          R3   state -5.755 (t=-12.69)  ->  event -1.41 (t=-2.57), VALID -0.29 (t=-0.21)
      and its direction-matched control moved with it (-1.27, t=-1.97), so
      signal minus control = -0.14 points. The residual information is zero.
      What survived clustering was a TIME-OF-DAY effect the control also
      captured, not information in the signal.

  D2  DIRECTION-IMBALANCE CONTROL FLAW (mine, caught and fixed mid-phase).
      My first control drew random 50/50 direction, which cannot detect a
      signal that is simply short more often than long in a rising market.
      Re-run with a DIRECTION-MATCHED control. It did not change the
      conclusion (control means stayed ~0.08-0.25 with signals at 1-6 pts,
      and direction balance was 47-51%), but the first version could not
      have ruled the confound out.

  D3  SIGN INSTABILITY. E-R2 was -1.28 in DEV and +0.88 in VALID. A sign
      flip across chronological windows is the signature of noise.

  D4  MOMENTUM FAMILY IS FLAT. M1/M2/M3 gave 0.14-0.28 pts at t = 0.6-1.5
      across 22,000-40,000 signals. With that sample, "not significant"
      means the effect is genuinely near zero, not merely unmeasured.

## ECONOMIC THRESHOLD

  1 index point ~ Rs32.5 gross on one NIFTY lot (65 units x delta 0.5).
  Round-trip cost Rs57-71 plus theta ~Rs40 => a trade must capture
  ~3.0-3.4 INDEX POINTS just to break even.

  The largest event-level effect measured anywhere in this phase was 1.41
  points, in one window, unreplicated. Nothing came within half the
  break-even threshold.

## E. CURRENT BEST EDGE

  NONE DEMONSTRATED.

## F. RECOMMENDATION

  >>> NO EDGE — CONTINUE RESEARCH <<<

  The harness is the asset and it is now proven twice over: it caught the
  Trap V2 intrabar look-ahead in Phase 2.6, and the state/event illusion
  here. Both were results that looked publishable and were worth nothing.

  LIVE TRADING: NO-GO. Unchanged and unconditional.

## SAFETY

  Real orders placed:        NO
  Orders modified/cancelled: NO
  Broker calls this phase:   NONE — both scripts read one local JSON file
                             and import no broker module
  realOrders default:        false
  liveGreenStartConfig():    STILL PRESENT, returns realOrders:true, called
                             by nothing. NOT deleted — this phase modifies
                             no production code. Recommend deletion.
