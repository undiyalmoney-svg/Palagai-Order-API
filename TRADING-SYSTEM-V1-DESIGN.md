# TRADING SYSTEM V1 — DESIGN SPECIFICATION
Date 2026-08-27. Design only. No production code changed. No backtest run.

## THE CENTRAL PROOF

Measured, not assumed (Kite instruments + 4,950 five-minute bars, May-Aug 2026):

  NIFTY lot 65 (NOT 75)      median 5-min true range 16.5 pts   daily ATR14 150 pts
  BANKNIFTY lot 30           median 5-min true range 54.3 pts   daily ATR14 465 pts
  FINNIFTY / MIDCPNIFTY      NOT PRESENT in the instrument dump — cannot be traded

Rs300 per lot on NIFTY:
  Rs300 / 65 units          = Rs4.62 of premium
  / delta 0.5               = 9.2 index points
  / 16.5 pt median 5-min TR = 0.56x ONE ORDINARY BAR

The stop sits INSIDE ordinary noise. It is not a risk control; it is a
randomiser. Combined with the Rs50 trail lock and Rs57-71 round-trip charges:

  breakeven win rate at the trail lock  = 104%   (net win is MINUS Rs15)
  breakeven win rate at the Rs100 arm   =  91%

104% is not a hard target. It is arithmetically unreachable. The current
configuration cannot profit under any entry signal whatsoever.

CONCLUSION: Rs300 is INCOMPATIBLE with NIFTY options. Proven, not argued.

## MINIMUM COHERENT RISK PER INSTRUMENT

Minimum position is 1 lot and cannot be subdivided. With a stop of 1.5x the
median 5-min true range (the tightest defensible for a 5-min strategy):

  NIFTY      stop 24.8 pts -> Rs12.38 prem x 65 = Rs804 + Rs65 charges = Rs870
  BANKNIFTY  stop 81.4 pts -> Rs40.72 prem x 30 = Rs1222 + Rs56       = Rs1277

Capital required so that one trade is a prudent fraction of the account:

                 at 1% risk/trade      at 2% risk/trade
  NIFTY          Rs 80,438             Rs 40,219
  BANKNIFTY      Rs 1,22,175           Rs 61,087

## VERDICT ON Rs20,000

Rs870 of risk on Rs20,000 is 4.35% per trade. Three trades a day is 13% of
the account at risk daily. That is not a trading system, it is a countdown.

> AT Rs20,000, NO ECONOMICALLY VIABLE OPTIONS SYSTEM CAN BE JUSTIFIED.

Either the capital changes, or the instrument changes. Both paths are stated
below honestly, including the one that has no proven edge.

## INSTRUMENT DECISION

SELECTED: NIFTY weekly options, ATM, long-only, INTRADAY (square off 15:15).

Rejected, with reasons:
  BANKNIFTY   needs Rs1.22L at 1%. 3.3x the 5-min noise of Nifty for 0.46x
              the lot size — strictly worse capital efficiency. Also hard-off
              in code today (AUTOBOT_ALLOW_BANK).
  FINNIFTY /
  MIDCPNIFTY  absent from the Kite instrument dump. Not tradeable. Closed.
  INDEX FUTURES  SPAN+exposure margin ~Rs1.5-2L for one NIFTY lot. Exceeds
              every capital level under discussion. Also carries overnight
              gap risk (median 62 pts, max 362 pts observed) unless intraday.
  CASH EQUITY Minimum size is 1 share, so ANY risk budget fits — Rs300, Rs100,
              even Rs15. It is the ONLY instrument that fits Rs20,000.
              Rejected because 438 pre-registered hypotheses measured the
              available edge at 5-58 bps against a 43-51 bps cost floor, and
              the Program 438 portfolio tests were beaten by their own
              opposite-arm controls. We would be sizing correctly into
              nothing.

The honest tension, stated plainly: the instrument that fits the capital has
no measured edge; the instrument with a plausible untested edge does not fit
the capital.

