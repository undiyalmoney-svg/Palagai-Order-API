# PHASE 3.5 — NIFTY FUTURES MICROSTRUCTURE -> DIRECTION
2026-08-28 · research only · no orders · DEV+VALID (2015-01-09..2022-12-30)
TEST WINDOW NOT OPENED.

## D. HARNESS REGRESSION (run before any hypothesis)
  Phase 2.9c reproduced: compression vol-matched ratio 1.21, t=3.90   PASS
  Safety: 0 reachable realOrders:true · 0 broker imports in research scripts
  Production code NOT modified. live/kite-market.js never requests oi=1 and
  drops any 7th column, so a RESEARCH-LOCAL fetcher (scripts/fut-fetch.js)
  was written instead of touching the live fetcher.

## A. DATA AUDIT
  INSTRUMENTS   3 live NIFTY FUT contracts (Sep/Oct/Nov 2026), lot 65.
                Note: the NFO dump quotes the `name` field ("NIFTY"), which
                silently returned 0 matches until stripped — a parsing trap
                worth recording.
  INTRADAY      Kite serves 5-min futures OHLC + volume + OI via oi=1.
  DAILY         NSE F&O bhavcopy FUTIDX rows, 5,922 NIFTY futures records
                across 1,974 sessions 2015-2022 (already downloaded in 3.4).
                Fields: date, expiry, close, contracts(volume), OI, chg-in-OI.

## C. OBSERVABILITY AUDIT — THE PIVOTAL FINDING

  IS FUTURES OI GENUINELY INTRADAY?  YES.
    NIFTY26SEPFUT, 5 sessions probed: 77 bars per session, 76-77 DISTINCT OI
    values per session, OI rising monotonically through each day
    (e.g. 2026-08-24: 6,707,090 -> 10,208,835).
    This is true intrabar OI, NOT an end-of-day snapshot repeated across bars.
    It is the genuinely new information this phase was designed to test.

  BUT THE HISTORY DOES NOT EXIST.
    NIFTY26SEPFUT   43 sessions   2026-07-01 -> 2026-08-28
    NIFTY26OCTFUT   23 sessions   2026-07-29 -> 2026-08-28
    NIFTY26NOVFUT    3 sessions   2026-08-26 -> 2026-08-28
    UNION: 43 distinct sessions = 0.17 TRADING YEARS.

    Expired futures contracts drop out of /instruments, so their tokens are
    unresolvable — exactly the constraint established for options in Phase
    2.6. A futures contract is listed ~3 months before expiry, so the union
    of live contracts can never cover more than ~3 months of history.

  CONSEQUENCE: intraday futures volume + OI is DATA-LIMITED and CANNOT be
  taken through DEV/VALID/TEST. No hypothesis requiring it was tested.
  Per §3, features whose source timestamp is later than the signal timestamp
  were rejected rather than approximated.

  WHAT REMAINED TESTABLE: daily futures volume, OI, OI change and BASIS
  (futures close - spot close), taken from session T-1 and observable
  throughout session T. Basis is genuinely absent from index OHLC and is the
  one real addition this phase could test with full history.

## B. CONTRACT CONSTRUCTION
  No synthetic continuous series was built. The primary analysis uses the
  FRONT contract (nearest unexpired expiry as of session T-1) — a rule that
  uses only information available at the signal timestamp. Volume-dominant
  and OI-dominant selection were NOT used as alternatives, because both
  require the session's final volume/OI ranking, which is unavailable
  intraday; using them would have been a look-ahead violation.
  Roll artefacts are avoided because no return is ever computed ACROSS a
  contract change — all forward returns are measured on the INDEX, never on
  the futures price.

## E/F/G. FROZEN LIBRARY, MULTIPLE TESTING, ECONOMIC HURDLE
  20 conditions, each two-sided (a condition and its exact negation are ONE
  hypothesis). Bonferroni 0.05/20 = 0.0025 -> |t| > 3.05.
  Economic hurdle from the repo cost model: 3.13 index points.
  Event: ONE per session, evaluated once at the first bar at/after 09:45,
  entry at OPEN of the next bar, 45-minute hold.

  buildup B1-B6  price/OI four-quadrant framework + strong-buildup variants
  volume  V1-V4  relative futures volume vs 20-day median, and volume+OI
  basis   S1-S6  premium/discount level, change, sign, basis+OI
  oi      O1-O2  OI change magnitude, continuation and fade
  expiry  X1-X2  rollover-period and far-expiry conditioning

