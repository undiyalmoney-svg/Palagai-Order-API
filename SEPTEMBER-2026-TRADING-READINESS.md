# SEPTEMBER 2026 TRADING READINESS
2026-08-29 · executed end-to-end · no order placed, modified or cancelled

## 1. SAFETY — PASS

  Full reachable import graph computed by walking `require` for every
  research, collection and shadow component:

    fut-collector.js   fs, path, crypto, axios
    fut-watchdog.js    fs, path, crypto, axios
    fut-fetch.js       axios
    shadow-engine.js   fs, path, crypto, axios, https, http, dotenv
    p29c / p32 / p33 / p34 / p35 / p38   fs (+ crypto/readline)

  Zero reachable `realOrders:true` · zero placeOrder / modifyOrder /
  cancelOrder · zero live-broker / LiveBroker / kiteService / live.worker /
  live.controller in any research path. No research component can instantiate
  the trading desk.
  Production `live/kite-market.js` unchanged (0 `oi:` requests — the research
  fetcher is separate).
  Archive hash before and after every read-only operation:
    fd80551bf6cadb9b -> fd80551bf6cadb9b   UNCHANGED

## 2. REGRESSION — ALL REPRODUCE

  Phase 2.9c   compression, vol-decile-matched control
               plain 1.17 t=3.32 · VOL-MATCHED 1.21 t=3.90 · dropped 0   EXACT
  Phase 3.2    realised/implied ratio, signal vs matched control
               DEV 0.610 vs 0.552 t=2.27 · VALID 0.644 vs 0.516 t=3.71 ·
               BOTH 0.626 vs 0.535 t=4.28                                EXACT
  Phase 3.6/7  collector idempotent (added 0, 1,078 duplicates confirmed,
               0 discrepancies) · watchdog 42/42 sessions OK · 0 parse errors ·
               0 physical duplicate keys · 0 OI anomalies · hash stable
  No discrepancy found. Programme state is intact.

## 3. CURRENT INFORMATION SET

  A. HISTORICALLY TESTABLE (all searched)
     NIFTY 5-min OHLC 2015-2026 (215,188 bars) · India VIX 5-min 2015+ ·
     daily option OI (4.71M rows, survivorship-complete) · daily futures
     volume/OI/basis (5,922 rows) · daily cash equity 2015-2026
  B. FORWARD-ONLY, NEWLY ACCUMULATING
     NIFTY futures 5-min OHLC + real volume + TRUE INTRADAY OI — 42 usable
     sessions, growing ~1/session
  C. DOES NOT EXIST HISTORICALLY
     intraday option prices for expired contracts · historical option bid/ask ·
     true ATM IV surface · skew · term structure · intraday futures history
     beyond ~3 months (expired tokens unresolvable)
     None substituted. VIX is labelled an IV PROXY wherever used.

## 4. FINAL FUTURES MICROSTRUCTURE RESULT

  Sample        42 sessions, front contract NIFTY26SEPFUT
  Features      5-min futures VOLUME and TRUE INTRADAY OI, bars <= i only
  Target        NIFTY INDEX forward 45-min return, entry at INDEX bar i+1 OPEN
                (never computed on futures price -> no roll artefact)
  Library       20 conditions frozen before results, each two-sided:
                volume(5) · OI(4) · price x volume(4) · price x OI(4) ·
                volume x OI(3)
  Gates         Bonferroni 0.05/20 -> |t| > 3.02 · economic hurdle 3.13 index
                points from the repo cost model
  Split         DELIBERATELY NOT SPLIT. A DEV/VALID/TEST split at ~14 sessions
                per arm would be theatre. Single exploratory pass with matched
                controls plus an explicit power analysis.

  RESULT: 0 of 20 conditions cleared Bonferroni AND the economic hurdle.
  Strongest observed |t| = 1.91 (V4, volume acceleration), against 3.02.
  Several conditions show large raw differences (V2 +11.62, O2 -21.03 pts) on
  n = 39 and n = 10 — magnitudes that are meaningless at that sample size.

  CONTROLS DID VISIBLE WORK: 8 of 20 conditions are one-sided by construction
  (long% of 0 or 100). PV1 shows signal -6.15 with control -4.54 — the raw
  signal looks decisively bearish and is almost entirely explained by the
  matched control. PO1 likewise: -3.28 signal vs -4.69 control.