IMPORTANT DISTINCTION: the closed research program tested LONG-ONLY DAILY-BAR
CASH EQUITY. It did NOT test intraday index-option direction. The Nifty
intraday edge is UNPROVEN, not DISPROVEN. This design does not assume it
exists — Phase 3 must measure it.

## THE REDESIGN, IN ONE NUMBER

  breakeven win rate, current config   91% - 104%   impossible
  breakeven win rate, this design      36%  (2R)    plausible, unproven
                                       43%  (1.5R)

That single change — from a noise-width stop with a below-cost profit lock,
to a structure-width stop with an R-denominated lock — is the whole design.

## SPECIFICATION

### Market / Instrument
NSE index options. NIFTY weekly, ATM +/- 1 strike, BUY only (long call or
long put). Intraday only, hard flat by 15:15. No overnight position, which
removes the 62-362 pt overnight gap exposure entirely.

### Entry
NOT SPECIFIED IN THIS PHASE — deliberately.
Risk, sizing and execution are defined first so that any candidate entry is
evaluated inside a sound machine. The existing S/R trap-and-confirm is the
first candidate to be measured in Phase 3, with no presumption it works.
Gate: expected move must exceed cost + slippage + risk premium, i.e. the
setup must plausibly offer >= 2R before it may be taken.

### Stop  (structure first, rupees second)
  initial stop = max(1.5 x median 5-min TR, structural invalidation level)
  floor        = 20 index points ; typical 25-30 points
  expressed in premium via current delta, never as a flat rupee amount
Rationale: must exceed one ordinary bar's range or it is noise-triggered.

### Position sizing  (risk -> size, never capital -> size)
  allowed_risk = min(capital x risk_pct, rupee_ceiling)
  stop_per_unit = (stop_points x delta)
  qty = floor(allowed_risk / stop_per_unit)
  lots = floor(qty / 65)        <- if lots < 1, DO NOT TRADE
  then clamp by: margin, premium outlay, 1 open leg, liquidity

Worked examples at 1% risk, stop 24.8 pts, Rs804 per lot:
  Rs 10,000  -> Rs100 allowed   -> 0 lots -> NO TRADE
  Rs 20,000  -> Rs200 allowed   -> 0 lots -> NO TRADE
  Rs 50,000  -> Rs500 allowed   -> 0 lots -> NO TRADE  (1 lot = 1.6%)
  Rs 1,00,000-> Rs1,000 allowed -> 1 lot
  Rs 2,00,000-> Rs2,000 allowed -> 2 lots
At 2% (aggressive): Rs50,000 -> 1 lot. This is the practical floor.
  MINIMUM VIABLE CAPITAL  Rs 50,000 (2%)   RECOMMENDED  Rs 1,00,000 (1%)

### Profit taking  (cost-aware by construction)
Charges are Rs57-71 round trip. Every threshold is denominated in R, so it
can never fall below cost as it did at Rs50.
  trail arms at   +1.0R  (Rs804)   = 12x charges
  trail locks at  +0.5R  (Rs402)   = 6x charges
  giveback        0.5R
  primary target  2.0R   (Rs1,608)
  RULE: no profit floor may ever be below 3x round-trip charges.
The engine must track gross P&L, net P&L, locked gross and locked net
separately, and must classify a trade as profitable on NET only.

### Time stop
Exit if not at >= +0.5R within 45 minutes (theta decay on a long option).
Forced flat 15:15. No entries after 14:45.

### Daily / weekly risk (all server-side, hard ceilings)
  risk per trade        1% of capital, rupee ceiling 2%
  max trades/day        3
  daily loss limit      2.5R
  weekly loss limit     5.0R
  consecutive losses    3 -> halt for the day
  max open risk         1R (one open leg)
  max simultaneous pos  1
  per-underlying cap    100% (single underlying by design)
  margin utilisation    <= 50% of capital as premium outlay
  kill switch           operator-triggered, flattens and blocks Start

