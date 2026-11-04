# Universe capital, instrument selection and daily-profit study — 2026-11-04

Research only. `liveOrders` stays false. The Paper 14k desk was not modified.
No historical blotter row was edited. The Kite access token used to quote
live books was never written to this repository.

**Verdict: NO VALIDATED EDGE — DO NOT DEPLOY LIVE CAPITAL.**

Reproduce:

```
python3 market-recorder/research/universe_capital.py
python3 market-recorder/research/test_universe_capital.py
```

Inputs (outside git, no token): `/tmp/optres/out/universe-live.json`,
`universe-margins.json`. Snapshot copy:
`market-recorder/research/snapshots/universe-capital-2026-11-04.json`.

Live quotes and Kite `POST /margins/orders` NRML figures are as of
**4 Nov 2026, 13:28 IST** (India VIX 15.53). Charges follow `costs.py`
(Zerodha schedule checked 2026-11-02). Expectancy is copied from
`OPTIONS-BUYING-RESEARCH.md` and `PAPER14K-AUDIT-2026-11-04.md`, or marked
INCONCLUSIVE. A green modelled cell is not a live edge.

---

## Implementation plan (Part 15, done first)

1. Inspected architecture: Angular Paper 14k desk (`liveOrders=false`);
   Order-API droplet; recorder v1.1.0 ATM±3; research on
   `cursor/paper14k-audit-fe4b`.
2. Reviewed the 4 Nov audit: four paper scratches, exact net −₹1,042;
   Models A–D rejected for live.
3. Data available: 3y index 5m + VIX (Nifty/Bank/Sensex); 14 weeks listed
   Crude Mini; live specs for all eight today. Missing: executable history
   for FinNifty, Midcap Nifty, Bankex, standard Crude.
4. Plan: research branch only; assembler + tests + this note; no desk
   change; no merge; no live orders.
5. APIs used read-only: Kite instruments (NFO/BFO/MCX), quote, margins.
   Token via env only.
6. Tests: `test_universe_capital.py` (bands, liquidity, charges, journal,
   plans) plus existing `test_costs.py` / `test_paper14k_audit.py`.

---

## Part 1 — Instrument universe (official specs, this snapshot)

Hours: NSE/BSE index derivatives **09:15–15:30 IST**. MCX energy
**09:00–23:30 IST**.

| ID | Venue | Spot | Lot (units) | Tick | Tick ₹ | Front future | Option front | Weekly? |
|---|---|---:|---:|---:|---:|---|---|---|
| NIFTY | NSE | 23,868 | 65 | 0.10 | 6.50 | 23 Nov | **9 Nov** (Tue weeklies) | yes |
| BANKNIFTY | NSE | 55,740 | 30 | 0.20 | 6.00 | 23 Nov | **23 Nov** (monthly last Tue) | no |
| FINNIFTY | NSE | 25,495 | 60 | 0.10 | 6.00 | 23 Nov | 23 Nov monthly | no |
| MIDCPNIFTY | NSE | 13,670 | 120 | 0.05 | 6.00 | 23 Nov | 23 Nov monthly | no |
| SENSEX | BSE | 77,091 | 20 (25 from Jan-27) | 0.05 | 1.00 | 26 Nov | **5 Nov (DTE 1)** weeklies | yes |
| BANKEX | BSE | 62,698 | 30 | 0.05 | 1.50 | 26 Nov | 26 Nov monthly | no |
| CRUDEOIL | MCX | 9,126 | 1 ex lot = **100 bbl** | 1 | 100 | 19 Nov | 17 Nov | monthly |
| CRUDEOILM | MCX | 9,128 | 1 ex lot = **10 bbl** | 1 | 10 | 19 Nov | 17 Nov | monthly |

Do not assume one rule set works on all eight. Bank Nifty / FinNifty /
Midcap Nifty / Bankex are monthly option books. Sensex on this date is
DTE 1. Crude is a USD-oil × INR book with an evening session.

---

## Part 2 — One-lot capital and costs

**Never confuse premium paid with futures margin.** Option-buy cash is
`ask × units`. Futures / short-option figures are Kite NRML (SPAN +
exposure) for **one** lot. Maximum theoretical loss on a long option is
the premium. Estimated stop below is 25% of ATM cash plus a scratch-flat
round trip — a scale, not a recommended stop.

