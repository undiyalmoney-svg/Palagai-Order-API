# PHASE 2.9 — HORIZON DISCOVERY + CONDITIONAL BEHAVIOUR
2026-08-28 · DEV+VALID ONLY (2015-01-09 → 2022-12-30, 147,535 bars, 1,975 sessions)
The 2023-2026 TEST window is FILTERED OUT AT LOAD and is not readable by these scripts.

## A. MARKET BASELINE — unconditional forward movement (index points)

  hz     n      mean    sd     p5      p25    p75    p95  | P|r|>1 >2  >3  >5  >10
  5m   17128    0.09    9.6  -14.1   -4.0    4.3   14.1  |  86  73  61  43  18
  10m  17127   -0.05   13.7  -20.6   -5.7    6.1   19.0  |  90  80  71  56  30
  15m  17127   -0.09   16.6  -25.7   -7.0    7.5   23.1  |  92  84  76  63  38
  30m  17127   -0.32   25.0  -38.0  -10.1   10.6   33.8  |  94  89  83  73  51
  45m  16845   -0.30   31.0  -46.6  -12.1   13.0   41.9  |  95  91  86  77  58
  60m  16002   -0.53   34.6  -54.7  -14.3   14.7   47.5  |  96  92  88  80  63
  90m  14320   -0.62   42.2  -66.7  -17.6   18.1   58.8  |  97  94  90  84  69
  120m 12636   -0.62   48.9  -78.0  -20.6   21.0   68.4  |  97  94  91  86  73

  Unconditional mean is ~0 at every horizon; sd grows ~sqrt(t). Movement is
  abundant (86% of 5-min windows move >1 pt) — the scarcity is DIRECTION.

## B. HORIZON MAP — DIRECTIONAL (signal minus matched control, index pts)
  8 events x 8 horizons x 2 outcomes = 128 tests. Bonferroni |t| > 3.65.

  event                          n     5m    10m    15m    30m    45m    60m    90m   120m
  A extreme bar 3sig            600   1.13  3.24  4.38*  9.61*  8.92*  8.19  11.41  15.77
  B OR30 breakout              1908   0.49 -0.32  -0.38  -0.09  -0.06 -0.60   0.05  -0.55
  C failed OR30 break          1769  -0.78 -1.10  -1.23  -0.92  -1.46 -1.30  -1.11   0.85
  D sweep/reject extreme        535  -1.11 -1.96  -1.66  -2.69  -4.43 -4.29  -6.83  -7.78
  E compression -> expansion   1762   0.94  0.93   1.21   1.83   1.72  1.36   2.29   2.35
  G gap>p75 first bar           490   0.26 -0.78   0.48   2.60   1.00  0.74   2.00   4.52
  H trend break                1966   0.26 -0.09  -0.32   0.13  -0.71 -0.85  -1.69  -1.36
  (F 2sig+rejection: 13 events, too few)

  ONLY event A clears Bonferroni directionally — AND EVENT A IS C2-3, WHICH
  ALREADY FAILED TEST IN PHASE 2.8. It is dead and is not re-promoted here.
  It appears in this table solely as evidence that DEV+VALID appearance is not
  reality. Every other event is directionally flat.

## C. THRESHOLD CROSSING — AND A BUG I HAD TO FIX

  My first threshold table showed P(+1 before -1) = 88.2% for the signal and
  83.7% FOR THE RANDOM CONTROL. A control must be ~50%. The cause: my
  first-hit loop tested `up` before `dn`, so any bar touching both levels was
  recorded as '+'. The absolute numbers were meaningless.

  Re-run resolving same-bar ties ADVERSELY (conservative bound):

  event                          n  | +1/-1 ctrl | +3/-3 ctrl | +5/-5 ctrl
  A extreme bar 3sig            600 | 16.0  18.0 | 31.8  36.2 | 40.0  42.5
  E compression -> expansion   1762 | 18.5  19.9 | 34.4  38.1 | 42.8  45.2
  G gap>p75 first bar           490 | 15.5  14.7 | 28.8  33.7 | 43.5  39.0
  D sweep/reject extreme        535 | 16.6  18.9 | 35.1  35.3 | 43.6  40.7

  (These are a LOWER bound — ties always go adverse. Truth lies between this
  and the earlier upper-bound table.) The decisive point is unaffected by the
  bound: SIGNAL <= CONTROL in almost every cell. No event improves the odds of
  reaching a tradeable +3 points before an adverse 3 points. This kills the
  threshold-edge hypothesis outright.

