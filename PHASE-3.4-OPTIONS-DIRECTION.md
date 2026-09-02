# PHASE 3.4 — OPTIONS-DERIVED INFORMATION -> DIRECTIONAL EDGE
2026-08-28 · research only · no orders · DEV+VALID (2015-01-09..2022-12-30)
TEST WINDOW NOT OPENED.

## HARNESS REGRESSION (run before touching option data)
  Phase 2.9c reproduced: compression vol-matched ratio 1.21, t=3.90  PASS
  next-bar-open, event-first, frozen vol-decile bounds, look-ahead guard: intact
  Safety: 0 reachable realOrders:true · 0 broker imports in research scripts

## A. DATA AUDIT
  SOURCE      NSE F&O bhavcopy, legacy format, downloaded for every session in
              the DEV+VALID index calendar (no invented calendar).
  COVERAGE    1,977 files / 938 MB / 1,974 distinct sessions
              4,713,570 NIFTY OPTIDX rows extracted
  FIELDS      INSTRUMENT, SYMBOL, EXPIRY_DT, STRIKE_PR, OPTION_TYP, OPEN, HIGH,
              LOW, CLOSE, SETTLE_PR, CONTRACTS, VAL_INLAKH, OPEN_INT,
              CHG_IN_OI, TIMESTAMP
  GRANULARITY DAILY ONLY. The TIMESTAMP column is the TRADE DATE
              (e.g. "18-MAR-2016"), not an intraday timestamp.
              => OI is END-OF-DAY. It is labelled DAILY OI throughout and is
              never described as order flow.

## N. SURVIVORSHIP AUDIT — PASS
  The 2016-03-18 file contains contracts expiring 31-Mar-2016, i.e. contracts
  long since expired. Each daily file is a full snapshot of every contract
  alive that day. No survivorship bias.

## B. OBSERVABILITY AUDIT (§5, applied as an absolute rule)
  Question asked of every feature: could a trader have known this value
  immediately before the signal?

  END-OF-DAY OI on session T is NOT knowable during session T.
  Therefore EVERY option feature used here is computed from session T-1's
  close and is observable throughout session T. No same-day OI is used
  anywhere.

  RULED OUT BY THIS AUDIT — not tested, not approximated:
    intraday OI and OI shifts        (data does not exist)
    intraday option prices           (expired-contract intraday unavailable)
    put-call parity residual         (needs synchronous intraday quotes)
    skew and term structure          (needs intraday IV surface)
    §4 family D "option price structure" as an INTRADAY input
  These are DATA LIMITATIONS, not evidence against the ideas.

## C/D. FROZEN LIBRARY — 22 CONDITIONS, EACH TWO-SIDED
  Event: ONE per session. The prior-day OI feature is constant through the
  session, so the condition is evaluated ONCE, at the first bar at/after
  09:45; entry = OPEN of the next bar; hold 45 minutes. This construction
  makes a persistent-state artifact impossible.

  pcr     P1 PCR>1.2 bullish · P2 PCR<0.8 bearish · P3 both tails contrarian
          P4 dPCR>+0.10 bullish · P5 dPCR<-0.10 bearish
  oichg   O1 net (put-call) OI change · O2 call OI building bearish
          O3 put OI building bullish
  struct  S1 spot just below max-call strike · S2 spot just above max-put
          S3 spot above max-call (broken resistance) · S4 spot below max-put
          S5 nearer max-put than max-call · S6 OI centre of mass vs spot
  conc    C1 call OI above spot dominates · C2 put OI below spot dominates
          C3 ATM put vs call OI · C4 (pBelow-cAbove) asymmetry
  expiry  X1 DTE<=2 + PCR>1.2 · X2 DTE>=5 + PCR>1.2 · X3 DTE<=2 near max-call
  vix/oi  V1 PCR>1.2 + prior-day up close

## E. CONTROL METHODOLOGY
  Direction-matched + time-of-day-matched + pre-event volatility-decile
  matched, different session, frozen decile bounds.
  This mattered here more than in any prior phase: many OI hypotheses are
  ONE-SIDED by construction (P1 100% long, P2 0% long, C2 100% long). Raw
  signal returns are therefore dominated by whichever way NIFTY drifted. Only
  the matched difference is interpretable, and that is what is reported.

