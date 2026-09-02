# PHASE 3.3 — DIRECTIONAL EDGE DISCOVERY
2026-08-28 · research only · no orders · DEV+VALID (2015-01-09..2022-12-30)
TEST WINDOW NOT OPENED.

## A. HARNESS AUDIT (run before any hypothesis)
  dataset hash                    d83efc3b9b6feb4d
  DEV/VALID/TEST boundaries       2015-2018 / 2019-2022 / 2023-2026 (unchanged)
  next-bar-open execution         verified in source
  frozen vol-decile bounds        present on disk, reused unchanged
  REPRODUCTION CHECK              Phase 2.9c re-ran and reproduced
                                  compression vol-matched ratio 1.21, t=3.90
  No defect found; no validated mechanics were modified.

## B. DATASET
  NIFTY 5-min, 147,535 bars over 1,975 sessions (DEV+VALID slice).
  OHLC only — no volume. No quantity is called VWAP anywhere; the session
  average used in E1 is labelled a TWAP proxy.

## C/D. FROZEN HYPOTHESIS LIBRARY — 22 DISTINCT CONDITIONS
  Each is an EVENT (first occurrence per session, structural — the framework
  cannot sample a persistent state) with direction fixed BEFORE the forward
  window. Each is tested TWO-SIDED, so a continuation and its reversal are ONE
  test, not two discoveries.

  extremes  A1 |close-sma20|>2ATR · A2 close in outer 5% of 20-bar range
            A3 3-bar move>2sigma · A4 6-bar move>2.5sigma
  range     B1 range>2*avg + close in outer 25% · B2 range>3*avg (vol shock)
            B3 compression then expansion
  multiTF   C1 5m agrees with 30m · C2 5m opposes 60m · C3 large 5m with 60m
  opening   D1 first close beyond OR30 · D2 OR30 break-then-reject
            D3 gap>1sigma
  location  E1 |close-TWAP|>1.5sigma · E2 |close-session open|>2sigma
            E3 |close-prior close|>2sigma · E4 close at session extreme
  micro     F1 body/range>0.8 · F2 wick>0.6 (dir away) · F3 4+ consecutive
            F4 range acceleration
  interact  G1 2sigma move then rejection

  EXCLUDED BY DESIGN: single-bar |close-open|>3sigma continuation. That is
  C2-3, which was taken to TEST in Phase 2.8 and failed; the TEST window is
  contaminated for it and it is not retested here.

## E. CONTROL METHODOLOGY
  Direction-matched + time-of-day-matched + pre-event volatility-decile
  matched, drawn from a DIFFERENT session. Bounds frozen from DEV+VALID.
  Primary statistic is SIGNAL MINUS MATCHED CONTROL, never raw return.

## F. MULTIPLE TESTING
  22 conditions, Bonferroni alpha 0.05/22 = 0.00227 -> |t| > 3.05.

## G/H. RESULTS — DEV AND VALID
  Gate: DEV |t|>3.05 AND VALID same sign AND VALID |t|>1.96 AND
        |signal-control| exceeds the economic hurdle in BOTH windows.

  ID  n     long% | DEV diff    t   | VALID diff    t   | econ
  A1  1918   46%      0.24    0.31       3.46     2.24    no
  A2  1909   50%     -0.29   -0.37       3.96     2.49    no
  A3  1966   45%      0.22    0.32       1.95     1.30    no
  A4  1966   46%     -1.00   -1.46       1.47     0.96    no
  B1  1555   41%      1.94    1.88       1.36     0.70    no
  B2   566   36%      4.60    2.29       5.91     1.61   YES
  B3    18   too few
  C1  1966   48%      0.88    1.30       0.52     0.34    no
  C2  1965   54%      0.86    1.21      -1.03    -0.72    no
  C3  1964   44%      1.27    1.87       2.76     1.76    no
  D1  1869   45%      3.25    4.13       1.55     0.95    no
  D2  1586   52%     -0.06   -0.07      -0.99    -0.56    no
  D3  1333   77%     -0.71   -0.86      -1.15    -0.66    no
  E1  1966   47%     -0.04   -0.06       3.42     2.22    no
  E2  1966   41%      0.55    0.83      -1.17    -0.81    no
  E3  1416   59%     -0.24   -0.28       2.06     1.08    no
  E4   571   46%      2.68    1.27       6.07     1.91    no
  F1  1949   48%      0.83    1.13       2.58     1.70    no
  F2  1966   52%      0.13    0.20       0.92     0.63    no
  F3  1901   52%     -0.22   -0.28      -1.15    -0.71    no
  F4   819   42%      1.13    0.83      -1.43    -0.56    no
  G1    13   too few

  SURVIVORS: 0.
  Rejections: 19 fail DEV Bonferroni · 2 insufficient sessions ·
              1 fails VALID.

## I. TEST RESULTS
  TEST WAS NOT OPENED. No candidate satisfied the pre-declared gate, so
  under section 23 there was nothing to freeze and nothing to open TEST for.

