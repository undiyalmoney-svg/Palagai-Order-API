# TRADING BOT — COMPLETE ARCHITECTURE AUDIT
Date 2026-08-27. Code inspected, not assumed. No files modified.

## HEADLINE

The three previously-identified issues (disconnected Rs300 stop, dead
maxOptionLossRs, DNA drift) are GENUINELY FIXED — verified at runtime.

But the audit found a arithmetic defect that is more serious than all three:

  profit-lock floor (Rs50) < round-trip charges (Rs56-68)

A trade that arms the trail at +Rs100 and gives back Rs50 exits at +Rs50
gross = NET -Rs14. The smallest possible "win" is a loss. Paired with a
-Rs364 net stop, breakeven win rate is ~91%. The system cannot profit as
configured. This is mechanical, not statistical.

2026-09-17: the profit-floor half of that arithmetic is FIXED (see C1). The
stop half (C2) is NOT - it needs a risk decision, not a code fix, and is the
binding constraint on expectancy now. Removing a leak is not an edge: the
research programme's OUTCOME B (no tradeable edge found) still stands, so
neither change is a reason to commit capital.

## 1 ARCHITECTURE MAP

  Angular UI (palagai-main)
    -> strategy-dna-caps.ts  TRAP_V2_ENTRY_DNA_EXTRAS   <-- single source
    -> esbuild build-strategy-core.cjs
    -> Palagai-Order-API/live/strategy-core.cjs (174KB bundle)

  Express (server.js -> app.js -> live.routes.js)
    -> live.controller.js   start/stop/status/defaults/backtest/auth
    -> live.store.js        per-user session, 60s setInterval, Mongo persist
    -> live.worker.js       tick: fetch candles -> replay strategy -> runBook
    -> live-broker.js       Kite order placement / SL / exit / reconcile
    -> kite.service         HTTP to Kite

  Data: REST polling only. fetchHistorical5m every 60s. NO websocket.

## 2 TRADING FLOW

  60s tick -> reconcileFromBroker -> fetch 5m candles (12d lookback)
  -> replayPaperOnIndex(createTrapStrategyV2) -> open signal
  -> deskHaltReason gate -> maxOpenLegs gate -> charge-cover gate
  -> MARKET BUY (market_protection '-1') -> resolve fill
  -> place protective SL (order_type 'SL', trigger, limit = trigger*0.9)
  -> each tick: computeTrailingSlTrigger -> modifyOrder (ratchet up only)
  -> exit: cancel SL -> MARKET SELL, or exchange SL fills, or 15:15 time exit

## 3 RISK FLOW (what is ACTUALLY enforced)

  ENFORCED
    maxTradesPerDay 3      clampMaxTradesToDna, UI can only LOWER
    maxOpenLegs 1          broker.openLegCount
    strictDayStopRs 1500   x lots, desk level, deskHaltReason
    dayProfitLockRs 2500   x lots
    maxOptionLossRs 300    per lot, into broker SL trigger
    chargeCoverMultiple 4  charge-entry-gate
    maxNiftyEntryPremium 150

  NOT ENFORCED (declared, displayed, or asserted — but dead)
    bookDayLossStopRs 500      display string only in /defaults
    deskDayLossStopRs 900      display string only in /defaults
    cooldownMin 12             only preflight.js asserts the VALUE
    deskGreenProtectArmRs 500  nothing reads it
    deskGreenProtectFloorRs150 nothing reads it
    deskGreenProtectRs         READ in 3 places, DEFINED nowhere -> 0 = OFF
    dailyTargetRs, optionRsDayRisk   fully dead

  MISSING ENTIRELY
    max weekly loss, max consecutive losses, max open risk,
    margin utilisation cap, per-underlying exposure cap, kill switch

