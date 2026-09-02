# PHASE 4.D — ORB + SUPPORT/RESISTANCE PULLBACK
2026-08-29 · research only · no order placed, modified or cancelled
Frozen spec hash f2d76428f1626046 (written BEFORE any result was inspected)

## 1. SAFETY — PASS
  Zero reachable realOrders:true / placeOrder / modifyOrder / cancelOrder /
  live-broker / kiteService / live worker. Research script imports fs, path and
  the repo cost module only. Production trading code unmodified.

## 2. REPRODUCTION — PASS (both required baselines)
  Phase 2.9c : compression vol-matched 1.21, t = 3.90                     EXACT
  Phase 4.A  : A12 DEV +0.053 t=4.70 · VALID +0.082 t=5.34                EXACT
               A4  DEV +0.038 t=4.40 · VALID +0.081 t=6.58                EXACT

## 3. TEST INACCESSIBILITY
  TEST (>= 2023-01-01) is PHYSICALLY EXCLUDED at data load — the discovery
  script filters it out before any analysis, so it cannot be inspected even
  accidentally. Sessions loaded: 1,487 (2017-01-02 .. 2022-12-30).

## 4. FROZEN SPECIFICATION (before results)
  OPENING RANGE   OR15 = first 3 bars · OR30 = first 6 bars
  BREAKOUT        a bar CLOSES beyond ORhigh (long) / ORlow (short)
  PULLBACK        price returns within 0.15% of the broken OR level
  CONFIRMATION    a later bar CLOSES back beyond that level in breakout direction
  ENTRY           OPEN of the bar AFTER confirmation (next-bar-open rule)
  S/R ZONE        CAUSAL ONLY — prior-session high/low/close and prior-5-session
                  high/low, all known before the session opens. "Confluence" =
                  broken OR level within 0.30% of such a level. No future highs,
                  no future pivots, no session-end information.
  FREQUENCY       max ONE event per stock per session, FIRST confirmation only
  HORIZONS        30m · 60m · EOD (frozen)
  UNIVERSE        26 NSE equities chosen by liquidity BEFORE 2017-01-01
  COSTS           statutory 0.106% · full 0.306% (0.10%/side slippage)
  LIBRARY         8 conditions x 3 horizons = 24 tests
                  Bonferroni 0.05/24 -> |t| > 3.06

## 5. RESULTS — ALL 24 TESTS

  cond  setup                  hz   | DEV diff     t   | VALID diff     t
  V1    OR15 pull   continue   30m  |  -0.024   -2.66  |   -0.022    -1.92
  V1    OR15 pull   continue   60m  |  -0.028   -2.04  |   -0.025    -1.51
  V1    OR15 pull   continue   EOD  |  -0.001   -0.04  |   -0.008    -0.23
  V2    OR30 pull   continue   30m  |  -0.007   -0.95  |   -0.019    -1.77
  V2    OR30 pull   continue   60m  |  -0.008   -0.73  |   -0.012    -0.82
  V2    OR30 pull   continue   EOD  |   0.001    0.03  |    0.016     0.51
  V3    OR15 pull+SR continue  30m  |  -0.020   -1.52  |   -0.010    -0.60
  V3    OR15 pull+SR continue  60m  |  -0.007   -0.38  |    0.009     0.41
  V3    OR15 pull+SR continue  EOD  |   0.022    0.57  |   -0.003    -0.07
  V4    OR30 pull+SR continue  30m  |  -0.009   -0.78  |   -0.016    -0.86
  V4    OR30 pull+SR continue  60m  |  -0.006   -0.34  |    0.035     1.46
  V4    OR30 pull+SR continue  EOD  |   0.019    0.54  |   -0.026    -0.53
  V5    OR15 pull   FADE       30m  |   0.033    3.92  |    0.023     1.87
  V5    OR15 pull   FADE       60m  |   0.023    1.82  |    0.024     1.31
  V5    OR15 pull   FADE       EOD  |   0.010    0.37  |   -0.002    -0.06
  V6    OR30 pull   FADE       30m  |   0.008    1.05  |    0.022     2.01
  V6    OR30 pull   FADE       60m  |   0.011    0.94  |    0.012     0.80
  V6    OR30 pull   FADE       EOD  |   0.017    0.71  |    0.005     0.17
  V7    OR15 no-pull continue  30m  |  -0.014   -1.34  |   -0.017    -1.15
  V7    OR15 no-pull continue  60m  |  -0.011   -0.79  |   -0.046    -2.44
  V7    OR15 no-pull continue  EOD  |  -0.015   -0.51  |    0.027     0.68
  V8    OR30 no-pull continue  30m  |  -0.019   -2.09  |   -0.039    -3.62
  V8    OR30 no-pull continue  60m  |  -0.014   -1.26  |   -0.031    -1.88
  V8    OR30 no-pull continue  EOD  |  -0.004   -0.15  |   -0.027    -0.82

  CANDIDATES clearing the statistical gate AND the full economic hurdle: 0
  Candidates reaching even "statistically significant": 0
  EVERY ONE OF THE 24 TESTS IS BELOW THE ZERO-SLIPPAGE STATUTORY FLOOR.

