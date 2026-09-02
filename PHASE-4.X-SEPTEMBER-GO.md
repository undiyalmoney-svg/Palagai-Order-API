# PHASE 4.X — MISSION: FIND A GENUINE SEPTEMBER-READY STOCK EDGE
2026-08-29 · executed end-to-end · no order placed, modified or cancelled

## 1. SAFETY — PASS (start and end)
  Transitive import closure walked for every Phase 4 component.
    p29c · p40-stock · p4x-stock · p4y-delivery · p4a-intraday : fs / crypto / readline
    intraday fetch path : axios only
  Zero reachable realOrders:true / placeOrder / modifyOrder / cancelOrder /
  live-broker / LiveBroker / kiteService / live worker / live controller.
  Repo-wide reachable `realOrders: true`: 0. Production trading code unmodified.

## 2. HARNESS REGRESSION — PASS (re-run before every family)
  Phase 2.9c compression, vol-decile-matched control:
    plain 1.17 t=3.32 · VOL-MATCHED 1.21 t=3.90 · dropped 0    EXACT

## 3-4. INFORMATION SETS TESTED — FIVE GENUINELY INDEPENDENT FAMILIES
  Phase 4.0  daily momentum / reversal / volume / relative-to-index / gap /
             volatility                                          20 conditions
  Phase 4.X  daily cross-sectional RANK / market BREADTH / India VIX regime /
             interactions                                        20 conditions
  Phase 4.Y  single-stock DELIVERY (MTO) events                  10 conditions
  Phase 4.A  STOCK INTRADAY 5-min events                         20 conditions
  Phase 4.B  intraday RELATIVE-to-index + intraday CROSS-SECTIONAL 10 conditions
                                                          TOTAL  80 conditions
  Each frozen and hashed before results:
    4.0 85e379fc040d416f · 4.X ad401b272de1d315 · 4.A a61cd63664eb8ae0

## THE INTRADAY UNBLOCK
  Phase 4.0 could not test intraday equity because the archive had none and the
  Kite token had expired. A fresh token was supplied mid-phase and the audit
  confirmed the asymmetry predicted in 4.0:
    EQUITY INSTRUMENT TOKENS DO NOT EXPIRE — 5-minute equity history is
    retrievable back to at least 2016, with real volume, ~74 bars/session.
  Fetched: 26 symbols · 4,636,957 bars · 2,389 sessions each · 2017-01-02..2026-08-21.
  Universe chosen by median traded value over the 250 sessions BEFORE 2017-01-01
  (no future information).
  SURVIVOR SKEW RECORDED: 4 of the 30 causally-selected names have no current
  token (HDFC merged into HDFCBANK; RELINFRA, JETAIRWAYS, RELCAPITAL delisted).
  That is a ~13% skew toward survivors, stated rather than hidden.

## 5-6. COST MODEL — TWO DIFFERENT HURDLES, BOTH FROM THE REPO
  DELIVERY (CNC), for multi-day holds: 0.258% statutory+brokerage
                                       + 0.20%/side slippage = 0.658% hurdle
  INTRADAY (MIS), for same-session holds: 0.106% statutory+brokerage
                                       + 0.10%/side slippage = 0.306% hurdle
  The NIFTY 3.13-point index hurdle was NOT reused.

## 7-8. RESULTS

  Phase 4.0 (daily, 20)      0 survivors · strongest DEV |t| 1.64 · best diff 0.336% vs 0.658%
  Phase 4.X (xsect/state,20) 0 survivors · strongest DEV |t| 1.97 · best diff 0.472% vs 0.658%
  Phase 4.Y (delivery, 10)   0 survivors · strongest DEV |t| 2.52 · best diff 0.325% vs 0.658%
  Phase 4.B (intraday rel,10)0 survivors · strongest DEV |t| 2.89 · best diff 0.045% vs 0.306%

  Phase 4.A (STOCK INTRADAY, 20) — 0 survivors, but a DIFFERENT failure mode:
    SEVEN conditions cleared the DEV Bonferroni threshold (|t| > 3.02), and
    several REPLICATED in VALID with LARGER t-statistics:

      ID   definition                        DEV diff    t    VALID diff    t
      A12  range>3x median -> FADE            +0.053   4.70     +0.082    5.34
      A4   |5m move|>3*vol -> FADE            +0.038   4.40     +0.081    6.58
      A6   exhaustion (big range, opp. close) +0.044   4.29     +0.061    4.85
      A11  range>3x median -> continue        -0.044  -3.94     -0.083   -5.52
      A2   |5m move|>3*vol -> continue        -0.040  -4.60     -0.071   -5.87
      A8   relVol>6 -> continue               -0.039  -3.19     -0.085   -4.03
      A13  compression+expansion+volume       -0.032  -3.15     -0.057   -4.58

    This is a REAL, REPLICATED statistical effect: Indian large-cap intraday
    prices MEAN-REVERT after large 5-minute moves and range expansions. The
    sign is consistent across DEV and VALID and the VALID evidence is stronger
    than DEV — the opposite of an overfit signature.

    7 of 20 conditions were rejected specifically for "below economic hurdle",
    not for statistical failure.

