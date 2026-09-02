# PHASE 3.2 — IMPLIED-VOLATILITY MISPRICING RESEARCH
2026-08-28 · research only · no orders · DEV+VALID (2015-01-09..2022-12-30)
Pre-registration frozen before any result: /tmp/PRE-REG-3.2.txt

## A. DATA INVENTORY

  AVAILABLE
    NIFTY 5-min index          2015-01-09..2026-08-27, 215,188 bars
    INDIA VIX 5-MINUTE         token 264969 — verified back to 2015.
                               147,456 bars / 1,974 sessions over DEV+VALID,
                               0 failed fetch windows. This was the enabling
                               discovery of the phase: it makes intraday IV
                               testable rather than daily-proxy only.
    NSE F&O daily bhavcopy     expiry, strike, CE/PE, OHLC, settle, OI, volume,
                               underlying price, lot size

  NOT AVAILABLE (marked, never substituted)
    intraday option prices for expired contracts
    historical bid/ask  -> F&O bhavcopy has ZERO bid/ask columns
    true ATM IV         -> F&O bhavcopy has ZERO IV columns
    skew, term structure, 25-delta IVs
  Consequence: India VIX is used as an ATM-IV PROXY and is labelled as such.
  Every option-economics number below is PRICE-ONLY, not executable.

## B. FROZEN EVENT DEFINITION
  Phase-3.0-SPEC-v1 compression, verbatim, unmodified:
    a = mean range of bars i-20..i-1 (strictly prior)
    EVENT iff (bar i range) > 2.0*a AND close != open
    one event per session, window 09:45-14:45, entry = OPEN of bar i+1
  1,761 events / 1,761 matched controls.

## C. PRE-REGISTERED HYPOTHESES (3 tests, Bonferroni 0.05/3 -> |t| > 2.39)
  D (PRIMARY) compression adds predictive power for realised |45-min move|
              BEYOND pre-event IV
  C           compression shifts the realised/implied ratio vs matched control
  A/B/E       compression predicts dVIX over 45 min (direction NOT assumed;
              A and B are the same test, counted once)

## D. PRIMARY RESULT — FAMILY D (incremental information)
  Model A: |ret45| ~ b0 + b1*impliedMove(VIX_i)
  Model B: + b2*compressionDummy
  FIT on DEV 2015-2018, EVALUATED OUT-OF-SAMPLE on VALID 2019-2022.

    DEV coefficients:  b1(impliedMove) 0.7188   b2(compression) +1.622 pts
    residual test on DEV: events +0.828 vs controls -0.794   t = 2.53
                          (passes Bonferroni |t|>2.39 — but only just)

    OUT-OF-SAMPLE (VALID)      Model A (IV only)   Model B (IV+compression)
      MAE                          20.3862             20.3461
      R2                            0.0618              0.0645
      MAE improvement from compression: 0.196%

  VERDICT: compression DOES carry information beyond IV — the sign is
  consistent, it survives out-of-sample, and it clears the corrected
  threshold. The magnitude is 0.196% of forecast error.

## E/F. MATCHED CONTROL + FAMILY C (realised/implied ratio)
  The ratio divides IV out by construction, so a shift here IS incremental
  information beyond IV.

    window   events (mean/median)     control (mean/median)    diff    t
    DEV      0.610 / 0.451  n=901     0.552 / 0.397  n=940     0.058  2.27
    VALID    0.644 / 0.446  n=860     0.516 / 0.385  n=821     0.127  3.71
    BOTH     0.626 / 0.448  n=1761    0.535 / 0.392  n=1761    0.091  4.28

  Consistent in both windows, stronger in VALID. BUT BOTH ARMS ARE FAR BELOW
  1.0. Compression lifts realised/implied from 0.535 to 0.626 — it does not
  get anywhere near the 1.0 a long-premium position needs.

