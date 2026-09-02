# PROGRAM 438 — RESEARCH PROGRAM CLOSED
## OUTCOME B: NO TRADEABLE EDGE FOUND

Date: 2026-08-27. Universe: NSE cash equity, long-only, survivorship-aware
bhavcopy 2015-2026 (4.83M records, 3,847 securities), MTO delivery archive,
1.33M corporate announcements.

## What was tested in this program

Three candidates, pre-registered before any forward return was computed,
evaluated as REAL PORTFOLIOS on RAW return net of real costs — not as
Q5-minus-Q1 abnormal return. 20 equal-weight positions, quarterly rebalance,
whole shares, Zerodha CNC costs, slippage swept 0.10/0.20/0.35/0.50%.

  C1 industry momentum rotation   (between-industry selection)
  C2 persistent delivery quality  (delivery LEVEL as characteristic)
  C3 attention growth             (persistent traded-value growth)

Benchmark: Nifty 50 price index, plus ~1.3%/yr for TRI.

## Result (0.20% slippage, primary case, CAGR %)

                        DEV    VALID   TEST     verdict
  C1 industry rotation   5.0    16.3    8.1     fails DEV vs TRI 8.3
  C2 delivery quality   15.3    17.6   12.5     beats all three -> controls run
  C3 attention growth   24.7     5.5    0.3     DEV-only, collapses
  Nifty TRI              8.3    14.8    9.5

## Why C2 died: its own controls

  X2 LOW-delivery (opposite arm)  -4.6   25.0   17.5
  X2 size-matched random          -4.2   18.2    7.0

The OPPOSITE arm beats the strategy arm in VALID and TEST. A random draw from
the same liquidity band matches or beats it. Raising the liquidity floor from
Rs1cr to Rs5cr inverts the window ordering (C2 DEV 15.3 -> 7.4, TEST 12.5 ->
19.1). What looked like "delivery quality" was exposure to a volatile
small/mid-cap band that happened to be negative in DEV and positive in
VALID/TEST. The signal contributes nothing.

## Ten economic gates

  1 Direction   FAIL  no candidate beats TRI in DEV and VALID both
  2 Cost        FAIL  C1/C3 below benchmark before costs bind
  3 Stability   FAIL  every candidate flips sign across windows
  4 Robustness  FAIL  results invert on a liquidity-floor change
  5 Breadth     FAIL  C2 concentrated in Rs1-3cr microcaps
  6 Liquidity   FAIL  edge disappears at Rs5cr floor
  7 Distribution FAIL C2 VALID vol 46% / DD -45.6% vs index 20.7% / -38.4%
  8 Turnover    n/a   not reached
  9 TEST        FAIL  C3 negative; C2 refuted by control
 10 Simplicity  n/a   not reached

## The measured boundary (all ~438 hypotheses)

Directional information in Indian cash equity is real but small and
short-lived: 5-58 bps at horizons of 1-5 sessions, against a round-trip
cost floor of 43-51 bps (CNC + 0.20% slippage + Rs17.70 DP per sell).

Three genuine mechanisms were documented and none cleared the floor:
  H-432-A industry lead-lag   +0.5% / 5 sessions, dies on 21-25%/yr turnover
  P-435   closing pressure    t=10.98, monotonic 15/15, edge 5-14bps vs cost
  P-437   source agreement    ~2x components, TEST collapses

Horizon extension does not help: P-433-B and P-438 both showed the signal
does not survive being held longer — the confirmation advantage INVERTS by
sessions +6 to +10. You cannot trade around the cost by trading less often,
because the information decays faster than the cost falls.

## Conclusion

No tradeable long-only edge was found. The honest recommendation for capital
of this size is a low-cost index instrument, not an active strategy.