## 9. THE DECISIVE ECONOMIC FINDING
  The best replicated effect is 0.082% (VALID). Testing it against the cost
  floor directly:

    slippage/side   hurdle    best effect 0.082%
      0.00%         0.106%    FAILS
      0.01%         0.126%    FAILS
      0.02%         0.146%    FAILS
      0.05%         0.206%    FAILS
      0.10%         0.306%    FAILS

  THE EFFECT FAILS EVEN AT ZERO SLIPPAGE, because statutory costs plus
  brokerage alone are 0.106%. This is not an assumption problem and cannot be
  fixed by better execution. STT, exchange charges, GST and stamp duty are set
  by regulation; Zerodha brokerage is already at its floor. The information is
  real and is smaller than the tax.

## 10. CONTROLS
  Every result is signal MINUS matched control (same session, different stock,
  volatility-bucket matched, direction matched, time-proximity matched), with
  DATE-CLUSTERED inference. Raw signal means were frequently misleading — in
  Phase 4.A several raw means are near zero while the matched difference is
  strongly significant, and in Phase 4.X several raw means look large while the
  matched difference collapses.

## 11. TEST STATUS
  TEST (2023-2026) WAS NEVER OPENED in any of the five families. No candidate
  earned access under the frozen protocol.

## 12. FINAL VERDICT — CONDITION B

  >>> NO VIABLE EDGE REMAINS IN THE AVAILABLE STOCK DATA <<<

  This is issued under §17 Condition B, not as a premature NO-GO. Five
  genuinely independent information families and 80 pre-registered conditions
  were tested, including the highest-value family (stock intraday) that was
  specifically unblocked during this phase. No criterion was lowered: the
  Bonferroni thresholds, the two cost hurdles, the control design, the
  chronological splits and the TEST lock were all held exactly as frozen.

  A YES was available only by weakening a gate. None was weakened.

## 13. WHAT THIS PHASE ACTUALLY ESTABLISHED
  The Indian large-cap equity market is efficient to WITHIN THE TRANSACTION
  COST BAND at intraday horizons. Genuine, replicable, statistically strong
  mean-reversion exists at the 5-minute scale — and it is roughly 0.05-0.08%
  per event against a 0.106% irreducible statutory floor.
  That is a substantive result, not an absence of one: it locates the market's
  efficiency boundary precisely, and it explains why every prior phase failed
  in the same direction.

## 14. DATA-LIMITED, NOT REFUTED
  sector-relative events   no sector-membership map exists in the repository
  broader universe         testable, but names beyond the top ~30 carry HIGHER
                           costs and wider spreads, moving them further from
                           the hurdle rather than closer
  intraday options flow    does not exist historically (Phase 2.6)
  intraday futures         42 sessions only (Phase 3.5/3.6)

## 15. SEPTEMBER 2026
  No candidate reached PAPER-READY, and none reached LIVE-CANDIDATE.
  SEPTEMBER LIVE TRADING: NO-GO.
  The futures intraday collector continues daily and unchanged
  (./scripts/fut-daily.sh, idempotent, fail-closed).

## 16. WHAT WOULD CHANGE THIS — ONE PRIORITY
  Any future stock candidate must clear 0.106% NET OF NOTHING BUT TAX. That
  requires an effect roughly 30% larger than the strongest one found across
  80 conditions, or a horizon where the cost is amortised over a larger move.
  The single most promising direction is therefore NOT a new intraday feature
  but a LONGER HOLDING PERIOD applied to the confirmed mean-reversion
  mechanism — where the same statutory cost is spread across a larger expected
  move. That is a new frozen experiment (Phase 4.C), not a modification of any
  hypothesis tested here.
