# PHASE 3.0b — ECONOMIC FEASIBILITY REVIEW
2026-08-28 · Phase 3.0-v1 UNCHANGED and still collecting · no orders, no capital

## 1. FROZEN HISTORICAL EFFECT
  Compression (bar range > 2x mean range of the 20 strictly-prior bars) predicts
  elevated realised volatility over the next 45 minutes.
    |return| ratio vs vol-decile-matched control   1.213
    variance ratio                                 2.80
    (note: 1.21^2 = 1.46, so the 2.80 variance ratio is inflated by tail
     observations. The |return| ratio 1.21 is the robust estimate and is what
     this review uses.)

## 2. EFFECT SIZE
  Cohen d = 0.1369 — small.

## 3. REQUIRED FORWARD SAMPLE
  837 events/arm ≈ 939 sessions ≈ 3.8 trading years. 1 session elapsed.

## 4. OPTION-DATA LIMITATIONS (stated before any inference)
  AVAILABLE   NSE F&O daily bhavcopy 2015+ (expiry, strike, CE/PE, OHLC, OI,
              underlying, lot size) · India VIX daily (token 264969, verified)
  NOT AVAILABLE  intraday option prices for expired contracts; intraday IV;
              historical bid/ask.
  Therefore no historical intraday option FILL is known, and none is claimed.
  Everything below is a MODEL, explicitly labelled as such.

## 5. THE DECISIVE TEST — IS THE VOLATILITY ALREADY IN THE PRICE?

  For all 1,760 historical compression events, the implied 45-minute move was
  computed from the PRIOR SESSION'S CLOSING India VIX (strictly known before
  the event) and compared to the ACTUAL realised 45-minute move:

    mean |45-min move| REALISED            22.73 index pts
    mean |45-min move| IMPLIED by VIX      35.47 index pts
    REALISED / IMPLIED  mean               0.641
    REALISED / IMPLIED  median             0.478
    events where realised > implied        19.2%
    mean VIX at these events               17.70

  Even WITH the compression boost already included, realised volatility is
  only ~64% of implied. The variance risk premium is far larger than the
  effect.

  Decomposed:
    baseline realised/implied (strip the 1.21x boost)   0.530
    with the compression boost                          0.641
    needed for a long option to pay (incl. ~2% friction) ~1.02
    further boost still required                        1.59x
    boost the effect actually delivers                  1.21x
    => the effect would need to be roughly 3x LARGER than it is.

## 6. DIRECT SIMULATION — LONG ATM STRADDLE ON EVERY EVENT
  Black-Scholes revaluation at the observed 45-minute price, using each
  event's own VIX as IV, real Zerodha F&O charges, explicit spread.

  TTE  spread/leg |   n    mean net   median net   win%   total
   4d   Rs0.25    | 1760   Rs  -81     Rs -190    15.2%   Rs -1,41,907
   4d   Rs0.50    | 1760   Rs -146     Rs -255    11.9%   Rs -2,56,307
   3d   Rs0.25    | 1760   Rs  -65     Rs -190    16.4%   Rs -1,14,734
   3d   Rs0.50    | 1760   Rs -130     Rs -255    13.5%   Rs -2,29,134
   2d   Rs0.25    | 1760   Rs  -42     Rs -192    18.4%   Rs   -74,107
   2d   Rs0.50    | 1760   Rs -107     Rs -257    15.6%   Rs -1,88,507

  EVERY configuration loses. Win rate 12-18%. This is the arithmetic
  consequence of realised/implied = 0.641.

## 6b. FRICTION HURDLE (for completeness)
  Long ATM straddle, 1 lot/leg, 45-min hold, IV 11-14%:
    theta45 Rs59-143 · charges Rs112-121 · spread Rs65 · TOTAL Rs245-320
    breakeven |move| 41-52 index pts
  (An earlier version of this table used IV 11-14% while actual event VIX
  averaged 17.7%, and compared the MEAN move against breakeven — wrong, because
  straddle payoff is convex so E[payoff] != payoff(E[move]). The per-event
  simulation in section 6 is the correct test and supersedes it.)

## 7. SCENARIOS
  CONSERVATIVE  spread Rs0.50/leg, TTE 4d   ->  -Rs146/event
  BASE          spread Rs0.25/leg, TTE 3d   ->   -Rs65/event
  OPTIMISTIC    spread Rs0.25/leg, TTE 2d   ->   -Rs42/event
  There is no assumption within a plausible range that turns this positive.

## 8. WHAT CAN AND CANNOT BE INFERRED
  CAN:    realised volatility after compression is materially BELOW implied.
          A long-premium expression of this effect loses money, and the
          margin of failure is large, not marginal.
  CANNOT: that ANY option structure is unprofitable. Not tested: calendars,
          ratio spreads, delta-hedged gamma scalping, or SHORT premium.
  DIRECTION OF EVERY LIMITATION: 30-day VIX understates short-dated ATM IV
  near expiry; BS revaluation assumes constant IV whereas IV typically FALLS
  after a volatility spike (vol crush). Both make the true result WORSE than
  reported. The conclusion is therefore robust to these approximations.

  ONE GENUINE ASYMMETRY WORTH RECORDING: compression events are the moments
  when realised/implied is HIGHEST (0.641 vs a 0.530 baseline). For a
  hypothetical volatility SELLER they are the worst moments to sell. That is
  a legitimate use of the signal as an avoidance filter — but it presupposes
  a short-premium strategy, which carries tail risk previously excluded, and
  is not pursued here.

## 9. PHASE 3.1 PRE-REGISTRATION
  Written to PHASE-3.1-DESIGN.md and LOCKED. It does not execute.

## 10. DECISION

  >>> C — NO <<<
  Even if the historical effect is entirely real, estimated option friction
  and the variance risk premium make monetisation implausible. The effect
  delivers a 1.21x volatility boost; profitability needs ~1.59x MORE on top
  of that, i.e. an effect about 3x larger than the one observed.

  IS IT ECONOMICALLY RATIONAL TO WAIT 939 SESSIONS?
  Not for the purpose of trading it long-premium. Phase 3.0-v1 collection
  costs nothing to continue and answers a genuine scientific question
  (does compression predict realised volatility?), so it is left running
  UNCHANGED. But it should not be waited on as a route to a trading system.

## 11. SAFETY RE-VERIFICATION
  repo-wide grep for a reachable `realOrders: true` configuration: NONE
  (liveGreenStartConfig and liveCrudeGreenStartConfig were removed in 3.0)
  shadow engine imports no broker order module; market data read-only.
  Real orders placed: NO. Capital allocated: NONE.