## 4 ORDER LIFECYCLE

  entry   MARKET BUY, tag PALAGAI, market_protection '-1'
  stop    order_type 'SL' (NOT SL-M — exchange withdrew SL-M for F&O)
          trigger = computeProtectiveSlTrigger, limit = trigger * 0.9
  trail   modifyOrder, ratchet up only, max once per 60s tick
  exit    cancelProtectiveSl (+ sweep stale SL by symbol) then MARKET SELL
  recover reconcileFromBroker every tick rebuilds positions from broker truth
  guards  tickBusy re-entrancy lock; positions map blocks duplicate entry;
          SL placement retried once via ensureProtectiveSl

## 5 STRATEGY LOGIC (verified runtime values)

  maxTradesPerDay 3 | targetRMultiple 3.5 | 09:45-14:45 entry | 15:15 exit
  piercePts 20 | trapMode both | maxOptionLossRs 300
  profitLockArm 100 / Lock 50 / Giveback 50
  entryWindows 09:45-10:30, 11:00-12:00, 13:30-14:45

  Trail: floorRs = max(lockRs, peakRs - givebackRs); arms at peak >= Rs100.

## 6-7 DEFECTS

C1 CRITICAL  live/strategy-core.cjs:4549 evaluateOptionPeakTrail   [FIXED 2026-09-17]
   Trail lock Rs50 and giveback Rs50 are BELOW the Rs56-68 round-trip charge.
   Peak Rs100 -> exit +Rs50 gross -> NET -Rs14. Smallest win is a net loss.
   Expected: profit floor must exceed charges by a margin.

   FIX: evaluateOptionPeakTrail / optionTrailFloorPremium take a
   chargeFloorMultiple. Estimated round-trip cost x that multiple is both the
   arm gate and the minimum locked Rs, so the trail cannot arm until the peak
   pays for its own exit, and the floor can never exceed the peak actually
   reached. Set to 2x in TRAP_1LOT_DAILY_DNA_EXTRAS (the single object the
   Angular desk and live-broker.js both read), so Paper and Live move together.
   Smallest locked exit: -Rs11.70 -> +Rs61.70 at 1 Nifty lot, premium 120.
   This also closes section 9 item 5 (charges inside the exit rule).
   Separately, the Angular charge model was billing options on the intraday
   "lower of Rs20 or 0.03%" slab instead of Zerodha's flat Rs20/order, costing
   one lot at Rs20.02 against the true Rs61.70 - every paper "net" figure was
   understated ~3x. Now matches live/charge-entry-gate.js.

C2 CRITICAL  strategy-core.cjs:4487 + live-broker.js:475   [OPEN — needs a risk decision]
   maxLossRs/lotUnits = (300*lots)/(75*lots) = Rs4.00 of premium, ALWAYS.
   At delta ~0.41 that is ~10 Nifty points — noise. Guarantees a high
   stop-out rate by construction. The cap protects size but destroys the
   trade's room to work.

   2026-09-17 measured at the live DNA (1 Nifty lot, lotUnits 65, premium 120):
     stop  Rs4.62 of premium = 11.3 index pts   net on a stop-out  -Rs361.70
     arm   Rs1.90 of premium =  4.6 index pts   smallest net win   +Rs61.70
   So the trade risks 2.43x the distance it must first travel to earn any
   protection, and if every win were the minimum the desk would need an 85.4%
   strike rate to break even. Before the C1 fix that rate was unreachable at
   any win rate, because the minimum "win" was itself -Rs11.70; it is now
   merely implausible. This is the binding constraint on expectancy.

   NOT fixed here, deliberately. The honest fix is the one section 10 states:
   risk must come from SIZE, not from an unnaturally tight stop —
   qty = floor(maxLossRs / (entryPremium - stopPremium)). At 1 Nifty lot that
   is unreachable: 65 units is the floor, and a structural stop of ~Rs15 of
   premium is ~Rs975 of risk, over 3x the Rs300 cap. The cap and a
   structure-based stop cannot both hold at this size, so the choice is
   (a) raise per-trade risk to ~Rs1,000 and hold the structural stop, or
   (b) do not trade 1 lot of Nifty at this capital.
   Both are capital/risk-appetite calls for the desk owner, not a code change
   an audit fix can make silently. See also SEPTEMBER-2026-TRADING-READINESS
   section 11, which sets a Rs1,20,000 capital floor for any deployment.

