# PHASE 2.8 — EVENT-BASED EDGE RESEARCH
2026-08-28 · dataset d83efc3b9b6feb4d · research only, no orders placed

## A. HARNESS STATUS
  Look-ahead injection test      PASS  (5 sessions, all future bars corrupted
                                       o*1.7 h*1.8 l*0.3 c*1.7; 0 state changes;
                                       run aborts on any change)
  Next-bar-open enforcement      PASS  (structural: entry = OPEN of bar i+1)
  Event-first sampling           PASS  (ONE event per session BY CONSTRUCTION —
                                       the framework has no mechanism to sample
                                       a persistent state repeatedly)
  Direction-matched control      PASS  (+ time-of-day matched, different session)
  Session clustering             PASS  (1 event/session => trades == sessions,
                                       each session is one independent observation)
  Reproducibility                PASS  (dataset hash, fixed seed, frozen spec file)

## B. RESEARCH VOLUME
  Hypotheses / parameter variants tested       31
  Bonferroni alpha 0.05/31 = 0.00161  ->  |t| > 3.14
  Economic gate                                |mean| > 2.91 index pts
  DEV+VALID+econ survivors                      1  (C2-3; C1-3 is its negation)
  Candidates frozen and taken to TEST           1
  TEST evaluations                              1  (one time only)

## C. LEDGER SUMMARY (31 variants; full table in run output)
  family        variants   best DEV |t|   outcome
  openrange         8          2.57       all rejected (fail Bonferroni)
  breakout          3          1.18       all rejected
  meanrev           5          3.24       C2-3 survives DEV+VALID
  volatility        4          2.57       all rejected
  microtrend        2          0.42       all rejected
  gap               3          1.38       rejected / 1 insufficient sessions
  twap(proxy)       3          2.38       all rejected
  combo             3          3.21       H1 fails VALID (t=1.08); 1 insufficient

  Rejection reasons: 26 fail DEV Bonferroni · 2 insufficient sessions ·
  1 below economic threshold · 2 survivors (one pair, same hypothesis negated).

  NOTE: the index carries no volume, so TRUE VWAP is not computable. The
  G-family used a session TWAP proxy and is labelled as such, not as VWAP.

## D. THE ONE CANDIDATE — AND ITS TEST FAILURE

FROZEN SPECIFICATION (frozen before TEST was opened):
  Event    first bar in a session where |close-open| > 3.0*sigma(20 bar returns)
  Direction sign(close-open)  [continuation]
  Frequency exactly ONE per session, first occurrence
  Window   event bar 09:45-14:45 IST
  Entry    OPEN of bar i+1        Hold  45 min (9 bars)

  window     n     mean   95% CI     median    t     win%    MAE
  DEV      321     4.20   +/-2.54     1.25    3.24   52.0    13.3
  VALID    279     7.62   +/-6.55     3.25    2.28   52.3    25.4
  TEST     215     5.48   +/-7.77     2.00    1.38   54.4    34.3
  CONTROL  252     3.30   +/-5.05     1.78    1.28   51.6      —   (TEST window)

WHY IT PASSED DEV AND VALID (this was not a weak candidate):
  · direction+time-matched control in DEV was -0.42 while the signal was +4.20
  · PLACEBO DECAYED MONOTONICALLY with entry delay — the signature of a real,
    timing-specific effect:  +0 bars 4.20 | +1 3.88 | +3 2.32 | +5 0.72
  · PARAMETER GRADIENT WAS MONOTONE in the threshold:
    2.0s 0.83 | 2.5s 1.82 | 3.0s 4.20 | 3.5s 5.51
  · survived 0.25 and 0.50 pt slippage above the 2.91-3.43 pt breakeven

WHY IT FAILS ON TEST:
  1 NOT SIGNIFICANT.  t = 1.38. The 95% CI (+/-7.77) spans zero.
  2 THE CONTROL NEARLY MATCHES IT.  Signal +5.48 vs matched control +3.30.
    Signal minus control = +2.18 pts — BELOW the 2.91 pt breakeven. Most of
    the TEST-window "performance" is reproduced by taking a random trade of
    the same direction at the same time of day.
  3 CARRIED ENTIRELY BY OUTLIERS.  n=215; drop the top 5 trades -> mean 1.28;
    drop the top 10 (4.6% of trades) -> mean -1.67. The mean inverts.
  4 CONCENTRATED IN A PARTIAL YEAR.  2023 +3.00 (n=52) · 2024 +5.62 (n=58) ·
    2025 +2.26 (n=70) · 2026 +15.34 (n=35).

  TEST RESULT: FAILED. Recorded as failed. No parameter, window, filter or
  definition was changed after opening TEST, and none will be.

## E. FALSE DISCOVERIES
  E1 C2-3 / C1-3 — passed DEV at Bonferroni, replicated in VALID, passed
     placebo-decay and monotone-gradient checks, then failed TEST on
     significance, control separation AND outlier dependence simultaneously.
     This is the case the whole protocol exists for.
  E2 H1 (OR30 breakout + volatility expansion) — DEV t=3.21, VALID t=1.08.
     Rejected at VALID; never frozen, never taken to TEST.
  E3 A2-30 (OR break-then-reject) — the Phase 2.7 state-signal that produced
     t=-12.69. As a proper one-per-session event: DEV -1.41, VALID -0.29.
     Confirms the Phase 2.7 diagnosis was correct.
  E4 Whole families flat: breakout (best |t| 1.18), microtrend (0.42), gap
     (1.38). At 900+ sessions these are genuinely near zero, not merely
     unmeasured.

## F. BEST CURRENT EDGE
  NONE DEMONSTRATED.

## G. TEST STATUS
  TEST COMPLETED — opened exactly once, on one frozen candidate, after it had
  survived DEV, VALID, the direction-matched control, placebo-decay and
  parameter-gradient checks. Specification was written to disk before the
  window was opened. Result: FAILED. TEST is now closed again and its result
  will not feed back into development.

## H. RECOMMENDATION
  >>> NO EDGE — CONTINUE RESEARCH <<<

  LIVE TRADING: NO-GO. Unchanged and unconditional.

## SAFETY
  Real orders placed NO · modified NO · cancelled NO
  Broker trading calls this phase: NONE (all scripts read one local JSON file
  and import no broker module)
  realOrders default: false
  liveGreenStartConfig() still present, returns realOrders:true, called by
  nothing — this phase modifies no production code. Recommend deletion.