## D. MAGNITUDE / VOLATILITY — THE ONE REAL EFFECT

  E[|return|] ratio, signal / matched control (>1 = event predicts BIGGER moves):

  event                     5m     10m    15m    30m    45m    60m    90m   120m
  A extreme bar 3sig      1.47*  1.42*  1.33*  1.30   1.21   1.22   1.19   1.14
  E compression->expansion1.19*  1.08   1.13   1.13   1.15   1.08   1.07   1.11
  G gap>p75 first bar     1.24   1.26   1.31*  1.26   1.42*  1.35   1.36   1.34
  B/C/D/H                 ~1.00 — nothing

  REGIME STABILITY (E[|ret45|] ratio, fixed chronological blocks):
                          2015-2017   2018-2020   2021-2022
  A extreme bar            1.18(268)   1.29(212)   1.18(120)
  E compression            1.21(690)   1.29(661)   1.10(411)
  G gap>p75                1.34(130)   1.70(185)   1.21(175)
  D sweep/reject           1.00(159)   1.02(188)   0.98(188)

  OUTLIER ROBUSTNESS (E[|ret45|] ratio):
  event              full  trim1%  trim5%  MEDIAN-ratio
  A extreme bar      1.18   1.17    1.17      1.24
  E compression      1.20   1.18    1.18      1.16
  G gap>p75          1.50   1.42    1.43      1.36
  D sweep/reject     1.06   1.04    1.04      1.07

  The median ratio is the key number: 1.36 for G and 1.16 for E means the
  WHOLE DISTRIBUTION shifts, not a few extreme days. This is the opposite of
  C2-3, whose mean inverted when 10 trades were removed.

  So: a large overnight gap, and an intraday volatility compression, both
  reliably predict LARGER SUBSEQUENT MOVEMENT — positive in all three
  chronological blocks, robust to trimming, and separated from a
  direction-and-time-matched control. They predict NOTHING about direction.

## E. TIMING SIGNATURES (cumulative signal-minus-control, index pts, by bar)

  event              bar: 1    2    3    4    6    9   12   18   24
  A extreme bar          1.0  2.3  2.5  3.0  4.2  4.0  2.8  3.5  5.6
  E compression          0.3  0.1 -0.2 -0.3 -0.8 -2.0 -1.9 -0.6 -0.0
  G gap>p75              1.1 -0.1  1.5  1.3  2.3  0.8  1.0 -0.3  1.8
  D sweep/reject         0.2  0.1  0.2 -0.4  0.5  0.4  0.7 -0.6 -0.3

  Only A has a coherent directional build — and A failed TEST. E actually
  turns NEGATIVE directionally while its magnitude effect stays positive:
  a textbook example of volatility without direction.

## F. FALSE DISCOVERIES
  F1 Threshold-crossing "edge" of 72-88% — entirely my own same-bar ordering
     bias. Found and corrected. Corrected result: no edge.
  F2 Event A directional strength (up to +9.61 pts at 30m, Bonferroni-passing
     in DEV+VALID) — already refuted on TEST in Phase 2.8. Retained here only
     as a caution.
  F3 Event D directional drift (-7.78 pts at 120m) — fails Bonferroni, and its
     magnitude ratio is ~1.00 across every regime block. Noise.
  F4 Event E directional (+2.35 at 120m) — timing signature is negative in the
     middle of the path; not a coherent mechanism.

## G. CURRENT BEST RESULT  [CORRECTED IN 2.9c — SEE BELOW]

  >>> VOLATILITY EDGE <<<   (explicitly NOT directional)

  CORRECTION: section 11 of the brief asked for a VOLATILITY-REGIME-MATCHED
  control and my first pass did not implement one. With that control added
  (2.9c), the GAP effect DISAPPEARS ENTIRELY and only COMPRESSION survives.
  See "PHASE 2.9c" at the end of this document. The headline below overstated
  the result and is superseded.

  Large overnight gap (>75th pct) and intraday range compression both predict
  a 1.16-1.50x increase in subsequent absolute movement, stable across three
  chronological blocks and robust to outlier trimming.

  NO DIRECTIONAL EDGE. NO THRESHOLD EDGE.

  ECONOMIC CAVEAT, stated plainly: a magnitude edge cannot be traded
  long-or-short on the index. It is expressible only through options
  (straddle/strangle), and option implied volatility very likely already
  prices a known gap day. Whether the realised-vs-implied gap is exploitable
  is UNTESTED and is not claimed. Daily option IV is reconstructable from the
  NSE F&O bhavcopy already verified in Phase 2.6 — that is the test that
  would settle it, and it has not been run.