## G. IV BEHAVIOUR — FAMILY A/B/E (dVIX over the 45-min window)
    window   events        control      diff        t
    DEV      +0.0251       -0.0077     +0.0328     2.80
    VALID    +0.0546       -0.0051     +0.0596     2.66
    BOTH     +0.0395       -0.0065     +0.0460     3.69

  IV RISES after compression relative to control, consistently, passing
  Bonferroni in both windows independently.

  Control quality check: pre-event VIX was 17.73 at events vs 17.42 at
  controls — near-identical, confirming the vol-decile matching worked and
  that compression is NOT merely a low-IV state.

## H. REALISED VS IMPLIED
  Established in 3.0b and reconfirmed here with intraday rather than
  prior-close VIX: realised is ~0.63x implied at compression events and
  ~0.53x at controls. The variance risk premium dominates in both.

## L. TRANSACTION-COST ANALYSIS — WHY THE STATISTICS DO NOT MATTER
  Translating the significant dVIX effect through straddle vega:

    TTE   straddle vega/1.00 vol pt   value of the +0.046 vol pt edge
     4d        Rs1,313                        Rs60.4
     3d        Rs1,138                        Rs52.3
     2d          Rs930                        Rs42.8

    friction per straddle round trip (3.0b): Rs244-320

  The IV edge is worth ~Rs43-60 against a Rs244-320 hurdle — roughly
  18-25% of what it must overcome. (An intermediate console line in this
  phase stated "1-2% of friction"; that was an arithmetic error on my part
  and is corrected here. 60.4/244 = 24.8%, not 1-2%.)

  To be tradeable the effect would need to be roughly 4-5x larger.

## M. MULTIPLE TESTING
  3 pre-registered tests, Bonferroni |t| > 2.39. All three pass:
  D t=2.53, C t=4.28, E t=3.69. Note D passes only marginally.
  The three are NOT independent — they are three views of the same
  underlying effect — so the effective number of discoveries is ONE.

## N. HISTORICAL / FORWARD LIMITATIONS
  DEV/VALID separation was maintained; the 2023-2026 TEST window was NOT
  reopened. No historical TEST is claimed for these results.
  Skew, term-structure, 25-delta and any bid/ask-dependent hypothesis are
  REQUIRES FORWARD OPTION DATA — the fields do not exist historically.

## O. SAFETY AUDIT
  repo-wide reachable `realOrders: true`      NONE
  shadow engine broker-module references      0
  p32-iv.js imports                           fs only (no broker module)
  placeOrder / modifyOrder / cancelOrder from any research path   NONE
  Real orders placed: NO. Capital allocated: NONE.

## P. VERDICT PER HYPOTHESIS
  D  compression adds info beyond IV   -> C. STATISTICAL ONLY
     (real and out-of-sample consistent; 0.196% forecast improvement)
  C  realised/implied ratio shift      -> C. STATISTICAL ONLY
     (0.535 -> 0.626; both far below the 1.0 needed)
  A/B/E  dVIX rises after compression  -> C. STATISTICAL ONLY
     (worth Rs43-60 against Rs244-320 friction)
  skew / term structure / 25-delta     -> E. DATA-LIMITED

## Q. OVERALL DECISION

  >>> C — STATISTICAL ONLY. DO NOT PROCEED TO PHASE 3.3. <<<

  The phase question was: does compression tell us something the option
  market has not already priced? The answer is a genuine, narrow YES —
  three independent formulations agree, with the correct sign, out of
  sample, past a corrected multiple-testing threshold.

  And it does not matter. The information is worth ~20-25% of the friction
  required to act on it. Under section 24 the economic gate is not passed,
  so Phase 3.3 (option structure research) DOES NOT OPEN.

  ONE ASYMMETRY RECORDED, NOT PURSUED: realised/implied is 0.626 at
  compression events and 0.535 at controls, both well under 1.0. A
  volatility SELLER therefore earns more at NON-compression times, so the
  signal has genuine value as an avoidance filter for short premium. That
  requires a short-premium strategy with the tail risk previously excluded
  from this programme, and is not pursued.

  Phase 3.0-v1 shadow collection continues UNCHANGED. Nothing in this phase
  modified it.