C3 HIGH  live-broker.js:43 slOrderFields
   Protective stop is SL-LIMIT at trigger*0.9. A gap through the limit
   leaves the position unhedged. The event log states "most this trade can
   lose is RsX" — not guaranteed. Rs300 is a cap only if the limit fills.

C4 HIGH  daily-desk-defaults.js:46 / worker:537 / normalize:417
   deskGreenProtectRs is read in 3 places and defined in none. The DNA sets
   deskGreenProtectArmRs/FloorRs which nothing reads. Green-protect is
   silently OFF while config and comments claim it is on.

C5 HIGH  live.controller.js:44-45
   bookDayLossStopRs / deskDayLossStopRs are literal STRINGS ('500 x lots')
   in the /defaults payload. The UI advertises per-book and desk daily loss
   stops that do not exist in the engine.

C6 MED  dna-live-green.js:106 cooldownMin 12, commented "(enforced in
   worker)". Nothing in live.worker.js or live-broker.js reads it.
   preflight.js:130 asserts the value is 12 — false assurance.

C7 MED  daily-desk-defaults.js:380 strictDayStop honours config.strictDayStop
   when present. A UI payload with false removes the ONLY enforced daily
   loss stop. Risk limits must not be client-disableable.

C8 MED  live.store.js:236 60_000ms tick on 5-min REST candles, no websocket.
   Every exit except the resting exchange SL is delayed up to 60s + API lag.
   Weakens the "Paper == Live" claim.

C9 MED  live-broker.js:437 market_protection '-1' on the MARKET entry.
   Needs confirmation this is not disabling Kite's slippage protection.

C10 LOW live.store.js checkboxHint says 'Rs3,000 x lots'; DAY_PROFIT_LOCK_RS
   is 2500. Dead branches reference removed keys (peSession*, deskHaltAfterRed).

## 8 CONFIG MISMATCHES (UI vs worker)

  /defaults advertises book+desk loss stops -> engine has neither
  /defaults antiChurn indexCooldownMin 12   -> not enforced
  /defaults antiChurn indexMaxTradesDay 0   -> engine clamps to 3 (safe, but
                                               the payload says unlimited)
  checkboxHint Rs3k                          -> actual Rs2.5k
  DNA deskGreenProtectArm/Floor              -> consumer wants deskGreenProtectRs

## 9 MUST FIX BEFORE ANY BACKTEST

  1 C1 trail-vs-charges. Any backtest run before this measures a system
    whose winners are structurally unprofitable.
  2 C2 stop width. Rs4 is a sizing decision disguised as a risk cap; risk
    must come from position SIZE, not from an unnaturally tight stop.
  3 C3 model SL-limit gap risk explicitly in the simulator.
  4 C4/C5/C6 delete or implement. No config key may be displayed or
    asserted unless a consumer reads it.
  5 Charges must be inside the exit rule, not only the entry gate.

## 10 PROPOSED ARCHITECTURE

  ONE risk module, owned by the worker, client cannot weaken:
    RiskEngine.check(intent) -> allow | deny(reason)
    limits: per-trade Rs, per-trade %, day, week, open risk, consecutive
            losses, positions, margin, per-underlying, kill switch
  Sizing derived from risk, never from available capital:
    qty = floor(maxLossRs / (entryPremium - stopPremium)) then clamped by
    capital, margin, lot size, and % of average traded volume.
  Stop set by market structure / volatility; SIZE absorbs the Rs limit.
  Every exit rule charge-aware: no profit floor below k x round-trip cost.
  Config contract: a startup assertion that every declared key has a reader,
    and every reader has a declared key — this class of bug ends permanently.
  Execution model in the simulator: signal -> submit -> fill with spread,
    latency, gaps, partial fills, and SL-limit slip-through.