## H. TEST STATUS
  OLD TEST (2023-2026): CLOSED — used once for C2-3, contaminated.
  NEW TEST: DOES NOT EXIST. No untouched historical segment remains.
  Therefore NO historical out-of-sample validation is claimed for the
  volatility effect. It is a DEV+VALID finding only.

## I. RECOMMENDATION

  >>> MOVE TO FORWARD SHADOW TEST <<<

  The volatility effect is the first result in this programme to survive
  matched controls, fixed-block regime stability AND outlier trimming
  simultaneously. But it has no clean historical out-of-sample window left,
  and it is not directional, so it cannot be traded as a long/short index
  system. Forward shadow observation is the only honest validation path.

  LIVE TRADING: NO-GO. Unchanged and unconditional.

## SAFETY
  Real orders placed NO · modified NO · cancelled NO · broker trading calls NONE.
  All scripts read one local JSON file and import no broker module.
  realOrders default false. liveGreenStartConfig() still present and unused —
  recommend deletion (no production code modified in this phase).


# PHASE 2.9c — GAPS CLOSED, AND A CORRECTION TO MY OWN HEADLINE

Brief sections 8, 10, 11 and 12 were not fully executed in the first pass.
Section 11 (volatility-regime-matched control) turned out to be decisive.

## THE DECISIVE TEST
Control matched on time-of-day AND trailing-20-bar realised-volatility decile
AND direction — so the control is drawn from bars that were ALREADY as
volatile as the signal bar.

  event                      n    | plain control      | VOL-MATCHED control
  G gap>p75 first bar        490  | ratio 1.35 t=3.27  | ratio 0.96  t=-0.40
  E compression -> expansion 1762 | ratio 1.17 t=3.32  | ratio 1.21  t= 3.90

  GAP IS REFUTED. The entire gap "magnitude edge" was a volatility-regime
  confound: a large overnight gap marks a day that is already volatile, and
  once you condition on that volatility the gap itself adds NOTHING
  (ratio 0.96). Confirmed across every measure:
      squared return 0.99 · summed range 1.01 · MAE+MFE 1.03
  My Phase 2.9 headline claimed a 1.50x gap effect. That was wrong, and it was
  wrong because I omitted the control the brief explicitly asked for.

  COMPRESSION SURVIVES — and strengthens under the stricter control
  (1.17 -> 1.21, t 3.32 -> 3.90). Economically this is coherent: conditional
  on volatility being LOW right now, subsequent volatility is higher than that
  low baseline implies. It is volatility mean-reversion, and matching on the
  current regime is exactly the condition under which it should show up.

## OTHER VOLATILITY MEASURES (vs vol-matched control)
  event                     |abs ret|  sq ret  sum range  MAE+MFE
  G gap>p75                    1.02     0.99      1.01      1.03   <- dead
  E compression                1.30     2.80      1.17      1.20

  E's squared-return ratio of 2.80 is a variance ratio, and it is large.

## PLACEBO TIMING (section 12) — magnitude ratio as entry is delayed
  event               +0     +1     +2     +3     +5 bars
  G gap>p75          1.16   0.95   1.05   0.94   0.98   <- no signature: noise
  E compression      1.18   1.20   1.11   1.10   1.05   <- decays: timing-specific

## FIRST vs SUBSEQUENT OCCURRENCE (section 10)
  event               first  n      subsequent  n
  G gap>p75           1.14   490      1.04   29230
  E compression       1.20  1762      1.08    2805

  E is stronger on FIRST occurrence and attenuates on repeats — the behaviour
  of a genuine event rather than a persistent state.

## CORRECTED CONCLUSION

  CURRENT BEST RESULT: VOLATILITY EDGE — ONE MECHANISM ONLY.

  MECHANISM: intraday volatility compression (a bar whose range exceeds 2x the
  trailing 20-bar average range, after a low-range period) predicts elevated
  subsequent realised volatility over the next 45 minutes — |return| ratio
  1.21 and variance ratio 2.80 against a control matched on time-of-day,
  direction AND current volatility regime. Regime-stable across 2015-2017,
  2018-2020, 2021-2022. Outlier-robust (median ratio 1.16). Decaying placebo
  signature. Stronger on first occurrence.

  NOT DIRECTIONAL. NOT A THRESHOLD EDGE. GAP EFFECT REFUTED.

  Recommendation and TEST status are UNCHANGED: MOVE TO FORWARD SHADOW TEST,
  no untouched historical segment remains, LIVE TRADING NO-GO.