### Option buying (ATM CE ask, 1 lot)

| ID | ATM ask | 1-lot cash | +4 OTM cash | Spread | Spread ₹ | RT charges | 25% stop + chg | Book |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| NIFTY | 178.00 | **11,570** | 6,178 | 0.14% | 16 | 75 | 2,967 | ok |
| BANKNIFTY | 786.00 | **23,580** | 17,430 | 0.10% | 23 | 103 | 5,998 | ok |
| FINNIFTY | 367.30 | **22,038** | 16,176 | 0.90% | 198 | 99 | 5,609 | ok / thinner |
| MIDCPNIFTY | 243.65 | **29,238** | 23,112 | 0.56% | 162 | 117 | 7,426 | ok / thinner |
| SENSEX | 351.15 | **7,023** | 3,790 | 0.29% | 20 | 63 | 1,819 | ok, DTE 1 |
| BANKEX | 1,090.35 | 32,711* | 53,876* | **43%** | 11,654 | 122 | — | **untradeable** |
| CRUDEOIL | 436.50 | **43,650** | 35,260 | 0.32% | 140 | 114 | 11,026 | ok, large |
| CRUDEOILM | 444.55 | **4,446** | 3,596 | 0.26% | 12 | 54 | 1,165 | ok |

\*Bankex ATM bid 702 / ask 1,090. OI 0–1,800. Those cash numbers are not
executable.

### Option selling vs futures (1 lot NRML)

| ID | Fut NRML | Fut RT chg | Opt-sell NRML | Opt-sell note |
|---|---:|---:|---:|---|
| NIFTY | 1,76,108 | 926 | 1,69,569 | credit is not margin |
| BANKNIFTY | 1,89,629 | 994 | 1,80,382 | |
| FINNIFTY | 1,73,148 | 912 | 1,60,894 | |
| MIDCPNIFTY | 1,97,077 | 977 | 1,81,987 | |
| SENSEX | 1,75,142 | 854 | 1,68,571 | BSE txn 0 on futures |
| BANKEX | 2,13,268 | 1,031 | 2,07,474 | do not sell this book |
| CRUDEOIL | 2,84,501 | 204 | 3,26,291 | 100 bbl |
| CRUDEOILM | **28,450** | 63 | 32,683 | 10 bbl |

Futures charges on the indices are ~₹850–1,030 a round trip (~14–33
points). That is why the 3-year futures grid had **zero** profitable
train configs (T8). Crude futures charges are smaller in rupees because
the notional is smaller, not because there is an edge.

### Charge breakdown (ATM CE, scratch-flat = buy=sell)

Brokerage is ₹40 RT on every option. The rest scales with premium.

| ID | Brokerage | STT/CTT | Txn | SEBI | Stamp | GST | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| NIFTY | 40 | 17.36 | 8.22 | 0.02 | 0.35 | 8.68 | 74.63 |
| BANKNIFTY | 40 | 35.37 | 16.76 | 0.05 | 0.71 | 10.22 | 103.11 |
| FINNIFTY | 40 | 33.06 | 15.66 | 0.04 | 0.66 | 10.03 | 99.45 |
| MIDCPNIFTY | 40 | 43.86 | 20.78 | 0.06 | 0.88 | 10.95 | 116.52 |
| SENSEX | 40 | 10.53 | 4.56 | 0.01 | 0.21 | 8.02 | 63.35 |
| CRUDEOIL | 40 | 21.82 CTT | 36.49 | 0.09 | 1.31 | 13.78 | 113.50 |
| CRUDEOILM | 40 | 2.22 CTT | 3.72 | 0.01 | 0.13 | 7.87 | 53.95 |

MCX uses CTT (0.05% of sell premium on options, 0.01% sell on futures),
not STT. GST is 18% on brokerage + txn + SEBI.

### Capital bands (option-buy book; do not use the whole account)

Minimum = 1.5× ATM cash. Recommended = 2× ATM. Conservative =
max(3× ATM, 1.3× futures NRML).

