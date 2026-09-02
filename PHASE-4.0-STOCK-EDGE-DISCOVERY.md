# PHASE 4.0 — INDIAN CASH-EQUITY EDGE DISCOVERY
2026-08-29 · executed end-to-end · no order placed, modified or cancelled
Frozen spec hash 85e379fc040d416f (written BEFORE any predictive result)

## 1. SAFETY AUDIT — PASS
  Transitive import closure walked for every Phase 4 component:
    p29c.js  fs · p438-system.js  fs,path,readline · equity-charges.js  none
    p40-stock.js  fs
  Zero reachable realOrders:true / placeOrder / modifyOrder / cancelOrder /
  live-broker / LiveBroker / kiteService / live worker / live controller.
  Repo-wide reachable `realOrders: true`: 0. Production trading code unmodified.

## 2. HARNESS REPRODUCTION — PASS
  Phase 2.9c compression, volatility-decile-matched control:
    plain 1.17 t=3.32 · VOL-MATCHED 1.21 t=3.90 · dropped 0   EXACT MATCH
  Enforced in this phase: prior-bar-only features, next-bar-OPEN execution,
  event-first construction, date-clustered inference, direction-matched and
  volatility-bucket-matched controls, chronological DEV/VALID/TEST,
  Bonferroni correction, hard economic gate.

## 3. DATASET AUDIT
  NSE bhavcopy daily  2,858 sessions  2015-01-01 .. 2026-08-21
  MTO delivery        2,873 sessions
  corporate actions   34,853 rows
  company universe    2,951 non-ETF symbols
  panel built         2,721 symbols · 4,175,551 symbol-days
  Two file formats handled (legacy pre-2024-07, UDiFF after). No silent repair.

  CRITICAL LIMITATION: the archive contains NO INTRADAY EQUITY DATA. Every
  intraday-specific hypothesis family in the brief (opening-range, first
  intraday range expansion, intraday volume shock, intraday reversal) is
  therefore DATA-LIMITED and was NOT tested. It was not approximated with
  daily bars and not silently substituted.

## 4. SURVIVORSHIP AUDIT — PASS
  Each bhavcopy file is a full-market snapshot, so delisted names are retained:
    symbols 2015-01-01: 1,433 · 2020-11-06: 1,546 · 2026-08-21: 2,633
    present 2015, ABSENT 2026 (delisted/renamed): 607  (3IINFOTECH, ABAN, ABGSHIP …)
    absent 2015, present 2026 (IPO/new):        1,807
  A stock cannot appear before it traded, and delisted names are not dropped.
  SURVIVORSHIP-COMPLETE for the traded universe.

  POINT-IN-TIME INDEX MEMBERSHIP: NOT PRESENT in the repository. No historical
  NIFTY 50 constituent file exists. Rather than using today's constituents
  across history — which would inject exactly the bias this audit exists to
  prevent — the universe is defined by OBSERVABLE LIQUIDITY at each date,
  which is causal by construction.

## 5. UNIVERSE (frozen before results)
  non-ETF company symbol · close >= Rs20 · median 20-day traded value >= Rs5cr
  · >= 60 prior sessions. Evaluated at each date T using only data <= T.
  Result: 666,338 eligible symbol-dates across 1,897 dates.

## 6. COST MODEL — from the repository, NOT the index hurdle
  live/equity-charges.js delivery (CNC) round trip: Rs128.80 on Rs50,000
  turnover = 0.258%, invariant to price/quantity at constant turnover.
  Plus 0.20% slippage per side.
  ECONOMIC HURDLE = 0.658% NET MOVE.
  Expressed as a percentage, not a point count. The 3.13 NIFTY-point index
  hurdle from earlier phases was explicitly NOT reused.

## 7. INFORMATION AVAILABILITY / LOOK-AHEAD
  Features at day T use bars <= T only. Entry is the OPEN of day T+1; exit is
  the CLOSE of day T+5. No same-day close is ever transacted, no intrabar
  price is used, no future constituent membership, no future liquidity
  ranking, no future corporate-action knowledge.

## 8/9. FROZEN HYPOTHESIS LIBRARY — 20 conditions, each two-sided
  A continuation and its exact negation count as ONE hypothesis.
  momentum   M1 |1d|>2vol · M2 |1d|>3vol · M3 5d>2vol*sqrt5 · M4 20d>8%
  reversal   R1 |1d|>3vol fade · R2 5d fade · R3 exhaustion close-location
  volume     V1 relVol>3 · V2 relVol>5 · V3 relVol>3 fade · V4 relVol<0.4
  relative   D1/D2 1d vs NIFTY continue/fade · D3/D4 5d vs NIFTY continue/fade
  gap        G1 continue · G2 fade · G3 gap + relVol>2
  volatility F1 range>2.5x median continue · F2 fade
  Bonferroni 0.05/20 = 0.0025 -> |t| > 3.02

