# PHASE 2.5 — DATA FOUNDATION + RISK DESIGN LOCK
2026-08-28. Audit + design only. No code modified. No backtest. No live trading.

## CORRECTION TO MY OWN PRIOR REVIEW

In the adversarial review I claimed theta could hit the premium stop with the
index unchanged, and called it V1's worst flaw. I had not computed it. Using
the repo's own Black-Scholes pricer:

  45-min hold, ATM NIFTY CE, 1R = Rs804, qty 65
    4 days to expiry   theta Rs33  =  4% of 1R   needs +0.9 index pts to stand still
    2 days             theta Rs49  =  6% of 1R   needs +1.4 pts
    1 day              theta Rs75  =  9% of 1R   needs +2.2 pts
    EXPIRY DAY (0.4d)  theta Rs153 = 19% of 1R   needs +4.5 pts

Against a 24.8-pt stop and a 16.5-pt median bar, theta is a SECOND-ORDER
headwind at TTE >= 2 days, not a stop-killer. My "worst flaw" claim was
overstated. The real, narrower finding: EXPIRY DAY AND T-1 ARE A DIFFERENT
GAME (19-25% of 1R lost to time alone) and must be excluded or given a
shorter holding period.

## A. DATA ARCHIVE STATUS — VERIFIED, NOT ASSUMED

  WHAT IT DOES      upserts live NIFTY NFO instrument METADATA rows
  WHAT IT DOES NOT  persist a single candle. No OHLC is stored anywhere.

  A1 FATAL   No candle persistence. The archive stores tokens only, so replay
             still depends on Kite serving history for expired contracts.
             I probed ~25 unlisted tokens: none returned data. That probe is
             INCONCLUSIVE (I cannot confirm any were valid expired contracts),
             but the design must assume the worst case: history is NOT
             retained. Therefore candles must be persisted locally, daily.
  A2 FATAL   archiveInstruments() is called ONLY from live.worker.js:213
             (desk warm-up) and backtest.js:266. Trading is paused, so the
             archive is accumulating NOTHING right now. Every paused day is
             permanently lost data.
  A3 HIGH    Upsert is {$set:{...r, archivedAt:new Date()}} keyed on
             tradingSymbol. Each write OVERWRITES. There is no first_seen,
             only last-written. NOT append-only; silent overwrite is possible.
  A4 HIGH    On Mongo failure it falls back to an in-memory Map that dies on
             restart, and it never throws (catch -> console.warn). The archive
             can be silently doing nothing. Mongo is IP-allowlisted to the
             droplet, so this fallback is the live path from anywhere else.
  A5 MED     NIFTY only. isNiftyNfoRow excludes BANKNIFTY/FINNIFTY/MIDCPNIFTY.
             Consistent with the instrument decision, but freezes it.
  A6 MED     No duplicate detection, no missing-bar detection, no OHLC sanity
             check, no integrity/corruption check, no retention policy.

  Metadata that IS captured (kite-market.js parseInstrumentsCsv):
    instrumentToken, exchangeToken, tradingSymbol, name, expiry, strike,
    tickSize, lotSize, instrumentType, segment, exchange
  Missing: first_seen, last_seen.

  VERDICT: the archive is not fit for purpose and is currently inert.

## B. ARCHIVE DESIGN

  contracts    PK = instrumentToken. Immutable after first write.
               underlying, exchange, tradingSymbol, strike, optionType,
               expiry, lotSize, tickSize, firstSeen, lastSeen, sourceDump
               lotSize/tickSize versioned — NSE changes them (65 today, 75
               historically); a single mutable field would corrupt old replay.
  candles      PK = (instrumentToken, tsUtc). Append-only, insert-if-absent.
               open, high, low, close, volume, oi, ingestedAt.
               Timestamps stored UTC, rendered IST at read.
  sessions     tradingDate, firstBar, lastBar, expectedBars, observedBars,
               gaps[], status = COMPLETE | PARTIAL | MISSING
  Duplicates   insert-if-absent on the PK; a conflicting value on an existing
               PK is logged as an INTEGRITY ERROR, never overwritten.
  Missing bars detected against the exchange calendar, recorded explicitly.
               NEVER interpolated or filled with invented prices.
  Restart      idempotent by construction; re-ingesting a day is a no-op.
  Retention    permanent. This data cannot be re-acquired at any price.

