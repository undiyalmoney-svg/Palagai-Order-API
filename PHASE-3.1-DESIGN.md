# PHASE 3.1 — OPTION TRANSLATION (PRE-REGISTERED, LOCKED)
Written 2026-08-28 BEFORE any option strategy result exists.
STATUS: LOCKED. Phase 3.0b returned decision C (NO), so this does not execute.
It is recorded so that if it is ever run, it runs against a specification
frozen before the fact.

  option universe        NIFTY weekly, ATM +/- 2 strikes, CE and PE
  contract selection     strike nearest spot at the event bar's close, using
                         only the chain listed on that date; expiry = nearest
                         weekly with >= 2 calendar days to expiry (expiry-day
                         and T-1 excluded per the Phase 2.5 theta finding)
  entry timestamp        OPEN of bar i+1 after a Phase-3.0-v1 compression event
  exit timestamp         45 minutes later, or session end, whichever first
  IV measurement         intraday ATM IV backed out from live option mid;
                         India VIX prior close is the FALLBACK proxy only and
                         must be labelled as such
  cost model             Zerodha F&O: Rs20/executed order, STT 0.1% sell,
                         exchange 0.035%, GST 18%, stamp 0.003%, SEBI 0.0001%
  slippage model         half-spread per leg per side, measured from recorded
                         bid/ask, NOT assumed
  liquidity filter       reject if OI < 10,000 or spread > 2% of premium
  theta treatment        explicit, from the observed premium decay, not modelled
  maximum loss           premium paid (long-only; no short premium)
  position sizing        1 lot per leg; no scaling in this phase
  PRIMARY METRIC         mean net P&L per event after all friction
  CONTROL                identical structure entered at matched non-event bars
                         (time-of-day + vol-decile matched)
  STATISTICAL TEST       Welch t on net P&L, signal vs control, session-clustered
  REQUIRED SAMPLE        to be computed from the observed variance BEFORE the
                         window is opened, never after
  GATE                   opens only if Phase 3.0 returns REPLICATED

## REQUIRED FUTURE OBSERVABLES (section 10)
  Only fields the economic test actually needs:
    underlying spot at event bar and at exit
    ATM strike, expiry, CE and PE tradingsymbol
    BID and ASK for both legs at entry and at exit   <- without these, slippage
                                                        must be assumed, which
                                                        is what invalidates the
                                                        current historical test
    LTP, OI, volume for both legs
    IV if the broker supplies it
    timestamps for every quote
  NOT collected: full chain depth, greeks (derivable), order book levels.
