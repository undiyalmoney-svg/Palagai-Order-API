# PHASE-3.0-SPEC-v1 — IMMUTABLE
Frozen 2026-08-28, BEFORE any forward observation. Recovered verbatim from
scripts/p29c.js (the code that produced the Phase 2.9c result), not inferred.

## EVENT DEFINITION (verbatim source)
    const i=r.i; if(i-20<0) return 0;
    let a=0; for(let k=i-20;k<i;k++) a += C[k].h - C[k].l; a /= 20;
    const rg = r.b.h - r.b.l, m = r.b.c - r.b.o;
    return (a>0 && rg > 2*a && m!==0) ? Math.sign(m) : 0;

In words: at bar i, let a = MEAN RANGE of the 20 bars STRICTLY BEFORE i
(i-20 .. i-1). Event fires when the CURRENT bar's range exceeds 2*a and the
bar is not a doji. The returned +-1 is NOT a trade direction — it exists only
to direction-match the control. The hypothesis is about MAGNITUDE.

## PARAMETERS (immutable)
  lookback for mean range            20 bars, strictly prior, excludes bar i
  compression/expansion multiple     2.0
  doji exclusion                     close != open
  event window                       09:45 <= bar time <= 14:45 IST
  frequency                          FIRST qualifying event per session ONLY
  entry convention                   OPEN of bar i+1 (hypothetical, no order)
  PRIMARY HORIZON                    9 bars = 45 minutes
  minimum forward bars               3 (else observation discarded)
  session boundary                   forward path truncated at session end
  bar interval                       5 minutes, Kite NIFTY 50 token 256265

## SECONDARY HORIZONS (descriptive only)
  5m, 10m, 15m, 30m, 45m, 60m, 90m

## PRIMARY METRIC (immutable — may not be swapped after seeing results)
  ratio = E[|forward 45-min return|] SIGNAL / E[|forward 45-min return|] CONTROL
  Historical value to be replicated: 1.213   (Welch t 3.90)

## CONTROL CONSTRUCTION (immutable)
  Matched on ALL THREE of:
    1. time of day (exact HH:MM)
    2. trailing realised-volatility DECILE
    3. direction (same +-1 as the paired signal)
  Control bar must come from a DIFFERENT session than its paired signal.
  Trailing realised volatility = sd of the last 20 bar-to-bar close changes,
  same-session only.

## FROZEN VOLATILITY DECILE BOUNDARIES
  Computed ONCE from DEV+VALID (2015-01-09..2022-12-30) and FROZEN. They must
  NOT be recomputed as forward data arrives — recomputing would let the
  control drift with the sample.
  3.727550,4.656817,5.572566,6.543343,7.773103,9.256621,11.264441,14.388432,20.892885

## PRE-REGISTERED SAMPLE REQUIREMENT (computed before observation)
  Observed standardised effect size, Cohen d = 0.1369
  Two-sample, alpha 0.05 two-sided, power 0.80  ->  837 events PER ARM
  Historical event rate 0.89 first-events/session
  REQUIRED FORWARD SESSIONS = 939  (~3.8 trading years)
  Collection may not stop early for a favourable OR unfavourable interim result.

## REPLICATION CLASSES
  REPLICATED   control-adjusted ratio significantly > 1 at the required n
  WEAKENED     same sign, materially smaller than 1.213
  FAILED       control-adjusted effect vanishes or reverses
  INCONCLUSIVE insufficient valid observations or protocol/data problems

## PROVENANCE
  research dataset  d83efc3b9b6feb4d  (2015-01-09 .. 2026-08-27)
  historical window used for freezing  DEV+VALID 2015-01-09 .. 2022-12-30
  historical TEST 2023-2026            NOT USED (contaminated by C2-3, Phase 2.8)
  code commit at freeze                d707c7a
spec_hash: dffe2ac3cddacb1c