## 6. THREE FINDINGS THAT MATTER MORE THAN THE VERDICT

  A. THE ORB CONTINUATION ARM IS NEGATIVE, CONSISTENTLY.
     V1/V2 (breakout -> pullback -> continue) is negative in DEV and VALID at
     30m and 60m. V7/V8 (breakout, no pullback) is negative in 5 of 6 cells.
     Buying an opening-range breakout on these names, against a matched
     control, has lost money for six years. This is not noise around zero —
     the sign is stable across both windows and both OR definitions.

  B. THE FADE ARM IS THE POSITIVE ONE — WHICH IS THE WHOLE POINT.
     V5 (fade the ORB pullback) is positive in every DEV cell and reaches
     DEV t = 3.92, clearing the Bonferroni threshold. It then misses VALID at
     t = 1.87 (threshold 1.96) and is economically hopeless anyway: +0.023%
     against a 0.106% statutory floor.
     But the DIRECTION is consistent with Phase 4.A: this market mean-reverts
     intraday. ORB continuation is on the WRONG SIDE of a real (and too small)
     effect. The strategy is not random — it is mildly anti-predictive.

  C. THE PULLBACK ADDS NOTHING. THE S/R FILTER ADDS NOTHING.
     Pullback vs no-pullback, same OR and horizon:
       OR15 30m  -0.024 / -0.022   vs   -0.014 / -0.017   (worse)
       OR30 30m  -0.007 / -0.019   vs   -0.019 / -0.039   (better)
       OR15 60m  -0.028 / -0.025   vs   -0.011 / -0.046   (mixed)
       OR30 60m  -0.008 / -0.012   vs   -0.014 / -0.031   (better)
       OR15 EOD  -0.001 / -0.008   vs   -0.015 / +0.027   (mixed)
       OR30 EOD  +0.001 / +0.016   vs   -0.004 / -0.027   (better)
     Better in 3 of 6, worse or mixed in 3 of 6. That is noise, not value.
     The S/R confluence requirement (V3/V4 vs V1/V2) likewise moves nothing
     while costing only 6 sessions of sample — the "support/resistance zone",
     the most-cited component of this setup, has no measurable effect.

## 7. TRAP CHECKS
  look-ahead            entry is OPEN of the bar AFTER confirmation; S/R built
                        only from prior sessions; TEST excluded at load
  repeated-state        ONE event per stock per session, first confirmation only
  stock-selection bias  universe frozen from liquidity BEFORE 2017-01-01;
                        ~13% survivor skew recorded, not hidden
  volatility regime     control matched on volatility bucket
  direction imbalance   control matched on direction; long/short arms separable
  outliers              not reached — no candidate cleared the primary gates
  overfitting           8 conditions frozen in advance; no variant added after
                        seeing results; no threshold tuned

## 8. VERDICT

  >>> NO-GO <<<

  BINDING FAILURE: the economic gate, and not marginally. The largest
  control-adjusted edge anywhere in the 24 tests is 0.023% (V5, 60m, worst of
  DEV/VALID) against a 0.106% zero-slippage statutory floor — 22% of the
  automatic-failure line, and 7.5% of the full 0.306% hurdle.

  Under the frozen rules this is an AUTOMATIC FAILURE regardless of statistics.

  TEST was never opened and remains physically excluded.

  No threshold was lowered. No condition was added. The universe, cost model
  and horizon grid are exactly as frozen before results were seen.

## 9. WHAT ORB EARNED
  ORB + pullback was given a fair test, not a rigged one: a specific
  price-action setup, causal S/R, a no-pullback baseline to isolate the
  pullback's contribution, and both continuation and fade arms.
  It did not earn the right to be traded. More usefully, it produced a
  positive finding: the ORB continuation setup is on the wrong side of the
  intraday mean-reversion already established in Phase 4.A, and neither the
  pullback nor the support/resistance filter contributes measurable
  information.