| ID | Minimum | Recommended | Conservative |
|---|---:|---:|---:|
| NIFTY | 17,355 | **23,140** | 2,28,940 |
| BANKNIFTY | 35,370 | **47,160** | 2,46,518 |
| FINNIFTY | 33,057 | 44,076 | 2,25,092 |
| MIDCPNIFTY | 43,857 | 58,476 | 2,56,200 |
| SENSEX | 10,534 | **14,046** | 2,27,685 |
| BANKEX | — | — | — (untradeable) |
| CRUDEOIL | 65,475 | 87,300 | 3,69,851 |
| CRUDEOILM | 6,668 | **8,891** | 36,985 |

A ₹14,000 sticker book does **not** fund Bank Nifty ATM (₹23,580) or
standard Crude (₹43,650).

---

## Part 3 — One-lot profitability (separate books)

No instrument has a statistically supported **positive after-cost
expectancy on real executable quotes**.

| ID | Status | Gross / net / PF / WR / DD | Why |
|---|---|---|---|
| NIFTY | **NO_EDGE** | Paper 14k TEST modelled +₹101 [41, 156] n=171; VAL CI includes 0. T1 median train −₹51. Selected CE test −₹85 (p=0.51). | Modelled BS tape. T10 fidelity exists. Not 400 real fills. 4 Nov exact −₹221 / −₹217. |
| BANKNIFTY | **NO_EDGE** | TEST −₹24 PF 0.87 WR 31% DD ₹8,868. CI [−79, 32] includes 0. Negative train/val/test. | Live 4 Nov −₹249 on a ₹605 premium with a 5-pt scratch. |
| SENSEX | **NO_EDGE** | TEST +₹37 [−20, 95] includes 0. T10 real −₹437 vs model −₹45. | DTE-1 CE 4 Nov exact −₹356. |
| FINNIFTY | **INCONCLUSIVE** | — | No 3-year or listed-contract study. |
| MIDCPNIFTY | **INCONCLUSIVE** | — | Same. |
| BANKEX | **INCONCLUSIVE** | — | Book is not tradeable. History would not fix a 43% spread. |
| CRUDEOIL | **INCONCLUSIVE** | — | No dedicated 100-bbl study. Mini already loses. Size is 10×. |
| CRUDEOILM | **NO_EDGE** | T9 14 weeks: fut 0/540 train >0, median −₹95. Options real median −₹82; 4% configs >0. IV 51% vs realised 32%. | Overnight gap + USD/INR. Not 400 fills. |

Average holding time on Paper 14k is a same-session scratch or the 15:15
flat. Scratch is ~2/3 of modelled TEST exits (Nifty 99/171, Bank 117/169,
Sensex 110/167) and was 4/4 today.

Monthly consistency: not estimated as a live number. The 3-year momentum
candidate (not Paper 14k) was near zero from 2025Q3–2026Q1 and lost
2025Q1.

---

## Part 4 — Ranking

Expectancy is **not** a ranking key. Every name is NO_EDGE or
INCONCLUSIVE.

| Question | Answer |
|---|---|
| Best one-lot **paper** book | **NIFTY** — tightest two-sided book, deepest OI (~5.8M ATM), weeklies, ~₹75 RT. Still NO_EDGE. |
| Second | **SENSEX** — lowest index ATM cash (₹7,023). Refuse DTE 1. Still NO_EDGE. |
| Best low-capital | **CRUDEOILM** — ₹4,446 ATM / ₹28,450 fut NRML. T9 already loses. Cheap ≠ edge. |
| Best liquidity | **NIFTY** (then Bank Nifty, Sensex). |
| Best risk-adjusted | **NONE.** |
| Avoid | **BANKEX**; stacking Nifty+Bank+Sensex as “diversification”; standard Crude as a first book; any futures book as a substitute for an options edge. |
| Further research | FinNifty, Midcap Nifty, standard Crude, paper-only Model A on Nifty. |

Spread rank (tightest first, tradeable only): Bank Nifty, Nifty, Crude
Mini, Sensex, Crude, Midcap, FinNifty.

Cash rank (lowest recommended): Crude Mini, Sensex, Nifty, FinNifty,
Bank, Midcap, Crude.

---

## Part 5 — Portfolio scenarios (option-buy, 1 lot each)

Index names share equity beta, rates and FII flow. Crude Mini and
standard Crude are the same oil × INR bet at 10× size. Adding books is
usually **more of the same bet**.

