# PEAD-RESIDUAL-001 — PRE-REGISTRATION

**Written BEFORE any result was computed. Frozen on commit.**
PEAD-CAR-001 is permanently rejected and is not modified, rescued, or reused
here beyond the already-frozen clean event universe (sha256 `bf3dcb81…`).

---

## Mechanism

An earnings announcement carries information only partially impounded on the
announcement session. After removing market, size, sector and pre-event
momentum exposure, any residual predictive content should show up as continued
drift in the direction of the *residual* reaction.

**This is not a claim that PEAD-CAR-001 was valid.** That test failed because
"abnormal return vs Nifty 50" embedded a size factor whose sign flipped with the
small-cap cycle. This design removes that channel by construction.

## Why the Q5−Q1 spread is the primary statistic

Both legs are drawn from the **same event pool on the same dates**. Any factor
that lifts or depresses all event stocks in a period — the small-cap cycle, a
market regime, a reporting-season effect — moves Q5 and Q1 **together** and
cancels in the difference. This is the specific correction for the failure mode
that killed PEAD-CAR-001.

Q5 alone is also reported, because only the long leg is implementable under the
account's long-only constraint (Indian retail cannot short cash equity
overnight). A spread that works while Q5 alone does not is a scientific result,
not a tradeable one, and will be labelled as such.

## Matched control (the factor adjustment)

Factor *portfolios* cannot be built: **no shares outstanding are available**, so
market cap is not computable. Instead, characteristic matching:

For each event, the peer group is all stocks on the same session with:
- **same sector** (NSE `smIndustry`)
- **same ADTV tercile** (20-day average traded value — size/liquidity proxy)
- **same pre-event momentum tercile** (day −65 → day −6)
- **no earnings event of their own within ±5 sessions**

Terciles are computed **cross-sectionally on that session only** — never from
the full sample, so no future information enters.

`abnormal = event return − mean(peer returns)` over the identical window.
This nets out market, size, sector and momentum simultaneously.

**Minimum 5 peers.** Fewer → event EXCLUDED from the primary matched test.
Matching criteria are frozen and will not be loosened after seeing results.

## Windows (frozen)

`day0` = first session where information is public and tradeable
(post-close filing → next session; intraday/pre-open → same session).

| Window | Definition | Traded? |
|---|---|---|
| REACTION | day0 → day0+1 close | **No** — ranking variable only |
| **DRIFT-A (primary)** | day0+2 open → day0+5 close | Yes |
| **DRIFT-B (primary)** | day0+2 open → day0+20 close | Yes |
| Reported also | day0 → +5, day0 → +20 | diagnostic |

Entry at day0+2 **open** is strictly after the reaction window closes, so the
reaction can never enter P&L.

## Splits

| Split | Dates | Role |
|---|---|---|
| DEV | **2015-01-01 → 2018-12-31** | discovery |
| VALID | 2019-01-01 → 2022-12-31 | **decisive confirmation** |
| TEST | 2023-01-01 → 2026-08-21 | **NON-BLIND — diagnostic only** |

*DEV starts 2015, not 2013: bhavcopy history begins 2015-01-01. Disclosed
limitation, not a choice.*

**Primary confirmation requirement: SIGN CONSISTENCY of the Q5−Q1 spread
between DEV and VALID.** TEST cannot confirm anything.

## Statistics

Mean, median, win rate, SD, bootstrap 95% CI, t-statistic, n events, n unique
companies. **Standard errors clustered by company** — repeated events from one
firm are not independent. Declared family: 2 primary horizons × 3 windows = 6
primary tests; Bonferroni p < 0.0083. Cumulative programme count (~426 prior
hypotheses) disclosed alongside; winner's curse applies at programme level.

## Decision rule (declared in advance)

**A = ROBUST** requires ALL of:
1. Q5−Q1 spread > 0 in DEV
2. Q5−Q1 spread > 0 in VALID
3. Survives factor/matched controls (is the matched result, by construction)
4. Median not catastrophically negative
5. Not dependent on top 1–5% winners
6. Not dominated by one company
7. Not dominated by one sector
8. Survives placebo and permutation tests
9. Survives multiple-testing correction
10. Positive after realistic costs
11. Practical ₹2,00,000 implementation exists

Otherwise **B** (too small) / **C** (insufficient) / **D** (methodology) /
**E** (false).

## Stop conditions

If DEV and VALID spreads disagree in sign → **STOP, classify E, do not generate
a variant.** If matched peer groups are unavailable for >50% of events → report
as data-insufficient rather than loosening matching.
