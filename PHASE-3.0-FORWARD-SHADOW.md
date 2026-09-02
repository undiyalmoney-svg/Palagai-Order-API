# PHASE 3.0 — FORWARD SHADOW VALIDATION
2026-08-28 · NO REAL MONEY · NO LIVE ORDERS · NO OPTION STRATEGY

## A. FROZEN SPECIFICATION
  PHASE-3.0-SPEC-v1.md   spec_hash dffe2ac3cddacb1c

  Recovered VERBATIM from scripts/p29c.js (the code that produced the 2.9c
  result), not inferred and not simplified:

    at bar i:  a = mean range of bars i-20 .. i-1   (strictly prior)
    EVENT iff  (current bar range) > 2.0 * a   AND   close != open
    the returned +-1 is NOT a trade direction — it exists only to
    direction-match the control

  frequency  FIRST qualifying event per session only
  window     09:45-14:45 IST
  entry      OPEN of bar i+1 (hypothetical)
  PRIMARY    E[|forward 45-min return|] signal / control
  control    matched on time-of-day + volatility DECILE + direction,
             drawn from a DIFFERENT session
  vol deciles FROZEN from DEV+VALID and written into the spec, so they cannot
             drift as forward data arrives

  REPRODUCTION CHECK: re-running p29c reproduced ratio 1.213 / t 3.90 exactly.
  Spec is reproducible; shadow testing was therefore allowed to start.

## B. PRE-REGISTERED SAMPLE REQUIREMENT (fixed before observation)
  Cohen d = 0.1369 (small)
  alpha 0.05 two-sided, power 0.80  ->  837 events per arm
  event rate 0.89 first-events/session  ->  939 forward sessions
  ~3.8 TRADING YEARS. Collection may not stop early in either direction.

## C. DATA INTEGRITY / EVENTS OBSERVED
  research frontier                     2026-08-27
  genuinely unseen sessions available   1   (2026-08-28)
  sessions processed                    1
  bars 75/75 · duplicates 0 · out-of-order 0 · status OK
  events recorded                       1
    2026-08-28T13:25 IST · compression 2.02x · vol decile 4 · |ret45| 13.55
  look-ahead corruption test            PASS (all bars after the event
                                        multiplied by ~2x/0.2x; event
                                        detection unchanged)

## D. PRIMARY RESULT
  NOT COMPUTABLE. 1 event of 837 required (0.12%).
  No signal/control ratio, confidence interval or difference is reported,
  because computing one from a single observation would be meaningless and
  would invite exactly the over-reading this protocol exists to prevent.

## E-I. HORIZON PROFILE / FIRST-vs-REPEAT / TIMING / REGIME / OUTLIERS
  All deferred. Each requires a sample the forward window does not yet have.
  The engine records every field needed for them on every event, so they can
  be produced from the ledger once n is sufficient without re-deriving
  anything.

## J. PROTOCOL AUDIT
  specification changes after freeze      NONE
  look-ahead incidents                    NONE (corruption test PASS)
  data quality anomalies                  NONE
  early stopping                          N/A
  deviations                              NONE
  ledger                                  append-only NDJSON; the engine skips
                                          any date already present and never
                                          rewrites a completed record

## K. VERDICT

  >>> INCONCLUSIVE <<<

  Not because the effect failed, and not because it succeeded — because
  1 of 939 required sessions have elapsed. The research dataset ran to
  2026-08-27 and today is 2026-08-28, so essentially no forward time has
  passed. This was foreseeable and is the correct classification under
  section 24(D).

## L. NEXT GATE
  PHASE 3.1 (option translation) REMAINS LOCKED. It opens only on REPLICATED.

  What now exists and did not before:
    · an immutable, reproducible, hash-stamped specification
    · frozen volatility-decile boundaries that cannot drift
    · a read-only shadow engine that imports no broker order module
    · an append-only ledger with a self-testing look-ahead guard
    · a sample requirement fixed BEFORE any forward data was seen

  The only thing that advances this phase is elapsed market time. Run the
  engine daily; it is idempotent and will skip anything already recorded.

## SAFETY
  Real orders placed        NO
  Orders modified/cancelled NO
  Broker calls              READ-ONLY market data only
  realOrders default        false

  SECTION 21 EXECUTED — two dead functions that returned `realOrders: true`
  and were referenced by nothing were REMOVED (not renamed):
    live/dna-live-green.js        liveGreenStartConfig()
    live/dna-live-crude-green.js  liveCrudeGreenStartConfig()
  The second was found only by the post-removal verification sweep. Repo-wide
  grep now returns NO configuration anywhere that can return realOrders:true.
  live.worker.js, live.controller.js and app.js all still load; the strategy
  bundle-version guard still passes; DNA maxOptionLossRs still 300.