## 5. EVIDENCE QUALITY

  Median sample required for 80% power across measurable conditions: 611 events
  Current sample: 42 sessions at <=1 event/session
  Shortfall: ~14.5x, i.e. roughly 2.4 trading years of continued collection.
  CLASSIFICATION: DATA-LIMITED. Not a failure of the hypothesis family — a
  failure to have enough data to ask the question. It is NOT promoted on the
  strength of 42 sessions.

  Unresolved limitations: backfilled sessions have permanently degraded
  contract coverage (20 sessions hold only the SEP contract because JUL/AUG
  had already expired at collection time); 21 June 2026 sessions are
  permanently unrecoverable.

## 6. ECONOMIC FEASIBILITY

  Repo cost model (charge-entry-gate.js, premium Rs120, qty 65, +Rs40 theta,
  delta 0.5): breakeven 3.13 INDEX POINTS per round trip.
  No candidate anywhere in the programme currently clears it with statistical
  support. The one real effect that survives every robustness check —
  compression -> realised volatility — was measured three independent ways
  and fails economically each time:
    realised/implied 0.626 vs 1.0+ needed for long premium
    straddle simulation on 1,760 events: -Rs42 to -Rs146 per event, win 12-18%
    dVIX vega value Rs43-60 against Rs244-320 friction (~18-25% of the hurdle)

## 7. RISK

  No strategy is proposed, therefore proposed exposure is ZERO and no
  position-sizing framework is issued. Issuing one would imply a candidate
  exists. None does.
  For reference, the audited live desk defect list (Phase 2/2.6) remains
  unaddressed in production: the ~Rs4.6 premium stop, the profit lock set
  below the cost floor, the SL-limit gap exposure, and the live indexEntry
  anchored to an unobtainable intrabar price. Any future deployment must fix
  these first.

## 8. SEPTEMBER DECISION

  >>> NO-GO <<<

  Not because the research failed — it worked exactly as designed — but
  because nothing has cleared the evidence bar. Across the full programme:
  ~110 directional formulations on index OHLC, 22 options-OI conditions,
  20 daily-futures conditions and 20 intraday-futures conditions produced
  zero candidates with statistical support AND economic viability. The single
  genuine, thrice-replicated effect is economically insufficient by a factor
  of roughly four.

  The deadline is not evidence. September is not a reason to trade.

## 9. SEPTEMBER OPERATING PLAN

  BEFORE 1 SEP
    - keep the safety invariant: 0 reachable realOrders:true (verified today)
    - no production trading code changes
    - confirm daily collector runs with a fresh Kite token

  THROUGHOUT SEPTEMBER — collection only, no trading
    - run ./scripts/fut-daily.sh every trading day after close
      (idempotent, fail-closed, non-zero exit on any anomaly)
    - inspect futreports/health-summary.json; act on any ATTENTION status
      the SAME day, because recovery is possible only while contracts remain
      listed (~3 months)
    - expected: ~21 sessions added, taking the archive to ~63
    - DO NOT inspect the accumulating futures data for predictive
      relationships. It is the future out-of-sample set; looking at it now
      destroys the only clean sample being built.
    - Phase 3.0-v1 compression shadow continues unchanged alongside

  NOT IN SEPTEMBER
    - no paper trading through the broker, no live orders, no capital
    - no new hypothesis library on already-exhausted information sets

## 10. WHAT WOULD CHANGE THE DECISION

  NO-GO -> PAPER-ONLY requires ALL of:
    1 >= 300 collected futures sessions (~Q4 2027 at current rate)
    2 a hypothesis frozen and hashed BEFORE that data is examined
    3 chronological DEV/VALID separation within the collected sample
    4 control-adjusted difference exceeding 3.13 index points
    5 |t| past Bonferroni for the frozen library size
    6 the effect surviving placebo delay and parameter gradient

  PAPER-ONLY -> GO requires ADDITIONALLY:
    7 >= 40 paper trades over >= 6 weeks with positive net expectancy on
      real fills
    8 paper-vs-theoretical slippage <= 0.3R
    9 zero unprotected-position incidents and zero risk-limit breaches
   10 the four audited live-desk defects fixed and verified
   11 capital >= Rs1,20,000 (2% of worst-case loss, per Phase 2 design)

## 11. NEXT HIGHEST-VALUE RESEARCH — ONE PRIORITY

  Continue the daily futures collection. Nothing else.

  It is the only activity that changes the information set rather than
  re-searching data already exhausted. Every other avenue has been tested to
  the point where further hypotheses from the same inputs carry low prior
  probability. The binding constraint on this programme is now ELAPSED TIME,
  not analysis — and unlike analysis, the data lost each uncollected day
  cannot be recovered at any price.