| Scn | Books | ATM premium | Recommended capital | 25% day risk | Max option loss | Correlation |
|---|---|---:|---:|---:|---:|---|
| A | Nifty | 11,570 | **23,140** | 2,967 | 11,570 | single |
| B | Nifty+Sensex | 18,593 | 37,186 | 4,786 | 18,593 | one equity-beta book |
| C | Nifty+Sensex+Mini | 23,039 | 46,077 | 5,952 | 23,039 | index cluster **plus** crude |
| D | +Bank | 46,619 | 93,237 | 11,950 | 46,619 | same |
| E | +FinNifty | 68,657 | 1,37,313 | 17,559 | 68,657 | same |
| F | all except Bankex | 1,41,545 | 2,83,089 | 36,011 | 1,41,545 | same |

Net portfolio expectancy is **not** the sum of unvalidated single-name
numbers. Joint CI was not estimated. **None of A–F is suitable for live.**

**Preferred configuration (paper only): Scenario A — Nifty, one lot.**
It is the only book with weeklies, depth, and a completed (negative)
research file. Scenario C is the only *structurally* different two-driver
set; it is still two unvalidated bets, not a hedge.

---

## Part 6 — Daily trade frequency

Do not add trades to hit a rupee target. A no-trade day is valid.

| Trades / day / name | Finding |
|---|---|
| 0 | Allowed. Preferred when spread, DTE or structure fail. |
| 1 | Matches Paper 14k and the 3-year grids. Still no validated edge. |
| 2 | Doubles charges. 4 Nov Nifty: −₹221 then −₹217 after a scratch, no cooldown. |
| 3–5 | No study supports three independent +EV entries per name. Cost stack dominates. |
| >5 | Rejected. This is not a volume business at one-lot retail size. |

Time of day (desk as it stands): Nifty first entry 10:15 IST; Bank /
Sensex 09:45; flat 15:15. Crude energy 09:00–23:30 IST; the evening
session is a different overnight-gap market. Losing-day probability is
**not** a supported forecast. Modelled Paper 14k green-day rates (~31–42%
TEST) are not live probabilities.

**Optimal frequency: 0 or 1 per instrument.**

---

## Part 7 — Daily profit targets (hypothetical)

Targets ₹500 / 1,000 / 1,500 / 2,000 / 3,000 / 5,000 / 7,500 / 10,000
are **not supported by current evidence**.

Distinction:

| Quantity | Status |
|---|---|
| Average daily expectancy | **Unsupported** (no validated edge). |
| Median daily profit | **Unsupported.** |
| % profitable days | Modelled only; not live. |
| P(hit target) | **Unsupported.** |
| P(lose capital) | With non-positive expectancy and repeated bets, ruin probability → 1 if you keep sizing. |

Hypothetical identity only (Nifty-scale 25% stop ₹2,967, not a
recommended stop). For a ₹500 target with **one** trade you need +₹500
expectancy and win rates 58% / 39% / 29% at RR 1 / 2 / 3. Observed Paper
14k Bank TEST win rate is 31% with PF 0.87. For ₹10,000 you need either
~₹10,000 expectancy on one ticket or many unvalidated tickets.

Capital at a 2% daily-risk budget: ₹500 → ₹25,000; ₹2,000 → ₹1,00,000;
₹10,000 → ₹5,00,000. That is a **risk budget**, not an earning power.
Larger capital does not create an edge.

---

## Part 8 — Crude oil

| | CRUDEOIL | CRUDEOILM |
|---|---|---|
| Hours | 09:00–23:30 IST | same |
| Fut expiry | 19 Nov 2026 | 19 Nov 2026 |
| Opt expiry | 17 Nov 2026 | 17 Nov 2026 |
| Units | 100 bbl | 10 bbl |
| Tick / tick ₹ | 1 / ₹100 | 1 / ₹10 |
| Fut NRML | ₹2,84,501 | ₹28,450 |
| ATM CE cash | ₹43,650 | ₹4,446 |
| Fut OI | 9,934 | 30,342 |
| Opt ATM OI | 614 lots | 4,217 lots |
| Spread | 0.32% | 0.26% |
| Opt RT | ₹114 | ₹54 |
| Fut RT | ₹204 | ₹63 |
| Overnight gap | Yes — WTI/Brent after 23:30 IST, USD/INR, EIA/OPEC | same driver, 1/10 size |
| Study | INCONCLUSIVE | **NO_EDGE** (T9) |

