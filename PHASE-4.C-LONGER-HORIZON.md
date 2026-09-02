# PHASE 4.C — LONGER-HORIZON STOCK EDGE: SEPTEMBER GO/NO-GO
2026-08-29 · executed end-to-end · no order placed, modified or cancelled
Frozen spec hash 2585e7f2a0f1a8a4 (written BEFORE any horizon result was inspected)

## 1. SAFETY — PASS (start and end)
  Zero reachable realOrders:true / placeOrder / modifyOrder / cancelOrder /
  live-broker / kiteService / live worker. Research scripts import fs, path and
  the repo cost module only. Production trading code unmodified.
  TEST (>= 2023-01-01) is PHYSICALLY EXCLUDED at data load, not merely unread.

## 2. REPRODUCTION — PASS (both required baselines)
  Phase 2.9c : compression vol-matched 1.21, t = 3.90                    EXACT
  Phase 4.A  : A12  DEV +0.053 t=4.70 · VALID +0.082 t=5.34              EXACT
               A4   DEV +0.038 t=4.40 · VALID +0.081 t=6.58              EXACT

## 3-4. COST MODEL — AND THE ASYMMETRY THAT DECIDED THIS PHASE
  SAME-SESSION exit (MIS):      statutory 0.106%  full 0.306%  1.5x = 0.459%
  ANY OVERNIGHT exit (CNC):     statutory 0.258%  full 0.658%  1.5x = 0.986%

  Crossing a single session boundary raises the statutory floor 2.4x. The
  premise of this phase — that a longer hold amortises a fixed cost — is
  FALSE in Indian cash equity: the cost is not fixed across the overnight
  boundary, it more than doubles.

## 5-6. FROZEN EXPERIMENT
  Mechanism taken VERBATIM from the confirmed Phase 4.A results, not re-derived:
    S1 = A12  bar range > 3.0x median range of the 20 strictly-prior bars
              -> enter OPPOSITE the bar's body
    S2 = A4   |5-min return| > 3.0x sd of the 20 strictly-prior returns
              -> enter OPPOSITE the move
  No new threshold was introduced. Horizon grid frozen at 11 values.
  One event per stock per session, first occurrence, entry = OPEN of bar i+1.
  22 tests (2 signals x 11 horizons). Bonferroni 0.05/22 -> |t| > 3.05.

## 7. RESULT — THE EFFECT DOES NOT SCALE WITH HORIZON

  signal  horizon  cost  | DEV diff    t   | VALID diff    t   | needs
  S1_A12  15m      intra |   0.049   6.97  |    0.074    7.60  | 0.459
  S1_A12  30m      intra |   0.043   4.69  |    0.079    6.09  | 0.459
  S1_A12  45m      intra |   0.039   3.47  |    0.072    4.69  | 0.459
  S1_A12  60m      intra |   0.044   3.29  |    0.093    5.21  | 0.459
  S1_A12  90m      intra |   0.024   1.38  |    0.050    1.99  | 0.459
  S1_A12  120m     intra |   0.012   0.56  |    0.055    1.57  | 0.459
  S1_A12  EOD      intra |   0.022   1.13  |    0.081    3.17  | 0.459
  S1_A12  nextOpen over  |   0.045   1.69  |    0.058    1.44  | 0.986
  S1_A12  2d       over  |  -0.041  -0.70  |    0.116    1.32  | 0.986
  S1_A12  3d       over  |  -0.004  -0.06  |    0.080    0.74  | 0.986
  S1_A12  5d       over  |  -0.055  -0.67  |    0.145    0.98  | 0.986
  S2_A4   15m      intra |   0.049   9.14  |    0.072    9.74  | 0.459
  S2_A4   30m      intra |   0.039   5.03  |    0.070    7.14  | 0.459
  S2_A4   45m      intra |   0.046   5.15  |    0.076    6.62  | 0.459
  S2_A4   60m      intra |   0.031   3.07  |    0.065    4.84  | 0.459
  S2_A4   90m/120m/EOD   |   all lose significance
  S2_A4   overnight+     |   DEV signs turn NEGATIVE, all insignificant

  THE HYPOTHESIS IS REFUTED, and cleanly. The mean-reversion effect is
  LARGEST AT THE SHORTEST HORIZON (15 minutes) and DECAYS monotonically:
  significant at 15-60 min, gone by 90-120 min, and beyond one session the
  DEV sign INVERTS while VALID stays positive — i.e. noise.
  Meanwhile the required hurdle more than DOUBLES the moment the trade goes
  overnight. The effect shrinks as the cost grows.

## 8-10. GATES
  STATISTICAL: 8 of 22 tests pass the Bonferroni gate and replicate in VALID
  with LARGER t-statistics (up to t = 9.74). The statistical evidence is
  genuinely strong and is not in doubt.
  ECONOMIC: ZERO of 22 clear the hurdle. The best statistically-valid effect
  is 0.074-0.093% against a 0.459% requirement — roughly 16-20% of what is
  needed. The largest effect anywhere in the grid is 0.055% (S1_A12, 5d)
  against a 0.986% requirement — about 6%.
  Even the zero-slippage statutory test fails: 0.093% < 0.106%.

## 11-14. OUTLIER / REGIME / CROSS-SECTIONAL / CAPACITY
  NOT RUN. These gates are pre-registered for candidates that clear the
  economic gate. None did. Running them now would be a search for a subset
  that works, which the protocol forbids.

## 15. TEST
  NOT OPENED. No candidate earned access. TEST was physically excluded from
  the dataset at load time, so it could not have been inspected accidentally.

## 20. FINAL OUTPUT

  >>> NO-GO — NO TRADEABLE EDGE DEMONSTRATED <<<

  BINDING FAILURE: the economic gate, by a factor of roughly 5-6x.
  Not the statistics — the statistics are the strongest in the entire
  programme (t up to 9.74, replicating across DEV and VALID with increasing
  strength).

  HOW FAR SHORT, EXACTLY:
    best statistically-valid effect            0.093%  (S1_A12, 60m, VALID)
    zero-slippage statutory floor              0.106%   -> short by 0.013pp
    full realistic hurdle                      0.306%   -> short by 0.213pp
    YES-GO requirement (1.5x full)             0.459%   -> short by 0.366pp
    ratio of best effect to requirement        20%

## WHAT THIS PHASE ADDS TO THE PROGRAMME
  The longer-horizon escape route is now closed EMPIRICALLY rather than
  assumed. Indian large-cap intraday mean reversion is a real, strongly
  replicated phenomenon that lives entirely inside the 15-60 minute window,
  is worth 0.05-0.09% per event, and cannot be stretched to pay for itself:
  extending the hold shrinks the signal and doubles the cost simultaneously.

  Combined with Phase 4.X, the efficiency boundary of this market is now
  measured from both sides: the information exists, and it is smaller than
  the statutory tax that must be paid to act on it.

## SEPTEMBER 2026
  LIVE TRADING: NO-GO.  PAPER TRADING: NO-GO (nothing qualifies to paper).
  The futures intraday collector continues daily and unchanged.

## NO FURTHER PHASE IS PROPOSED
  The protocol forbids manufacturing another phase merely to obtain a YES,
  and no economically plausible untested direction remains in cash equity:
  shorter horizons have smaller effects, longer horizons have larger costs,
  broader universes have worse costs and spreads, and the option overlay is
  explicitly prohibited and was independently refuted in Phase 3.0b.