## H/I. DEV AND VALID RESULTS
  ID  n     long% | DEV diff    t   | VALID diff    t   | econ
  B1   516  100%      0.83    0.56       0.41    0.12    no
  B2   368    0%      2.05    1.12       1.66    0.47    no
  B3   523    0%     -2.56   -1.48      -3.57   -1.17    no
  B4   537  100%      0.62    0.40       4.88    1.05    no
  B5   327  100%      1.96    1.08       3.62    0.86    no
  B6   216    0%     -3.25   -1.21       7.35    1.48   YES  (sign FLIPS)
  V1   155   38%     -0.65   -0.16      -7.97   -0.64    no
  V2    32  too few
  V3   161   51%      1.83    0.78       8.20    1.65    no
  V4    72  too few
  S1  1218  100%     -0.23   -0.24      -1.22   -0.54    no
  S2   203    0%     -2.83   -0.79     -13.67   -1.82    no
  S3   656  100%      0.73    0.48       0.89    0.28    no
  S4   726    0%      0.50    0.38      -0.88   -0.23    no
  S5  1944   87%     -1.30   -1.55      -3.50   -1.66    no
  S6   690  100%     -1.33   -1.06       0.46    0.15    no
  O1   408   58%     -0.56   -0.31       2.61    0.68    no
  O2   551   55%     -1.12   -0.74       0.70    0.16    no
  X1   267   47%     -1.00   -0.48      -4.59   -0.99    no
  X2   453  100%     -1.53   -0.93       3.72    0.97    no

  SURVIVORS: 0.  Rejections: 18 fail DEV Bonferroni · 2 insufficient sessions.
  HIGHEST DEV |t| IN THE ENTIRE PHASE: 1.55 (S5), against a 3.05 threshold.
  That is weaker than Phase 3.4 (1.82) and Phase 3.3 (4.13).
  The only condition clearing the economic hurdle in both windows (B6) does so
  with the SIGN REVERSED between them (-3.25 -> +7.35) on n=216: noise.

## J. TEST DECISION
  NOT OPENED. Nothing satisfied the pre-declared gate, so under §17-18 there
  was nothing to freeze.

## K. CONTROL ANALYSIS
  Direction + time-of-day + volatility-decile matched, different session,
  frozen decile bounds. Essential here: 12 of 20 conditions are ONE-SIDED by
  construction (long% of 0 or 100), so raw returns are dominated by index
  drift. Several conditions have large raw signal means (S2 VALID -10.13,
  V1 VALID -8.61) that mostly vanish or reverse once matched — a direct
  demonstration of why raw expectancy is not evidence.

## L/M/N/O. INCREMENTAL INFORMATION / ROBUSTNESS / REGIME / PLACEBO
  Not run. Pre-declared under §13-15 for candidates passing the primary
  DEV/VALID gates. Nothing passed. Running them now would be the rescue
  behaviour §14 explicitly prohibits.

## P. SAFETY AUDIT
  reachable realOrders:true                     0
  research scripts importing broker modules     0
  placeOrder / modifyOrder / cancelOrder        none reachable
  production live/kite-market.js                UNMODIFIED
  Real orders placed: NO.

## Q. FINAL VERDICT

  >>> NO DIRECTIONAL EDGE FROM FUTURES MICROSTRUCTURE —
      CONTINUE ONLY WITH A NEW INFORMATION SET. <<<

  Answering §23 exactly as asked:

  "Does observable NIFTY futures volume/OI contain incremental, economically
   sufficient directional information about the next 45 minutes after
   controlling for time of day, direction balance, volatility regime and
   existing index OHLC information?"

  On the data that historically exists — DAILY, one-session-stale volume, OI
  and basis — NO. Twenty pre-registered conditions produced a maximum DEV
  t-statistic of 1.55. The incremental-information test was not reached
  because nothing cleared the primary gate.

  The intraday version of the question — which is the one that matters, and
  which this audit confirmed is answerable in principle because Kite reports
  TRUE INTRABAR OI — CANNOT BE ANSWERED TODAY. Only 43 sessions exist.
  Classification for that branch: DATA-LIMITED, not tested, not refuted.

## R. NEXT RESEARCH DECISION

  Two things follow, and they are different in kind.

  1 START COLLECTING INTRADAY FUTURES DATA NOW. This is the concrete action.
    Unlike options (thousands of strikes), NIFTY futures are THREE contracts
    at a time. A daily collector is cheap, and the data — 5-min OHLC, real
    volume, TRUE INTRADAY OI — is the single most promising untested
    information set found in this entire programme. At ~250 sessions/year it
    reaches a testable sample in roughly 2 years. Every day not collected is
    permanently lost, exactly as with the Phase 3.0 shadow archive.

  2 CROSS-ASSET LEAD/LAG is the only remaining information set testable with
    existing history (USDINR, crude, SGX/GIFT NIFTY). Honest prior: low.
    SGX/GIFT NIFTY is largely a re-expression of NIFTY itself, and after
    ~110 formulations across index OHLC, options OI and futures daily, the
    base rate for a further discovery from adjacent price series is poor.

  Recommendation: do (1) immediately and treat (2) as optional. The
  programme's best remaining question now depends on elapsed time, not on
  further searching of data that already exists.