## 10/12. CONTROLS
  Same date · DIFFERENT symbol · same liquidity bucket · same volatility
  bucket · same trade direction. Built from information available before the
  hypothetical trade. Statistics are DATE-CLUSTERED: each date contributes one
  observation, because same-day cross-sectional trades are correlated.

## 11/13. DEV AND VALID RESULTS
  ID  fam         dates | DEV diff     t   | VALID diff    t   | econ
  M1  momentum      908     -0.033   -0.26      -0.118   -0.92   no
  M2  momentum      855      0.027    0.14      -0.055   -0.30   no
  M3  momentum      905     -0.222   -1.41      -0.221   -1.53   no
  M4  momentum      912      0.022    0.22       0.079    0.72   no
  R1  reversal      855     -0.336   -1.64       0.127    0.67   no
  R2  reversal      905      0.200    1.28       0.204    1.43   no
  R3  reversal      894      0.004    0.03       0.206    1.37   no
  V1  volume        910     -0.127   -1.03      -0.225   -2.18   no
  V2  volume        894     -0.125   -0.58      -0.218   -1.40   no
  V3  volume        910      0.064    0.51       0.201    1.94   no
  V4  volume        906      0.037    0.28       0.199    1.54   no
  D1  relative      908      0.005    0.04      -0.098   -0.82   no
  D2  relative      908     -0.040   -0.32       0.108    0.87   no
  D3  relative      912     -0.034   -0.37      -0.090   -1.07   no
  D4  relative      912      0.043    0.47       0.092    1.11   no
  G1  gap           761     -0.175   -0.65       0.078    0.37   no
  G2  gap           761      0.005    0.02       0.120    0.56   no
  G3  gap           632      0.189    0.62       0.083    0.34   no
  F1  volatility    878      0.133    0.74      -0.177   -1.13   no
  F2  volatility    878     -0.109   -0.58       0.194    1.25   no

  SURVIVORS: 0.   All 20 fail the DEV Bonferroni threshold.
  Strongest DEV |t| anywhere: 1.64 (R1), against 3.02.
  NOT ONE condition's control-adjusted difference reaches the 0.658% hurdle
  in either window. The largest is 0.336% — about half.

  The controls again did visible work. V1: DEV signal -0.212 vs control
  -0.085; VALID signal -0.015 vs control +0.210. The raw signal reads very
  differently from the matched difference in both windows.

## 14/15/16. ROBUSTNESS / CONCENTRATION / TEST
  NOT RUN, and deliberately so. The pre-registered protocol reserves the
  robustness and concentration suites for candidates that pass DEV+VALID.
  Nothing passed. Running them now would be searching for a subset that works
  — the exact behaviour §21 prohibits.
  TEST (2023-2026) WAS NOT READ. The script cuts the panel at the VALID
  boundary, so TEST bars were never loaded into the analysis.

## 17/18/19. SEPTEMBER READINESS
  No candidate exists, therefore none is deployable, none is paper-ready, and
  no position-sizing or risk framework is issued. Issuing one would imply a
  candidate. LIVE NO-GO stands unconditionally.

## 20. FINAL DECISION

  >>> C — NO-GO / CONTINUE RESEARCH <<<
  NO STOCK EDGE DEMONSTRATED — SEPTEMBER LIVE TRADING NO-GO.

  With an explicit D qualification: the DAILY-horizon families above were
  properly tested and failed. The INTRADAY equity families were not tested at
  all because intraday equity data does not exist in the archive. Those are
  DATA-LIMITED, not refuted, and must not be recorded as failures.

## 21. PARKED HYPOTHESES (new Phase 4.x specs, not tested here)
  4.1  intraday equity events — requires building an intraday equity archive
       (a liquid ~50-name universe; the same forward-collection problem as
       futures, but stock intraday history IS retrievable from Kite because
       equity tokens do not expire — this is a genuine advantage over futures)
  4.2  sector-relative events — needs a sector-membership map, absent today
  4.3  delivery-percentage event signals at the single-stock level (MTO data
       is archived; only portfolio-level delivery was tested, in Program 438)
  4.4  cross-sectional daily ranking events (extreme relative movers)
  Each requires its own frozen specification and its own DEV/VALID/TEST cycle.

## 22. WHAT WOULD CHANGE THIS
  The single highest-value next step is 4.1. Unlike NIFTY futures — where
  expired contract tokens are unresolvable and only ~43 sessions exist —
  EQUITY INSTRUMENT TOKENS DO NOT EXPIRE. Intraday history for liquid stocks
  is retrievable from Kite today, for years back. That means the intraday
  equity question can be answered NOW rather than after two years of
  collection, and it is the only remaining branch with that property.