Drivers (both contracts, not a timing system): international crude,
USD/INR, EIA inventories, OPEC, geopolitics, Sunday–Monday gaps. Mini is
the better **risk envelope** for one-lot observation. It is **not** more
profitable. Standard Crude is the same bet ten times larger. Options and
futures are different products: T9 futures 0/540 train >0; T9 options
median −₹82 on real premiums with IV over realised.

---

## Part 9 — Entry / exit audit (existing strategy)

Paper 14k: morning structure → primary/backup → confirmation candle →
cheap-OTM CE/PE at live ask → point scratch / SL / TP → 15:15 flat.
After the budget lift the desk binds at the live ask and shows 1-lot
cash. It still has no after-cost edge.

| Piece | Finding |
|---|---|
| Entry timing | pdhl / trap after OR. 4 Nov fills were all long CE. |
| Direction | Prior screen: CE buckets lose more than PE (T7b). |
| Strike | Picker aims far OTM; selected ATM+2–3 today. |
| Premium | Live ₹90–605 vs plan ₹50/100/150. |
| Liquidity / spread | Fine on Nifty/Bank/Sensex when quoted. Bankex unusable. |
| DTE | Sensex DTE 1 today. Refuse DTE 0; paper-hypothesis refuse DTE 1. |
| Scratch | Dominant exit. Designed for cheap OTM, fires on live ATM. |
| Re-entry | Nifty second ticket, no cooldown. |
| Separate strategies | Yes in principle (index options ≠ crude options ≠ futures). None is validated. |
| New indicators | Must show incremental **out-of-sample** lift. Independent Model A filters did not. Do not stack. |

Index futures and commodity futures need their own models. The futures
grid already failed after charges. Do not port Paper 14k points onto
Crude or FinNifty.

---

## Part 10 — One-lot risk framework (paper; still no live)

1. **Risk / trade:** ≤ 25% of the premium or the desk tick scratch, whichever
   is the written rule for that book. Never more than 2% of allocated cash.
2. **Daily loss:** ₹420/book on the desk. Research cap: 2% of allocated
   capital, then stand down for the session.
3. **Weekly loss:** 5% of allocated capital, then stand down until Monday.
4. **Consecutive losses:** 3 scratches → rest of day off. 5 → rest of week.
5. **Simultaneous positions:** 1.
6. **Correlated exposure:** Nifty + Bank + Sensex + FinNifty + Midcap +
   Bankex count as **one** equity-beta unit. Crude + Crude Mini count as
   one oil unit.
7. **Reserve:** ≥ 50% of the account stays in cash. Never deploy conservative
   (futures-scale) capital without a validated futures edge.
8. **Cooldown:** 60 minutes after a scratch; no second entry the same
   morning (risk rule, not a +EV claim).
9. **No-trade:** empty depth, spread > 3%, VIX event days if you cannot
   price IV, first 15 minutes, last 15 minutes except the flat.
10. **Volatility:** do not raise size when VIX is high; do not hunt premium
    when VIX is low.
11. **Liquidity:** reject Bankex; reject any name with spread > 3% or
    one-sided book.
12. **Expiry:** no DTE 0. Paper-hypothesis: no DTE 1 on weeklies.
13. **Overnight:** index books flat by 15:15. Crude Mini options: no
    overnight until a gap study exists.

Never increase size to recover. No martingale. No averaging down. Do not
exceed the written cap.

---

## Part 11 — Backtest status

| Tape | Span | Use |
|---|---|---|
| Nifty / Bank / Sensex 5m index | 2023-11-01 – 2026-10-30 | Modelled BS premiums. Direction screen only. |
| India VIX daily | 745 sessions | Previous-day IV. No look-ahead. |
| Listed-contract option 5m | weeks, not years | Calibration. Not 400 fills. |
| Crude Mini listed | 14 weeks | T9. |
| FinNifty / Midcap / Bankex / Crude 100 bbl option history | **missing** | INCONCLUSIVE. |
| Historical bid/ask / depth / live IV | recorder since 2026-11-02, ATM±3 | Insufficient. |

Walk-forward, embargo, day-bootstrap: see the audit and T1–T10. Modelled
option prices are **not** executed fills. No number in this file was
invented to look profitable.

