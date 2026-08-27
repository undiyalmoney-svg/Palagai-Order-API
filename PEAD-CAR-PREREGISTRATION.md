# PEAD-CAR — PRE-REGISTRATION

**Written BEFORE any test was run. Frozen on commit.**
Any change after a TEST-window result is observed invalidates the study and must
be declared a NEW hypothesis with a new ID.

- **ID:** PEAD-CAR-001
- **Status at time of writing:** DEV not yet run. VALID not run. TEST not run.

---

## 1. Economic mechanism

Investors under-react to earnings news. Information diffuses gradually — not all
holders re-evaluate on announcement day, institutional mandates constrain
immediate repositioning, and attention is limited during dense reporting weeks.
The price therefore continues to drift in the direction of the initial surprise
after the announcement-day repricing is complete. Documented since Ball & Brown
(1968); Bernard & Thomas (1989).

**Why arbitrage may be incomplete:** the drift is spread over weeks and is
noisy per event, so capturing it requires many simultaneous small positions and
tolerance for high idiosyncratic variance — costly for constrained capital.

**Falsification:** if post-reaction drift is zero or negative once prior
momentum is controlled for, the mechanism is absent in this market.

---

## 2. Event definition

- **Universe:** all NSE `EQ`-series securities present in the bhavcopy on the
  event date — including those later delisted. Minimum median 20-day traded
  value ≥ ₹1 crore over the 20 sessions **before** the announcement (liquidity
  screen computed from pre-event data only).
- **Event:** a corporate filing whose `desc` matches `/financial result/i` in
  the NSE announcements feed.
- **Timestamp classification (IST):**
  - `PRE-OPEN` — before 09:15
  - `INTRADAY` — 09:15 to 15:30
  - `POST-CLOSE` — after 15:30
  - `UNKNOWN` — unparseable → **EXCLUDED from the primary test**
- **Exclusion:** any event with a corporate action (split / bonus / rights /
  merger / demerger) with `exDate` within **[-3, +5] sessions** of the reaction
  window is **dropped**, to prevent mechanical adjustments contaminating returns.

## 3. Reaction and drift windows — the momentum-contamination control

This is the core design requirement. Define, in trading sessions relative to
the first session where the news is fully tradeable (`day 0`):

| Window | Sessions | Purpose |
|---|---|---|
| **REACTION (CAR0)** | `day 0` only | The announcement repricing. **NOT traded.** Used solely as the surprise proxy. |
| **DRIFT** | `day +1` open → `day +K` close | The only window in which returns are counted. |

`day 0` assignment by timestamp:
- `POST-CLOSE` filing → `day 0` = next session (news impounds then)
- `INTRADAY` filing → `day 0` = same session (already moving)
- `PRE-OPEN` filing → `day 0` = same session

**Entry is at the OPEN of `day +1` — strictly after the reaction window has
closed.** The reaction return is therefore never included in P&L. This is what
separates PEAD from "stock went up, buy it": we are testing whether the
*already-completed* reaction predicts *subsequent* return.

**Prior-momentum control (mandatory):** every event carries `MOM60`, the
market-adjusted return from `day -65` to `day -6` (ending 5 sessions before
the event, so it cannot overlap the reaction). The primary result must be
reported **within MOM60 terciles**. If the drift effect exists only in the
high-MOM60 tercile, it is momentum, not PEAD, and is reported as such.

## 4. Abnormal return

Market-adjusted: `AR = stock return − NIFTY 50 return` over the identical
window. No beta estimation (avoids an estimation-window parameter and its
associated researcher degrees of freedom).

- `CAR0` = market-adjusted return on `day 0`
- `DRIFT_K` = market-adjusted return, `day +1` open → `day +K` close

## 5. Frozen parameters

| Parameter | Value | Note |
|---|---|---|
| Surprise buckets | CAR0 quintiles, ranked **within each calendar quarter** | prevents look-ahead from full-sample ranking |
| Primary K | **20 sessions** | declared primary; K ∈ {5,10,20,40} reported as a declared family |
| Direction | **LONG top-quintile CAR0 only** | long-only constraint |
| Min events per bucket | 200 in DEV | below this → INSUFFICIENT |
| Outliers | winsorise DRIFT at 1st/99th pct; **raw also reported** | never silently dropped |
| Position sizing | equal-weight, max 10 concurrent | |
| Costs | Zerodha CNC: STT 0.1%×2, exch 0.00297%×2, SEBI 0.0001%×2, stamp 0.015% buy, DP ₹17.70/sell, GST 18% | per-component |
| Slippage | 0.10% / leg primary; swept 0.25 / 0.50 / 0.75 / 1.00% round-trip | |
| Benchmark | Nifty 50 price index (TRI ≈ +1.3%/yr noted separately) | |

## 6. Windows

| Split | Dates | Use |
|---|---|---|
| DEV | 2015-01-01 → 2019-12-31 | establish effect |
| VALID | 2020-01-01 → 2022-12-31 | challenge it |
| **TEST** | **2023-01-01 → 2026-08-21** | **LOCKED — opened once, after freeze** |

TEST has **not** been inspected for this hypothesis. Unlike prior studies in
this project, this window is genuinely blind for PEAD-CAR.

## 7. Multiple testing

Declared family: 4 horizons × 5 quintiles = **20 primary tests**.
Bonferroni threshold: **p < 0.0025**. FDR (Benjamini-Hochberg) also reported.
Any additional variant tested becomes part of the family and the count is
updated in the final report. Cumulative project count (~425 prior) is disclosed
alongside — this hypothesis is pre-registered, but the *research programme*
is not, and the winner's-curse caveat still applies at programme level.

## 8. Decision rule — declared in advance

**A. ROBUST** requires ALL of:
1. DRIFT_20 for top CAR0 quintile > 0 in DEV **and** VALID **and** TEST
2. Survives Bonferroni in DEV
3. Effect present in **≥2 of 3** MOM60 terciles (not momentum in disguise)
4. Net of costs and 0.10% slippage, positive in TEST
5. No single sector > 40% of gross P&L
6. Not tail-dependent: positive after removing top 5% of winners
7. ≥200 events per bucket in each window

Failing any → **B (insufficient) / C (too small) / D (artifact) / E (no edge) /
F (data insufficient)**, whichever the evidence indicates.

## 9. Stop conditions

Abort and report DATA INSUFFICIENT if: G5 cannot classify mechanical moves;
>10% of results events lack parseable timestamps; the liquidity screen leaves
<200 events per bucket per window.