## F/G. DEV AND VALID RESULTS
  Gate: DEV |t|>3.05 (Bonferroni 0.05/22) AND VALID same sign AND |t|>1.96
        AND |signal-control| > 3.13 pts in BOTH windows.

  ID  n     long% | DEV diff    t   | VALID diff    t   | econ
  P1   526  100%      0.90    0.62       1.19    0.38    no
  P2   387    0%     -5.42   -1.59       7.89    1.46   YES  (sign FLIPS)
  P3   456   87%     -2.85   -1.31      -4.75   -1.09    no
  P4   473  100%      3.61    1.82       3.10    0.94    no
  P5   448    0%      0.12    0.05      -0.21   -0.04    no
  O1  1657   56%     -0.26   -0.27      -2.18   -1.06    no
  O2   822    0%      0.63    0.42       2.15    0.64    no
  O3   809  100%      1.57    1.24      -1.21   -0.47    no
  S1    89  too few · S2 87 too few · S3 85 too few · S4 103 too few
  S5  1964   50%     -0.40   -0.49      -0.15   -0.06    no
  S6  1716   49%     -0.79   -0.90      -1.23   -0.58    no
  C1   957    0%     -1.25   -0.77      -4.13   -1.54    no
  C2  1312  100%     -0.06   -0.06      -0.99   -0.43    no
  C3  1278   54%      0.71    0.69       2.45    1.00    no
  C4  1649   70%     -0.41   -0.45      -1.53   -0.63    no
  X1   131  too few
  X2   348  100%     -0.49   -0.29       4.49    1.07    no
  X3    52  too few
  V1   338  100%     -1.64   -1.03      -2.07   -0.59    no

  SURVIVORS: 0.
  Rejections: 16 fail DEV Bonferroni · 6 insufficient sessions.

  THE HIGHEST DEV |t| ACROSS ALL 22 CONDITIONS IS 1.82 (P4). Nothing came
  close to the 3.05 threshold. This is a weaker result set than any prior
  phase — in Phase 3.3 one condition at least passed DEV before dying in
  VALID; here nothing passes even the first gate.

## H. TEST RESULTS
  NOT OPENED. Nothing satisfied the pre-declared gate, so under §22 there was
  nothing to freeze.

## I. ECONOMIC ANALYSIS
  Hurdle from the repo cost model: 3.13 index points.
  One condition (P2) exceeded it in both windows — with the SIGN REVERSED
  between them (DEV -5.42, VALID +7.89) on n=387. That is the signature of
  noise at small sample, not an edge.

## J/K/L/M. DTE / VIX / PLACEBO / OUTLIER
  Not run. Pre-declared under §16 for candidates that pass DEV+VALID.
  Running them on failed hypotheses is the rescue behaviour §24 prohibits.

## O. SAFETY AUDIT (start and end of phase)
  reachable realOrders:true                 0
  research scripts importing broker module  0
  placeOrder / modifyOrder / cancelOrder    none reachable from research
  p34-oi.js imports                         fs, readline only
  Real orders placed: NO.

## P. CANDIDATE VERDICTS
  P2                     F — FAILED. Sign inverts between DEV and VALID.
  P4                     F — FAILED. Best DEV t in the phase at 1.82; VALID
                         t=0.94. Directionally consistent but far short.
  P1,P3,P5,O1,O2,O3,S5,S6,C1,C2,C3,C4,X2,V1   F — FAILED, no effect.
  S1,S2,S3,S4,X1,X3      E — DATA-LIMITED. 52-103 events over 8 years: the
                         precise strike-proximity conditions are simply too
                         rare at daily granularity to test.
  intraday OI, option price structure, skew, term structure, parity residual
                         E — DATA-LIMITED. Not testable; not tested.

## Q. OVERALL DECISION

  >>> NO DIRECTIONAL EDGE FROM OPTIONS-DERIVED STATE. KILL. <<<

  Answering the phase question directly: does the option market contain
  information about future NIFTY direction that OHLC alone does not?
  On the information actually available — END-OF-DAY open interest, one
  session stale — the answer is NO, and not marginally: the strongest
  DEV t-statistic in 22 pre-registered conditions was 1.82.

  IMPORTANT QUALIFICATION, stated so this is not over-read: what was killed
  is DAILY, ONE-SESSION-STALE OI STRUCTURE. Intraday OI — which is what
  practitioners actually watch — could not be tested because the data does
  not exist historically. This phase does not refute intraday option flow;
  it establishes that the daily residue of it carries no usable directional
  information.

## §24. WHERE THE EVIDENCE POINTS NEXT
  FAILED INFORMATION SETS SO FAR:
    NIFTY 5-min OHLC — ~70 formulations (Phases 2.7, 2.8, 3.3)
    volatility/compression — real effect, below option friction (2.9, 3.0b, 3.2)
    daily options OI structure — this phase, 22 conditions
    daily cash-equity cross-section — Program 438, 3 portfolio candidates

  REMAINING, IN ORDER OF DATA AVAILABILITY:
    1 CROSS-ASSET LEAD/LAG — USDINR, crude, and especially SGX/GIFT NIFTY,
      which trades while NSE is closed and through the session. Kite exposes
      currency and commodity historical data; this is testable NOW with the
      existing harness and needs no new data source.
    2 INDEX-FUTURES ORDER FLOW — NIFTY futures carry real volume and OI,
      unlike the index. Futures 5-min volume IS available from Kite. This is
      the closest available proxy for order flow and is testable now.
    3 Intraday option flow — requires forward collection; years away.

  Recommendation for the next phase: option 2 (futures volume/OI) is the
  strongest remaining candidate, because it introduces genuinely new
  information (volume, which the index simply does not have) using data that
  already exists and a harness that is already validated.