## C. CONTRACT UNIVERSE TO COLLECT (frozen before any result)

  underlying   NIFTY
  strikes      ATM +/- 4 strikes (50-pt spacing) = 9 strikes x CE and PE = 18
               contracts per expiry. Bounded window, not the full chain:
               beyond ~4 strikes liquidity and spread make the contract
               untradeable, so collecting it adds storage, not information.
  expiries     current weekly + next weekly + current monthly
  cadence      5-minute bars, full session, every trading day
  ALSO         NIFTY spot 5-min, India VIX daily (IV input for the stop model)
  ALSO         NSE F&O bhavcopy daily — free, permanent, complete back to
               2015. Cannot test a 45-min strategy, but it validates
               contract-selection logic, cost models and expiry calendars at
               zero cost. Collect it regardless.

  Frozen now, before results exist, precisely so it cannot be chosen later
  to match whatever performed best.

## D. STOP / RISK DESIGN AFTER CORRECTION

  PRIMARY    underlying-index structural invalidation. The mechanism lives in
             the index, which does not decay. Stop distance from expected
             ADVERSE EXCURSION OVER THE HOLDING PERIOD, not one bar's range.
  SECONDARY  premium-percentage ceiling, so rupee risk stays bounded when
             delta/gamma make the index conversion unstable.
  BACKSTOP   broker-side resting SL order on premium (the only real-time
             protection; everything else is 60-second polling).
  BINDING    whichever is TIGHTER in rupees.

  Correction to V1's sizing: 1.5x MEDIAN 5-min TR = 24.8 pts is roughly the
  78th percentile of a single bar, and over a 45-min hold random-walk scaling
  gives sigma_45 ~ 24 pts. So V1's stop is a ~1-SIGMA barrier — first-passage
  puts ~30% of trades stopped by noise alone at zero edge. V1's claim that it
  sat "comfortably outside noise" was wrong. Stop distance must be set from
  the holding-period adverse-excursion distribution. The multiplier is
  UNKNOWN until data exists.

  EXPIRY RULE (from the theta table): no new entries on expiry day or T-1
  with a 45-min holding period. 19-25% of 1R to time alone is a different
  instrument, not a tweak.

## E. PROFIT MANAGEMENT

  All thresholds in R. Never in rupees. Never below 3x round-trip charges.
  Breakeven win rate (1R = Rs804, charges Rs65):
    1.0R -> 54%    1.5R -> 43%    2.0R -> 36%    2.5R -> 31%    3.0R -> 27%
  Blended with trailing exits, realistically ~49%.
  Add the theta drag (4-6% of 1R at TTE>=2d) and breakeven rises ~1-2pp.

  FROZEN     denominated in R; no floor below 3x charges; single target with
             a break-even move; separate gross/net and locked-gross/locked-net
             accounting.
  UNKNOWN    the target multiple; the trail arm/lock/giveback; whether to
             partial-exit. These CANNOT be justified without data. Marked
             UNKNOWN rather than invented.

## F. PAPER-TRADING DATA SCHEMA

  Paper mode is a DATA COLLECTOR, not evidence of profit.
  Per candidate trade: ts, spot, contract, token, expiry, strike, bid, ask,
  spread, theoreticalEntry, executableEntryEstimate, stopIndex, stopPremium,
  target, MAE, MFE, exit, exitReason, chargesSimulated, slippageSimulated,
  rResult, ttEexpiry, ivAtEntry, holdingMinutes.
  Per REJECTED signal (equally important): ts, family, rejectReason in
  {INSUFFICIENT_CAPITAL, SPREAD_TOO_WIDE, LIQUIDITY, STOP_TOO_WIDE,
  RISK_LIMIT, STALE_DATA, MISSING_CONTRACT, DATA_FAILURE, ZERO_SIZE}.
  Rejections measure EXECUTION edge; without them a paper record overstates
  what the machine could actually have captured.

## G. FUTURE BACKTEST DATA REQUIREMENTS

  Minimum sample, decided BEFORE any result:
  Breakeven win rate ~49%. Smallest economically interesting edge = 55%
  (6pp). One-sample proportion test, alpha 0.05, power 0.80:
      n = (1.96+0.84)^2 x 0.25 / 0.06^2 = 544 trades
  So ~550 trades in the TEST window ALONE, and DEV and VALID each need
  comparable size to select without noise: ~1,650 trades total.
  Also required: >= 24 monthly expiry cycles (regime coverage), >= 400
  trading sessions, >= 150 wins and >= 150 losses.

  AT 1-3 TRADES/DAY (~500/year) THAT IS ROUGHLY 3 YEARS OF FORWARD
  COLLECTION. This is the honest timeline. It cannot be shortened by
  collecting more strikes — the binding constraint is independent trading
  opportunities, i.e. sessions, not contracts.