## J. ECONOMIC ANALYSIS
  Hurdle computed from the repo cost model (charge-entry-gate.js, premium
  Rs120, qty 65, +Rs40 theta, delta 0.5): 3.13 INDEX POINTS.
  Exactly ONE condition (B2) exceeded that hurdle in both windows, and it
  failed statistically. Nineteen of 22 produced control-adjusted differences
  under ~2 points — well under half the hurdle.

## K/L/M/N. REGIME / PLACEBO / GRADIENT / OUTLIER
  Not run. These are pre-declared as tests for candidates that SURVIVE the
  DEV+VALID gate. Running them on failed hypotheses would be searching for a
  subset that works, i.e. the rescue behaviour section 24 prohibits.

## O. KNOWN-TRAP REGRESSION TESTS
  TRAP 1 intrabar entry        entry is OPEN of bar i+1, verified in source
  TRAP 2 persistent state      one event/session enforced STRUCTURALLY (break)
  TRAP 3 50/50 control         control is DIRECTION-matched; long% reported
                               per hypothesis (ranged 36-77%)
  TRAP 4 unmatched vol control vol-decile matching with FROZEN bounds
  TRAP 5 post-hoc event conv.  every hypothesis was an event by construction
  TRAP 6 mean move -> convex   no option payoff estimated from a mean move
  TRAP 7 stat sig = tradeable  economic hurdle applied as a hard gate
  TRAP 8 option before edge    no option structure examined
  LOOK-AHEAD CORRUPTION        PASS (5 probes, o*1.5 h*1.6 l*0.4 c*1.5 applied
                               to every bar after i; zero feature changes)

## P. SAFETY AUDIT
  reachable realOrders:true                 0
  research scripts importing broker module  0
  placeOrder/modifyOrder/cancelOrder paths  none
  Real orders placed: NO.

## Q. CANDIDATE RANKING AND CLASSIFICATION
  D1 first close beyond OR30      E — OVERFIT.  The ONLY condition to pass DEV
     Bonferroni (diff +3.25, t=4.13) and it collapses in VALID (+1.55, t=0.95).
     A textbook single-window artifact, caught by the chronological split.
  B2 volatility shock (range>3x)  B — STATISTICAL EDGE ONLY / underpowered.
     Same sign both windows, and the ONLY condition above the economic hurdle
     in both (DEV +4.60, VALID +5.91). But t=2.29 / 1.61 against a 3.05
     requirement. Power diagnostic: reaching |t|>3.05 at this effect size
     needs ~505 DEV events; ~283 exist. Shortfall ~1.8x, i.e. roughly 7 years
     of DEV data instead of 4. NOT promoted, NOT optimised, NOT taken to TEST.
     Note it is a cousin of C2-3, which already failed TEST — weak prior.
  E4 close at session extreme     B — same sign, large magnitude (+2.68/+6.07),
     underpowered (t=1.27/1.91), below hurdle in DEV.
  A1,A2,E1                        C — CONTROL EXPLAINED / sign-inconsistent.
     DEV differences ~0 with VALID differences +3.4 to +4.0. Opposite-window
     inconsistency is the signature of noise, not edge.
  A3,A4,B1,C1,C2,C3,D2,D3,E2,E3,F1-F4  F — FAILED. No meaningful effect.
  B3,G1                           insufficient sessions (18 and 13 events).

## R. FINAL VERDICT

  >>> NO ROBUST DIRECTIONAL EDGE FOUND. TEST NOT OPENED. <<<

  22 economically motivated directional conditions, all event-based, all
  causally executable, all control-adjusted. One passed DEV and died in
  VALID. One cleared the economic hurdle and lacked the statistical power.
  None did both.

## S. WHAT THIS EVIDENCE SAYS ABOUT THE NEXT PHASE (section 27)
  FAMILIES NOW EXHAUSTED at the 45-minute horizon on 5-minute OHLC:
    price extremes, range/volatility interaction, multi-timeframe alignment,
    opening structure, price location, bar microstructure. Six families,
    22 conditions, plus the 17 of Phase 2.7 and the 31 of Phase 2.8 — about
    70 distinct directional formulations on this data, none tradeable.

  DIMENSIONS GENUINELY UNEXPLORED (not a plan, an inventory):
    1 order-flow data — the single largest gap. Every microstructure test
      here used OHLC PROXIES because the index carries no volume. Real
      volume/bid-ask at the index-future level is a different information set.
    2 cross-asset conditioning — USDINR, crude, SGX/GIFT Nifty lead-lag.
    3 options-derived state as an INPUT to direction (skew, put/call OI shift)
      rather than as the traded instrument.
    4 longer horizons (multi-day) where the cost hurdle per unit of signal
      falls — though Phase 2.9 found direction absent at 5-120 minutes and
      Phase 438 found the same on daily equity bars.

  Honest reading of the accumulated evidence: NIFTY 5-minute OHLC has now
  been searched thoroughly enough that further hypotheses drawn from the same
  information set have low prior probability. A genuinely new INPUT is
  required, not a new formulation of the existing one.