### Execution architecture
  SIGNAL -> PREFLIGHT (risk engine allow/deny) -> SIZE -> SUBMIT -> FILL
  -> PROTECTIVE ORDER -> MONITOR -> EXIT -> RECONCILE

  entry            marketable LIMIT (LTP + 2 ticks), fallback MARKET after
                   3s. Replaces today's MARKET with market_protection '-1'.
  order rejected   log, no retry loop, no position created
  partial fill     size the protective order to FILLED qty, not intended qty
  no fill          cancel after 3s, abandon the signal (do not chase)
  API timeout      treat as UNKNOWN, reconcile before any new action
  duplicate signal blocked by the positions map + tickBusy lock (works today)
  stale candle     if newest bar older than 2 intervals -> no new entries
  unexpected pos   broker is truth; adopt and protect it immediately
  SL rejected      retry once, then emergency market exit
  SL disappears    detected at reconcile, re-place immediately
  crash / restart  reconcileFromBroker rebuilds from broker (works today)
  market close     forced flat 15:15, before the 15:20 broker square-off
  network loss     broker-side resting SL is the safety layer and survives

### Protective stop design
  order_type 'SL' (SL-M withdrawn for F&O by the exchange)
  limit band = max(5 ticks, 20% below trigger)   [today: 10%]
  PLUS application-side emergency MARKET exit if the position is still open
  and LTP < trigger for 2 consecutive polls.
  EXPECTED LOSS            = 1R = Rs804
  WORST-CASE EXECUTION LOSS = budget 2-3R on a fast move through the limit.
  Risk limits must be sized against the WORST CASE, not the expected loss.
  The UI must stop claiming "most this trade can lose is RsX" — it is not a
  guarantee, and saying so is the difference between a stop and a promise.

### Market data  (no websocket required — justified, not assumed)
  signal generation   5-min bars, <= 60s latency        polling is ADEQUATE
  stop detection      broker-side resting order         REAL-TIME already
  profit trail        <= 60s                            ADEQUATE because the
                      trail floor (0.5R = 12.4 index pts) is wide relative
                      to 60-second noise
  Conclusion: the existing 60s polling architecture is sufficient. A
  websocket would be required only if stops were application-side. They are
  not, and they should not be.

### Capital survival (to be simulated in Phase 3, thresholds set now)
  5 consecutive losses   -5R  = -5% of Rs80k     survivable
  10 consecutive losses  -10R = -10%             survivable, but the
                                                 3-loss halt makes it rare
  20 consecutive losses  -20R = -20%             unreachable given the daily
                                                 and weekly caps
  gap through stop       budget 2-3R per event
  monthly worst case     4 weeks x 5R weekly cap = 20R = 20% of capital
  REJECT the system if probability of 50% drawdown exceeds 1% in Monte Carlo.

### Cost model (must be inside the exit rule, not only the entry gate)
  brokerage Rs20/leg, STT 0.1% sell, exchange 0.035%, GST 18%, stamp 0.003%,
  SEBI 0.0001%, plus modelled spread and slippage. Round trip Rs57-71 at
  1 NIFTY lot.

### Backtest methodology (Phase 3 — frozen here, before any run)
  Real Kite option OHLC via live/backtest.js. No index-point proxy.
  DEV design -> VALID single configuration selection -> TEST opened ONCE.
  Parameter ranges declared BEFORE running. No sweeps over hundreds of
  values. No TEST-based changes. Report negative results.

### Paper-trading acceptance criteria
  >= 40 trades, >= 6 weeks
  net expectancy > 0 after real fills
  paper-vs-live fill slippage <= 0.3R mean
  zero unprotected-position incidents
  zero risk-limit breaches
  max drawdown within simulated Monte Carlo 95th percentile

### Live deployment criteria
  all paper criteria met, capital >= Rs50,000, 1 lot, 1% risk,
  kill switch tested, 2 weeks at minimum size before any increase.

## WHAT MUST BE TRUE BEFORE PHASE 3
  1 Every risk control server-side and non-disableable by the client.
  2 Startup FAIL-CLOSED assertion: every declared config key has a reader,
    every reader has a declared key. This ends the dead-config class of bug
    permanently (it has now produced 6 separate defects).
  3 Effective configuration logged in full at boot.
  4 The dead controls from the audit deleted or implemented — not left
    displayed in /defaults while unenforced.