## H. NO-LOOKAHEAD RULES

  Contract selection is PART of the strategy and part of the backtest.
  At time t the system may use only: bars with timestamp <= t, the contract
  list as archived on date(t), and the expiry calendar known at t.
  Forbidden: choosing the strike/expiry that later performed best; using any
  contract absent from that day's archived instrument dump; using settlement
  or closing values inside an intraday decision; using today's lot size for a
  historical date.
  Entry price must come from the bar AFTER the signal bar, never its close.

## I. FAIL-CLOSED RULES

  Refuse to trade when: contract metadata missing; stop uncomputable; stop
  unplaceable; size = 0; broker ack ambiguous; daily risk state unknown;
  config integrity fails; newest bar older than 2 intervals; archive
  inconsistent. "No trade" is always the correct default.

  Config invariant (ends the dead-key class of bug — 6 defects so far):
  every declared key has >= 1 verified runtime reader; every runtime risk
  read maps to a declared key; UI may only request a SAFER value than the
  server ceiling. Startup FAILS CLOSED on: unused declared key, undeclared
  runtime key, UI-exposed unenforced control, default mismatch, mandatory
  protection disabled, value outside permitted range. Effective config logged
  in full at boot.

## J. CAPITAL REQUIREMENT

  1R (expected loss, stop executes normally)   Rs804
  worst case (gap through SL limit, 2-3R)      Rs1,608 - Rs2,412
  bounded maximum (option premium to zero)     Rs9,750/lot  <- long options
                                               cannot lose more than premium

    2% of expected loss      Rs 40,200
    1% of expected loss      Rs 80,400
    2% of worst case         Rs 1,20,600
    1% of worst case         Rs 2,41,200

  Survival (drawdown at each capital level):
    consecutive losses    3R      5R      10R
    at Rs40,200          6.0%   10.0%   20.0%
    at Rs1,20,600        2.0%    3.3%    6.7%
  Daily cap 2.5R = Rs2,010. Weekly cap 5R = Rs4,020.

  MINIMUM Rs1,20,000 (2% worst-case).  RECOMMENDED Rs2,00,000.
  V1's Rs50,000 is withdrawn — it violated V1's own worst-case rule.

## K. UNKNOWN / UNPROVEN

  - whether ANY intraday entry has edge (never tested on real option prices)
  - stop multiplier on holding-period adverse excursion
  - target multiple, trail parameters, partial-exit policy
  - holding period: 15/30/45/60 min — mechanism does not determine it, and
    no data exists to choose. FROZEN AS UNKNOWN rather than invented.
  - real spread and slippage on actual fills
  - whether Kite retains expired-contract history (probe inconclusive)

## L. IMPLEMENTATION PLAN (in order)

  1 Standalone archive collector — a scheduled job INDEPENDENT of the trading
    desk, so collection no longer requires the desk to be running (fixes A2).
  2 Candle persistence with the schema in B (fixes A1, the fatal gap).
  3 Append-only + integrity + first_seen/last_seen (fixes A3, A4).
  4 NSE F&O bhavcopy daily collector (free, permanent, immediate).
  5 Config invariant checker, fail-closed at boot.
  6 Risk engine with the hierarchy ACCOUNT->DAY->TRADE->POSITION->ORDER,
    server-authoritative, no client-disableable control.
  7 Paper-mode recorder with the schema in F, including rejections.
  8 DELETE liveGreenStartConfig() — dead function returning realOrders:true.

## M/N/O — GATES

  M IMPLEMENTATION   GO   (items 1-8; none of it requires an entry signal)
  N BACKTEST         NO-GO — DATA COLLECTION ONLY. Cannot begin until the
                     thresholds in G are met: ~1,650 trades, 24 expiry
                     cycles, 400 sessions. Roughly 3 years away.
  O LIVE TRADING     NO-GO — unconditional. Not until N passes, paper
                     acceptance is met, and capital >= Rs1,20,000.

## SAFETY VERIFICATION (item 18)

  Live orders require BOTH realOrders:true in the Start payload AND a pushed
  Kite token (store.start throws otherwise). Broker is constructed with
  realOrders:false; reconcile and syncInstrument both return early in paper
  mode. Nothing in this phase places, modifies or cancels an order.
  ONE LATENT HAZARD: liveGreenStartConfig() returns realOrders:true. It is
  currently called by nothing, but it is a loaded gun — wiring it would
  silently enable live money. Delete it (item L8).