---

## Part 12 — Statistical validation

Required bar: one-sided 95% lower CI of **net** expectancy > 0 on ≥400
real-quote fills, day-clustered, after multiple-testing.

| Book | Lower 95% CI (best available) | Pass? |
|---|---|---|
| Nifty Paper 14k TEST (modelled) | +41 (VAL includes 0) | No — not real quotes; VAL fails |
| Bank TEST (modelled) | −79 | No |
| Sensex TEST (modelled) | −20 | No |
| Crude Mini T9 | negative median | No |
| Others | no sample | INCONCLUSIVE |
| Any portfolio | not estimated | No |
| 4 Nov live paper | n=4, exact −₹1,042 | No |

Sharpe / Sortino / recovery on the modelled tape are not reported as
live statistics. Risk of ruin under a non-positive edge and repeated
fixed bets is 1 if you continue.

A positive backtest alone is not proof.

---

## Part 13 — Capital plans (all live-insufficient)

Option-buy “fit” means recommended capital ≤ 50% of the account and the
book is not untradeable. Futures “fit” means NRML ≤ 70%. **Every row is
insufficient for live** because there is no edge. Fit is cash capacity
only.

| Capital | Option-buy capacity (1 lot) | Futures capacity | Paper suggestion | Live |
|---|---|---|---|---|
| ₹50,000 | Nifty, Sensex, Crude Mini | Crude Mini only | One of Sensex or Mini. Nifty ATM already uses ~23k recommended — tight. | No |
| ₹1,00,000 | +Bank, FinNifty | Mini | One Nifty lot **or** one Mini. Not both plus Bank. | No |
| ₹2,00,000 | +Midcap, Crude | Mini | Still one paper book. | No |
| ₹3,00,000 | same | + index futures | Cash can open 1 index future. Research says do not. | No |
| ₹5,00,000 | same | + standard Crude | Size is not an edge. | No |
| ₹10,00,000 | same | several futures | Do not scale a non-edge. | No |
| ₹15,00,000 | same | several | same | No |
| ₹20,00,000 | same | several | same | No |

Do not pick Midcap or FinNifty because the premium looks “affordable” at
₹5L+. Those names have no study.

---

## Parts 14–15 — Dashboard, tests, branch

Interactive dashboards live in the companion canvas (instrument table,
capital planner, hypothetical target calculator, portfolio risk,
train/val/test split, 4 Nov journal).

This branch does not change the desk, does not set `liveOrders=true`,
and is not to be merged as a trading release.

---

## Answers to the ten questions

1. **How much capital do I need?** For paper observation of one Nifty
   lot: **₹23,140** recommended (₹11,570 ATM + 100% reserve) as of
   13:28 IST, 4 Nov 2026. For live deployment: **do not fund.**
2. **Which instruments?** Paper-only: **Nifty** first, or **Crude Mini**
   if the constraint is cash. Not a live shortlist.
3. **One, two, three or more?** **One.** Two only if the second is a
   different driver (crude vs index) and still paper. Three-plus is
   correlated size.
4. **Lots?** **One.** Never two. Never average down.
5. **Trades per day?** **Zero or one** per instrument. No-trade days
   allowed.
6. **Realistic daily net expectancy?** **Not supported.** 4 Nov exact
   blotter: −₹1,042 on four tickets.
7. **Realistic monthly net expectancy?** **Not supported.** Do not
   annualise a non-edge.
8. **Avoid?** **Bankex.** Standard Crude as a first book. Nifty+Bank+
   Sensex as diversification. Futures as a substitute for an options edge.
9. **Max acceptable daily loss?** Desk ₹420/book. Research: **2% of
   allocated capital**, never more than 25% of the open premium, then
   stand down.
10. **Which strategy has a validated edge?** **NONE.**

**NO VALIDATED EDGE — DO NOT DEPLOY LIVE CAPITAL.**

Recommended configuration versus the alternatives: **paper Nifty, one
lot, zero-or-one trade per day, 50% cash reserve.** It is preferable to
B–F because it does not multiply one equity-beta bet, it is the only
name with weeklies plus a completed (negative) research file, and it
keeps the loss envelope inside a measured 1-lot book. It is **not**
preferable because it is profitable — it is not.
