# Options buying research: NIFTY, BANKNIFTY, SENSEX, CRUDEOILMINI (2026-11-02)

Branch `cursor/market-recorder-9eb1`. Research only: no live orders, no change to any order-execution or strategy code, the recorder is a separate process, no PR has been created or merged.

## 1. Verdict

**No statistically validated CE/PE buying strategy for Rs350-700 net a day exists in the data available today.** I am not claiming profitability.

- Of 30,492 modelled configurations (3 indices x 11 entry families x strikes, expiries, exits; both directions), 70-76% lose money on the training years and the median configuration loses Rs34-158 per trade after charges and spread (T1). Entry families alone do not separate from the random-entry control, with one exception below (T2, T6).
- Picking the best configuration on train and validation and testing it once on 184 unseen days gives 3 of 6 CE/PE buckets positive. That is no better than chance: the same search on direction-randomised signals produces a positive median "winner" in 7 of 9 index/direction sets, with a 95th percentile of +Rs388 to +Rs860 per trade (T5). The smallest selection-adjusted p-value is 0.05 (Nifty, both directions) and 0.07 (Nifty PE) out of 9 comparisons; none survives a multiple-comparison correction.
- One candidate is worth forward testing, not trading: the **6-bar range-thrust momentum entry** (30-minute move beyond 1.5x the average bar range, buy the option in that direction at the next open). With a fixed untuned exit (ATM, stop 40%, target 100%, 24 bars) it earns Rs+217 to +321 per trade on Nifty and Sensex over three years (95% CI above zero, e.g. Nifty DTE3 [95, 551]) versus +Rs45 / +Rs39 for random entries at the same strike and expiry. Nifty is positive in 10 of 13 quarters and Sensex in 9 of 13, with the worst quarter 2025Q1 (-Rs489 and -Rs669 per trade) and near zero from 2025Q3 to 2026Q1; Bank Nifty is weaker (CI includes zero). With 10 families x 3 expiries tried, a best-cell p of about 0.006 becomes about 0.17 after Bonferroni.
- Even that candidate cannot deliver the target as a *daily* number: expected Rs170-280 a day, daily standard deviation Rs2,000-2,900, only 2-5% of days land in Rs350-700, 21-26% of days are at least Rs350, 27-30% of days lose, 39-47% of days have no trade, and the worst modelled day is -Rs5,300 to -Rs11,800 (best +Rs12,000 to +Rs27,400). Confirming a positive mean with 80% power needs about 775-2,300 trading days.
- Options beat 1-lot futures only in the sense that charges are small: futures on the same signals lose Rs750-1,080 per trade in the median configuration with **zero** of 1,620 configurations profitable on train, because 1-lot charges are Rs907 (Nifty), Rs980 (Bank Nifty), Rs831 (Sensex) a round trip (T8). Cheap charges make options a lottery ticket on direction, not an edge.
- Crude Oil Mini has only 14 weeks of listed-contract history. Futures: 0 of 540 configurations positive on train, median net -Rs95 per trade. Options on real premiums: median -Rs82 per trade, 4% of configurations positive. ATM implied vol (51%) was above 5-minute realised vol (32%) on 95% of days, so buyers pay a 60% volatility premium (T9).

## 2. What was verified before simulating

| Item | Finding (Kite dumps and quotes, 2026-11-02) |
|---|---|
| NIFTY | NFO lot 65, weekly options (2026-11-03, 2026-11-09), strike step 50, monthly futures NOV/DEC/JAN. |
| BANKNIFTY | NFO lot 30. **Only monthly option expiries are listed** (2026-11-23, 2026-12-29); no weeklies. Step 100. |
| SENSEX | BFO lot 20 (25 from the 2027-01-28 expiry), weekly options (2026-11-05, 2026-11-12), step 100. Quote depth is empty after the close. |
| CRUDEOILM (Crude Oil Mini) | MCX, Kite `lot_size` = 1 exchange lot = 10 barrels, so a Rs1 move in price is Rs10 per lot. Futures NOV 2026-11-19, DEC 2026-12-18, JAN 2027-01-19. **Options exist**: expiries 2026-11-17, 2026-12-16, 2027-01-15, step 50, premium quoted in Rs per barrel. The much larger CRUDEOIL contract is deliberately excluded. |
| INDIA VIX | `NSE:INDIA VIX` (token 264969) is quoted; daily history since 2023-11. |
| Quote API | `/quote` returns last price, volume, OI, 5-level depth, circuit limits for all of the above, up to 500 instruments per call. The recorder uses 2 calls a minute. |
| Crude on 2026-11-02 | The Nov crude future was **locked at its lower circuit** (Rs9,339, no bids, -6% on the day) while the options kept trading with an implied forward near Rs9,252. A future's LTP is therefore not a safe reference for crude option IV; the recorder now derives the reference from put-call parity (Black-76, r = 0) and stores the circuit limits. |
| Charges | Zerodha schedule re-fetched 2026-11-02 (see `costs.py`). One lot, round trip, premium-neutral: NSE options about Rs70 (Nifty) / Rs72 (Bank), BSE options about Rs66, MCX crude options about Rs54; futures Rs907 / Rs980 / Rs831 / Rs63. |

## 3. Data: what is sufficient and what needs live recording

| Data | Coverage | Sufficient for |
|---|---|---|
| Index 5-minute OHLC (Nifty, Bank Nifty, Sensex) | 2023-11-01 to 2026-10-30, 738 full sessions (index volume is zero) | Entry-signal research, modelled premiums. **Sufficient** for a direction/regime screen. |
| Index 1-minute (Nifty, Bank Nifty) | same span, about 278k bars each | Robustness checks. Not used in the headline grid. |
| India VIX daily | 745 sessions | IV input (previous close, no look-ahead). |
| Real option premiums, 5-minute with OI (Kite, listed contracts only) | Nifty from 2026-09-23 (56+55 contracts, 133k candles), Bank Nifty from 2026-07-27 (132 contracts, 203k), Sensex from 2026-09-25 (161 contracts, 59k), CRUDEOILM Nov-17 options from 2026-09-10 (86 contracts, 166k) | Calibrating the model and spot checks. **Not sufficient** for strategy validation: 15-40 trades per cell. Expired contracts cannot be fetched, so this never grows backwards. |
| Futures 5-minute with OI | Nifty/Bank/Sensex NOV from late Aug 2026; CRUDEOILM NOV since 2026-07-27 (68 sessions) | Crude futures screen (exploratory). |
| Bid/ask spread, depth, live IV and Greeks | **None historical.** The recorder (v1.1.0, deployed) starts collecting for NSE/BSE on the next session and for crude from the evening of 2026-11-02 | Everything that needs executable prices. **Needs live recording.** Until then every spread number is an unvalidated scenario (0.3% / 0.8% / 2.0%); the only measured spread is crude ATM at about 0.35% of premium on one volatile evening. |
| Greeks | Derived by the recorder (Black-Scholes on spot with r = 6.5% for index options, Black-76 on the parity forward for crude) | Delta/gamma/theta/vega studies once sessions accumulate. |

## 4. Method

**Two tiers.**

- *Tier 1 (3 years, modelled premiums).* Signals are computed on 5-minute index bars. Premium = Black-Scholes with IV = previous trading day's India VIX close (no look-ahead), flat through the day; each day's path is rescaled to today's index level and today's lot (65 / 30 / 20) so rupees mean "one lot traded today". Grid per index: 11 entry families x DTE (Nifty/Sensex 0,1,3,6; Bank Nifty 3,10,20) x strike (ATM +/-3) x entry delay (0 or 1 bar) x stop (25/40%) x target (30/60/100%) x hold (12/24/45 bars) x CE/PE/both: 11,088 configurations per direction set for Nifty and Sensex and 8,316 for Bank Nifty.
- *Tier 2 (real premiums, short window).* The same signals replayed on the real 5-minute option candles of the listed contracts, with the actual strike and expiry, to check the model.

**Entry families (each CE and PE separately).** ORB15 (first close beyond the 09:15-09:30 range), PDHL (previous-day high/low break), SRBRK (1-hour support/resistance break), AVGCROSS and AVGREJECT (session-average cross / rejection; indices carry no volume, so this is a TWAP proxy for VWAP), EMASTACK (fresh 9>21>50 alignment), TRENDPULL (pullback to the 21 EMA in a stack), MOMENTUM (6-bar thrust beyond 1.5x mean range), RANGEEXP (range expansion with a close in the outer quarter; the volume-expansion proxy), SQUEEZE (volatility-squeeze release), RANDOM (random times and directions, the control). Regime tags (trending vs choppy prior day, VIX terciles on a trailing 250-day basis, DTE 0 vs later as expiry vs non-expiry) use only information known before the open.

**Fills, costs, leakage controls.**

- A signal uses bar *i*'s close; the earliest fill is the **open of bar i+1** (optionally i+2). A unit test rewrites every bar after a signal and asserts the signal is unchanged.
- Buyer pays mid + half spread + 1 tick and sells at mid - half spread - 1 tick. Stops are tested before targets inside a bar; a gap through a stop fills at the open, not at the stop. No mid-price execution.
- Exact charges per trade (brokerage Rs40 round trip, STT/CTT, exchange transaction, SEBI, stamp, IPFT, 18% GST) by venue, NSE / BSE / MCX, with 1 lot at the current lot size.
- Chronological split by trading day with a one-day embargo: train 405 days (2023-11-02 to 2025-06-25), validation 147 (2025-06-27 to 2026-01-30), test 184 (2026-02-02 to 2026-10-30). Selection uses train then validation only; TEST is evaluated once per bucket. No survivorship issue arises for index series; for options the listed-contract limit is the only survivorship caveat and is why Tier 2 is short.
- Confidence intervals resample **days** (trades in a day are dependent).
- **Selection-adjusted null.** The whole grid-and-select pipeline is re-run 40 times with every signal's direction randomly flipped (times, strikes, exits, costs unchanged). The distribution of the picked configuration's TEST expectancy under that null is the right comparison for a "best of thousands" result.

## 5. Results

All rupee figures are net of exact charges, spread and slippage, for **one lot at today's lot size**, unless labelled gross. Tables T1-T10 are generated by `research/opt_tables.py` from the result files.

## T1. Tier-1 grid: how many configurations make money (base spread, 1 lot, net of all charges)

| Index | Configs | Median net/trade train / val / test (Rs) | % configs > 0 train / val / test |
|---|---:|---|---|
| NIFTY | 11,088 | -51 / -47 / -43 | 30% / 26% / 38% |
| BANKNIFTY | 8,316 | -97 / -158 / -103 | 24% / 17% / 31% |
| SENSEX | 11,088 | -63 / -42 / -34 | 26% / 27% / 41% |

## T2. Entry family medians over the grid (Rs net per trade, ALL directions)

| Family | NIFTY tr/val/test | BANKNIFTY tr/val/test | SENSEX tr/val/test |
|---|---|---|---|
| AVGCROSS | -77 / -53 / -36 | -195 / -128 / -178 | -86 / -26 / 4 |
| AVGREJECT | -10 / -37 / -112 | 36 / -199 / -239 | -82 / -40 / -146 |
| EMASTACK | -170 / -91 / 92 | -94 / -75 / -64 | -175 / -51 / 112 |
| MOMENTUM | 84 / -2 / 231 | 57 / -57 / 203 | 65 / -52 / 254 |
| ORB15 | -41 / -91 / -112 | -23 / -268 / -203 | -23 / -102 / -136 |
| PDHL | -36 / -40 / -14 | -88 / -85 / -296 | -14 / -55 / -43 |
| RANDOM | -60 / 50 / -68 | -199 / 124 / -202 | -68 / 43 / -59 |
| RANGEEXP | -0 / -168 / 18 | -86 / -254 / 62 | 58 / -75 / -12 |
| SQUEEZE | -124 / -38 / -56 | -262 / -209 / -70 | -179 / -29 / -63 |
| SRBRK | -34 / -10 / -53 | -100 / -159 / -7 | -52 / -17 / -13 |
| TRENDPULL | -23 / -66 / -130 | -106 / -262 / -166 | -83 / -44 / -56 |

## T3. Seven buckets: selected configuration, out-of-sample result and selection-adjusted p-value

Selection: positive TRAIN expectancy, then best VALIDATION; TEST is evaluated once. p = share of 40 direction-randomised re-runs of the whole pipeline whose picked TEST expectancy was at least as large.

| Bucket | Picked config (family, DTE, strike offset, stop, target, hold bars, delay) | Trades train/val/test | Net per trade train / val / test (Rs) | Test 95% CI (day bootstrap) | Test win % / PF | Test Rs/day | Test green-day % | p |
|---|---|---|---|---|---|---:|---:|---:|
| NIFTY CE | SRBRK, DTE1, off+1, 25%/100%, 45, d1 | 624/228/265 | 157 / 114 / -85 | [-517, 397] | 31% / 0.92 | -122 | 26% | 0.51 |
| NIFTY PE | SRBRK, DTE1, off+3, 40%/60%, 45, d1 | 557/206/280 | 262 / 554 / 765 | [134, 1,428] | 54% / 1.60 | 1,164 | 51% | 0.07 |
| BANKNIFTY CE | PDHL, DTE3, off+0, 25%/60%, 12, d0 | 178/60/69 | 58 / 260 / -491 | [-983, 8] | 39% / 0.57 | -184 | 39% | 0.98 |
| BANKNIFTY PE | EMASTACK, DTE3, off+1, 25%/60%, 24, d0 | 273/99/130 | 16 / 249 / 374 | [-67, 826] | 55% / 1.43 | 264 | 53% | 0.29 |
| SENSEX CE | SRBRK, DTE0, off+3, 40%/100%, 24, d0 | 620/226/256 | 84 / 148 / -167 | [-614, 307] | 36% / 0.88 | -232 | 35% | 0.61 |
| SENSEX PE | EMASTACK, DTE0, off+3, 40%/60%, 45, d1 | 253/97/114 | 56 / 491 / 386 | [-124, 905] | 49% / 1.34 | 239 | 54% | 0.27 |

## T4. Picked configuration under spread scenarios (TEST net per trade, Rs; tight 0.3% / base 0.8% / wide 2.0% full spread + 1 tick per leg)

| Bucket | tight | base | wide | gross (mid) per trade | charges per trade | spread+slippage per trade (base) |
|---|---:|---:|---:|---:|---:|---:|
| NIFTY CE | -49 | -85 | -171 | 43 | 64 | 64 |
| NIFTY PE | 823 | 765 | 626 | 939 | 75 | 99 |
| BANKNIFTY CE | -441 | -491 | -613 | -336 | 71 | 84 |
| BANKNIFTY PE | 425 | 374 | 251 | 530 | 72 | 85 |
| SENSEX CE | -135 | -167 | -241 | -53 | 61 | 52 |
| SENSEX PE | 418 | 386 | 309 | 502 | 62 | 53 |

## T5. Null distribution of the picked TEST expectancy (what pure noise produces after the same search)

| Index / set | null 5th | null median | null 95th | observed | p |
|---|---:|---:|---:|---:|---:|
| NIFTY ALL | -320 | 48 | 426 | 454 | 0.05 |
| NIFTY CE | -536 | -87 | 388 | -85 | 0.51 |
| NIFTY PE | -346 | 123 | 729 | 765 | 0.07 |
| BANKNIFTY ALL | -640 | 106 | 770 | -248 | 0.78 |
| BANKNIFTY CE | -372 | 81 | 637 | -491 | 0.98 |
| BANKNIFTY PE | -413 | 139 | 860 | 374 | 0.29 |
| SENSEX ALL | -382 | 125 | 497 | 166 | 0.41 |
| SENSEX CE | -600 | -48 | 487 | -167 | 0.61 |
| SENSEX PE | -286 | 253 | 624 | 386 | 0.27 |

## T6. Fixed reference trade (ATM, stop 40%, target 100%, hold 24 bars, base spread), full 3 years, by entry family

Rs net per trade [95% day-bootstrap CI], n. Only cells with n >= 15 are shown.

**NIFTY**

| Family | dte0 ALL | dte1 ALL | dte3 ALL | CE (first DTE) | PE (first DTE) |
|---|---|---|---|---|---|
| AVGCROSS | 20 [-37, 87] n=1626 | 49 [-47, 154] n=1626 | -26 [-125, 84] n=1626 | -7 (n=768) | 44 (n=858) |
| AVGREJECT | 8 [-52, 70] n=1680 | 71 [-34, 184] n=1680 | -6 [-115, 111] n=1680 | -0 (n=860) | 17 (n=820) |
| EMASTACK | -37 [-101, 24] n=978 | -17 [-147, 105] n=978 | -97 [-230, 37] n=978 | -115 (n=528) | 53 (n=450) |
| MOMENTUM | 44 [-49, 138] n=576 | 229 [34, 426] n=576 | 321 [95, 551] n=576 | 55 (n=271) | 34 (n=305) |
| ORB15 | -17 [-123, 80] n=720 | 44 [-125, 200] n=720 | -22 [-212, 147] n=720 | -75 (n=354) | 38 (n=366) |
| PDHL | 34 [-71, 143] n=591 | 101 [-80, 270] n=591 | 81 [-118, 290] n=591 | 4 (n=313) | 67 (n=278) |
| RANDOM | -43 [-105, 15] n=1476 | 95 [-20, 204] n=1476 | 45 [-75, 168] n=1476 | -19 (n=708) | -65 (n=768) |
| RANGEEXP | 72 [-15, 156] n=671 | 90 [-55, 263] n=671 | 18 [-146, 214] n=671 | 93 (n=304) | 55 (n=367) |
| SQUEEZE | -139 [-197, -81] n=1039 | 5 [-105, 114] n=1039 | -57 [-184, 69] n=1039 | -160 (n=515) | -118 (n=524) |
| SRBRK | -70 [-122, -14] n=2169 | 89 [-16, 197] n=2169 | 44 [-70, 155] n=2169 | -88 (n=1124) | -50 (n=1045) |
| TRENDPULL | -69 [-131, -0] n=1204 | 32 [-83, 149] n=1204 | 8 [-129, 146] n=1204 | -107 (n=655) | -23 (n=549) |

**BANKNIFTY**

| Family | dte3 ALL | dte10 ALL | dte20 ALL | CE (first DTE) | PE (first DTE) |
|---|---|---|---|---|---|
| AVGCROSS | -12 [-141, 138] n=1684 | -151 [-299, 8] n=1684 | -273 [-425, -121] n=1684 | -2 (n=831) | -22 (n=853) |
| AVGREJECT | 35 [-114, 185] n=1712 | -84 [-240, 74] n=1712 | -179 [-341, -16] n=1712 | 28 (n=870) | 42 (n=842) |
| EMASTACK | 34 [-139, 206] n=1014 | -77 [-269, 107] n=1014 | -197 [-397, 5] n=1014 | 18 (n=512) | 51 (n=502) |
| MOMENTUM | 259 [-28, 572] n=486 | 166 [-159, 493] n=486 | 79 [-260, 426] n=486 | 288 (n=251) | 228 (n=235) |
| ORB15 | 38 [-193, 281] n=704 | -106 [-352, 140] n=704 | -221 [-475, 39] n=704 | -36 (n=349) | 110 (n=355) |
| PDHL | 40 [-212, 276] n=599 | -47 [-316, 209] n=599 | -174 [-456, 111] n=599 | -62 (n=308) | 149 (n=291) |
| RANDOM | 55 [-92, 205] n=1476 | -111 [-262, 49] n=1476 | -201 [-353, -42] n=1476 | 106 (n=708) | 8 (n=768) |
| RANGEEXP | 181 [-68, 431] n=606 | -16 [-299, 269] n=606 | -127 [-435, 161] n=606 | 202 (n=300) | 160 (n=306) |
| SQUEEZE | -53 [-217, 103] n=1018 | -208 [-380, -51] n=1018 | -312 [-487, -154] n=1018 | -100 (n=521) | -3 (n=497) |
| SRBRK | 71 [-69, 199] n=2141 | -87 [-219, 42] n=2141 | -198 [-327, -62] n=2141 | 95 (n=1099) | 46 (n=1042) |
| TRENDPULL | 7 [-156, 170] n=1244 | -136 [-299, 21] n=1244 | -250 [-426, -85] n=1244 | -11 (n=662) | 28 (n=582) |

**SENSEX**

| Family | dte0 ALL | dte1 ALL | dte3 ALL | CE (first DTE) | PE (first DTE) |
|---|---|---|---|---|---|
| AVGCROSS | -28 [-85, 23] n=1645 | 45 [-42, 133] n=1645 | -10 [-109, 100] n=1645 | -22 (n=771) | -33 (n=874) |
| AVGREJECT | -25 [-86, 35] n=1610 | -24 [-124, 73] n=1610 | -77 [-190, 34] n=1610 | -52 (n=831) | 3 (n=779) |
| EMASTACK | -50 [-122, 17] n=995 | 1 [-126, 123] n=995 | -74 [-204, 58] n=995 | -135 (n=526) | 46 (n=469) |
| MOMENTUM | 32 [-53, 112] n=621 | 217 [40, 399] n=621 | 249 [19, 476] n=621 | 26 (n=286) | 36 (n=335) |
| ORB15 | 42 [-56, 147] n=709 | -7 [-167, 151] n=709 | -70 [-252, 119] n=709 | 13 (n=350) | 70 (n=359) |
| PDHL | 113 [14, 232] n=591 | 139 [-27, 313] n=591 | 61 [-124, 262] n=591 | 94 (n=310) | 133 (n=281) |
| RANDOM | -46 [-101, 7] n=1476 | 106 [-5, 211] n=1476 | 39 [-78, 161] n=1476 | -25 (n=708) | -66 (n=768) |
| RANGEEXP | 7 [-74, 82] n=699 | 130 [-18, 284] n=699 | 66 [-106, 244] n=699 | 46 (n=325) | -28 (n=374) |
| SQUEEZE | -142 [-196, -92] n=1048 | -6 [-115, 122] n=1048 | -75 [-194, 62] n=1048 | -154 (n=549) | -128 (n=499) |
| SRBRK | -77 [-124, -19] n=2165 | 117 [15, 221] n=2165 | 67 [-44, 177] n=2165 | -83 (n=1106) | -71 (n=1059) |
| TRENDPULL | -101 [-157, -49] n=1185 | 44 [-73, 148] n=1185 | 21 [-119, 144] n=1185 | -156 (n=621) | -41 (n=564) |

## T7. Regime splits of the reference trade (MOMENTUM and SRBRK, Rs net per trade, n)

| Index | Family | DTE | trending prior day | choppy prior day | VIX low | VIX mid | VIX high | CE | PE |
|---|---|---:|---|---|---|---|---|---|---|
| NIFTY | MOMENTUM | 0 | 14 (367) | 106 (205) | 66 (163) | -9 (208) | 89 (201) | 55 (271) | 34 (305) |
| NIFTY | MOMENTUM | 1 | 143 (367) | 404 (205) | 213 (163) | 165 (208) | 330 (201) | 246 (271) | 214 (305) |
| NIFTY | MOMENTUM | 3 | 241 (367) | 487 (205) | 195 (163) | 408 (208) | 356 (201) | 353 (271) | 293 (305) |
| NIFTY | ORB15 | 0 | -43 (471) | 45 (244) | 11 (223) | 74 (243) | -119 (249) | -75 (354) | 38 (366) |
| NIFTY | ORB15 | 1 | -37 (471) | 225 (244) | -9 (223) | 84 (243) | 77 (249) | 40 (354) | 49 (366) |
| NIFTY | ORB15 | 3 | -114 (471) | 180 (244) | -69 (223) | -16 (243) | 37 (249) | -71 (354) | 26 (366) |
| NIFTY | SRBRK | 0 | -37 (1416) | -124 (735) | -62 (676) | -51 (732) | -87 (743) | -88 (1124) | -50 (1045) |
| NIFTY | SRBRK | 1 | 80 (1416) | 121 (735) | 62 (676) | 175 (732) | 44 (743) | 55 (1124) | 126 (1045) |
| NIFTY | SRBRK | 3 | 18 (1416) | 106 (735) | 16 (676) | 217 (732) | -89 (743) | -4 (1124) | 96 (1045) |
| BANKNIFTY | MOMENTUM | 10 | -39 (310) | 523 (173) | 196 (118) | 35 (179) | 264 (186) | 87 (251) | 250 (235) |
| BANKNIFTY | MOMENTUM | 20 | -89 (310) | 370 (173) | 83 (118) | -30 (179) | 172 (186) | -23 (251) | 188 (235) |
| BANKNIFTY | MOMENTUM | 3 | 21 (310) | 676 (173) | 421 (118) | 194 (179) | 210 (186) | 288 (251) | 228 (235) |
| BANKNIFTY | ORB15 | 10 | -112 (438) | -88 (260) | -166 (217) | -113 (239) | -36 (242) | -241 (349) | 28 (355) |
| BANKNIFTY | ORB15 | 20 | -207 (438) | -239 (260) | -283 (217) | -280 (239) | -101 (242) | -366 (349) | -79 (355) |
| BANKNIFTY | ORB15 | 3 | 7 (438) | 98 (260) | -13 (217) | 52 (239) | 79 (242) | -36 (349) | 110 (355) |
| BANKNIFTY | SRBRK | 10 | -119 (1336) | -38 (788) | -188 (661) | -77 (727) | -10 (736) | -105 (1099) | -68 (1042) |
| BANKNIFTY | SRBRK | 20 | -229 (1336) | -150 (788) | -266 (661) | -179 (727) | -160 (736) | -228 (1099) | -166 (1042) |
| BANKNIFTY | SRBRK | 3 | 57 (1336) | 94 (788) | 2 (661) | 64 (727) | 139 (736) | 95 (1099) | 46 (1042) |
| SENSEX | MOMENTUM | 0 | 18 (407) | 65 (209) | -27 (169) | 11 (218) | 99 (229) | 26 (286) | 36 (335) |
| SENSEX | MOMENTUM | 1 | 108 (407) | 444 (209) | 129 (169) | 203 (218) | 308 (229) | 311 (286) | 136 (335) |
| SENSEX | MOMENTUM | 3 | 158 (407) | 443 (209) | 150 (169) | 284 (218) | 304 (229) | 352 (286) | 161 (335) |
| SENSEX | ORB15 | 0 | 31 (465) | 78 (240) | 77 (218) | 50 (243) | 17 (244) | 13 (350) | 70 (359) |
| SENSEX | ORB15 | 1 | -66 (465) | 133 (240) | 27 (218) | 15 (243) | -35 (244) | -61 (350) | 45 (359) |
| SENSEX | ORB15 | 3 | -144 (465) | 94 (240) | -18 (218) | -118 (243) | -48 (244) | -144 (350) | 3 (359) |
| SENSEX | SRBRK | 0 | -80 (1416) | -71 (733) | -58 (676) | -74 (726) | -96 (747) | -83 (1106) | -71 (1059) |
| SENSEX | SRBRK | 1 | 65 (1416) | 223 (733) | 94 (676) | 150 (726) | 111 (747) | 93 (1106) | 142 (1059) |
| SENSEX | SRBRK | 3 | -15 (1416) | 228 (733) | 27 (676) | 189 (726) | -13 (747) | 26 (1106) | 110 (1059) |

## T7b. CE vs PE over the whole grid (median net per trade over all configurations, Rs; random-entry family shown as the reference)

| Index | CE train / val / test | PE train / val / test | RANDOM-entry CE test | RANDOM-entry PE test |
|---|---|---|---|---|
| NIFTY | -61 / -116 / -83 | -28 / -2 / 34 | -136 | -35 |
| BANKNIFTY | -84 / -202 / -173 | -88 / -129 / -34 | -227 | -188 |
| SENSEX | -68 / -90 / -84 | -54 / -5 / 26 | -100 | -41 |

## T8. 1-lot futures on the same signals (540 configs per index, same split)

| Index | Median gross per trade tr/val/test (Rs) | Median NET per trade tr/val/test (Rs) | % configs > 0 tr/val/test | Train-positive configs |
|---|---|---|---|---:|
| NIFTY | 113 / 82 / 98 | -847 / -877 / -861 | 0% / 0% / 2% | 0 |
| BANKNIFTY | 7 / -42 / 42 | -1,028 / -1,077 / -993 | 0% / 0% / 0% | 0 |
| SENSEX | 58 / 76 / 158 | -847 / -829 / -747 | 0% / 0% / 2% | 0 |

## T9. Crude Oil Mini (14 weeks of listed-contract history)

- Sessions: 68 (2026-07-27 to 2026-11-02); split train/val/test = 37/13/16 days.
- Daily range median 3.2% (about 268 points = Rs2,675 per lot), 90th percentile 5.0%; worst day 2026-11-02 at -5.4%.
- Futures, 1 lot, 540 configs: median gross per trade tr/val/test = -14 / -16 / -35; median net = -95 / -98 / -119; % configs > 0 = 0% / 15% / 8%; configs positive on train: 0.
- Options, real premiums of the Nov-17 expiry: 120 family x exit configs, median net per trade Rs-82, 4% positive; trades per family at most 45.
- Implied vs realised: ATM implied vol median 51% vs 5-minute realised vol median 32%; implied was above realised on 95% of 20 days.

## T10. Model fidelity: Tier-1 modelled P&L vs real-premium replay on the same trades (reference exits, base spread)

| Index | Trades matched | Corr. of per-trade net | Mean net real / model (Rs) | Mean gross real / model (Rs) |
|---|---:|---:|---|---|
| NIFTY | 155 | 0.94 | -64 / -92 | 168 / 154 |
| BANKNIFTY | 410 | 0.88 | -160 / -458 | 230 / -73 |
| SENSEX | 80 | 0.82 | -437 / -45 | -222 / 175 |

## 6. Reading the results

**Options versus 1-lot futures (T8 vs T1).** The same entries on one future lose in every configuration: gross edge per trade is -Rs42 to +Rs158 in the median while a round trip costs Rs907 (Nifty), Rs980 (Bank Nifty), Rs831 (Sensex) before slippage. Option buying removes the charge wall (Rs54-90 a lot) and pays instead through spread and theta, which is why 24-30% of option configurations are positive on train where 0% of futures configurations are. That difference is a cost-structure effect; it is not evidence of directional skill, because the same option configurations remain positive about as often when the direction is randomised (T5).

**CE versus PE (T3, T7b).** PE buying beats CE buying in 8 of 9 index/segment pairs (the exception is Bank Nifty train; median over all configurations: Nifty PE -28 / -2 / +34 vs CE -61 / -116 / -83), including the 2023-25 train period when the indices rose about 30%. Random-entry PE also loses less than random-entry CE (T7b). Part of this is structural, not a signal: a call is priced off the future (spot plus carry), so with spot flat a call buyer pays the carry decay and a put buyer collects it (about Rs12 a unit over three days on Nifty, roughly Rs800 a lot). The picked PE buckets are positive on test (+Rs765, +Rs374, +Rs386 per trade) but none is statistically distinguishable from the best-of-search noise (p 0.07, 0.29, 0.27); all three picked CE buckets are negative on test.

**Entry families (T2, T6).** Against the random-entry control, only MOMENTUM is consistently above it across the three indices (Nifty and Sensex CI above zero at DTE1 and DTE3). Opening-range break (ORB15), previous-day high/low (PDHL), average-price cross/rejection, EMA stack, trend pullback, range expansion, support/resistance break and squeeze are all indistinguishable from random entries or worse; the squeeze entry and every DTE0 / Bank Nifty far-expiry cell are significantly negative. Note that the random-entry control itself is slightly positive at DTE1-3 on Nifty and Sensex (+Rs95 / +Rs106 at DTE1; CI includes zero). That is a property of the model (constant IV, bar-extreme target fills) and of 2026's realised-vs-implied relationship, and it is why every family must be compared with RANDOM rather than with zero.

**Expiry vs non-expiry (T6, T7).** DTE0 (expiry-day) options are the worst: gamma is high but so is decay, and the reference trade is negative or flat for nearly every family (e.g. Nifty SQUEEZE -139 with CI [-197, -81], SRBRK -70). Almost every statistically positive cell sits at DTE1-3; the one exception is Sensex PDHL at DTE0 (+113, CI [14, 232]), which is one of about 800 cells. Bank Nifty is monthly only: at DTE10-20 almost every family loses (-16 to -312; MOMENTUM is the exception), at DTE3 (the last days of the month) results resemble Nifty.

**Regimes (T7).** MOMENTUM and ORB15 earn more after a *choppy* prior day (Nifty MOMENTUM DTE3: +487 after chop vs +241 after a trending day; Bank +676 vs +21). High-VIX and mid-VIX terciles are better than low-VIX for MOMENTUM on Nifty and Sensex, but cell sizes are 118-229 trades and these differences are within their intervals. They are hypotheses for the forward data, not findings.

**Model fidelity (T10).** On the 25-40 sessions where real premiums exist, the model tracks the real contract's trade P&L closely (correlation 0.94 Nifty, 0.88 Bank Nifty, 0.82 Sensex over 155 / 410 / 80 matched trades) and the same exit kind in 96-100% of trades. The *level* is less reliable: mean net real vs model is -64 vs -92 (Nifty), -160 vs -458 (Bank), -437 vs -45 (Sensex). Realised IV was 0.94-0.99x the previous VIX close on index options (calibration, `calib-*.pkl`), so the VIX-based IV is about right on average. The model has no intraday IV dynamics (IV usually rises when the index falls, which would favour PE and hurt CE) and no skew; both are testable only with the recorder.

**Crude Oil Mini (T9).** A median day ranges 3.2% (about Rs2,675 a lot), so a Rs350-700 move is a small fraction of a normal day and 1-lot crude futures charges only Rs63. Even so, the median futures configuration is -Rs95 per trade with gross -Rs14: after 14 weeks there is no entry family with positive train expectancy. The options are priced at 51% implied vs 32% realised, so a buyer needs moves about 60% larger than realised volatility delivers. The sample includes a limit-down day (2026-11-02, -5.4% close to open) and is one regime; no conclusion beyond "nothing to validate yet" is supportable.

## 7. Does a strategy reach Rs350-700 net a day?

Best candidate, fixed untuned exit, per index (1 lot, base spread; "all" = 738 sessions including days with no trade; "test" = 184 sessions):

| Candidate | Trades/day | Mean per trade (Rs) | Daily mean / SD (Rs) | Days >= 350 | Days in 350-700 | Losing days | No-trade days | Worst / best day (Rs) | Max drawdown (Rs) | Longest losing-day streak | Days for 80% power |
|---|---:|---:|---|---:|---:|---:|---:|---|---:|---:|---:|
| Nifty MOMENTUM DTE3, all | 0.78 | 321 (SD 2,646) | 251 / 2,489 | 26% | 5% | 27% | 42% | -6,667 / +19,575 | 41,509 | 7 | 775 |
| Nifty MOMENTUM DTE3, test | 0.71 | 386 | 273 / 2,198 | 26% | 6% | 27% | 44% | -5,180 / +11,501 | 20,580 | 7 | 510 |
| Nifty MOMENTUM DTE1, all | 0.78 | 229 (SD 2,228) | 179 / 2,028 | 25% | 4% | 28% | 42% | -5,306 / +11,989 | 32,556 | 7 | 1,010 |
| Sensex MOMENTUM DTE3, all | 0.84 | 249 (SD 2,557) | 209 / 2,577 | 25% | 4% | 30% | 39% | -8,790 / +21,402 | 52,898 | 16 | 1,189 |
| Bank Nifty MOMENTUM DTE3, all | 0.66 | 259 (SD 3,452) | 170 / 2,914 | 21% | 2% | 29% | 47% | -11,839 / +27,363 | 49,359 | 11 | 2,300 |

The payoff is a few large winners (a doubled premium on a 6-bar thrust that keeps going) against many 40% premium stops, so the daily result is dominated by variance, not by the Rs350-700 target: a "daily target" framing does not fit this payoff. The owner's constraint that a losing day is not acceptable cannot be met by any strategy in this study: the best candidate loses on roughly 3 days in 10 and has no trade on 4 days in 10.

**Sample sizes.** To detect a true mean per trade of Rs321 with SD Rs2,646 (80% power, 5% two-sided) needs about 534 trades, roughly 680 sessions at 0.78 trades a day (about 2.7 years); Bank Nifty needs about 1,400 trades. Correcting for a candidate chosen from about 30 comparisons needs roughly 1.5-2x as many, so 4-5 years. At the recorder's rate (one session a day) the live recorder cannot validate a strategy quickly; its short-term job is to replace assumed spreads and IV dynamics with measurements (planning estimates: about 10 sessions for a stable spread estimate per instrument, about 60 sessions for an IV-versus-spot-move relationship).

## 8. Limitations and biases (all in the direction stated)

- Tier-1 premiums are modelled; IV is the previous VIX close, flat intraday, no skew. The real-premium check covers 6-40 trades per cell and cannot confirm or refute the model's level. Mean P&L real vs model differs by up to Rs400 per trade (T10).
- Spreads are scenarios, not measurements, for NSE/BSE; the crude figure (0.35%) is one evening. A 2% spread removes about Rs140 per trade from the picked buckets (T4); real Nifty ATM spreads are usually tighter than 0.8%, but deep-ITM and expiry-day books are often wider.
- 5-minute bars hide the intra-bar order of highs and lows; stop-first is conservative for stops and generous for targets that are hit on a bar's extreme.
- Index volume is zero, so VWAP, volume expansion and OI-based entries could not be tested; "average price" and "range expansion" are labelled proxies.
- 2023-26 is one market: a strong 2023-25 rise, then a flat-to-down 2026 with higher realised volatility. The test period favours long-volatility, which is visible in the positive null medians (T5).
- Entry families overlap in time and the three indices are highly correlated, so three indices are not three independent confirmations.
- Real option history is capped by Kite to currently listed contracts; it cannot be extended backwards.

## 9. Recommended next experiments (in order)

1. **Let the recorder run 10 sessions** and replace the spread scenarios with measured ATM/ITM/OTM spreads by time of day and DTE, per instrument. This is the cheapest uncertainty to remove.
2. **Paper-forward the MOMENTUM candidate only**, as pre-registered here: 6-bar thrust above 1.5x the 20-bar mean range, ATM option, DTE 1-3 on Nifty and Sensex, stop 40%, target 100%, 24-bar time exit, flat by 15:15, fill at the next bar's ask. Pre-register the success rule: more than 400 trades and a one-sided lower 95% confidence bound above zero. Do not tune it.
3. **Add an IV-dynamics layer** (ATM IV change versus the index move, from 60 recorded sessions) and re-run Tier 1 to see whether the PE-over-CE tilt and the momentum result survive realistic vol-of-spot behaviour.
4. **Test regime filters on out-of-sample data only**: prior-day chop, VIX tercile, expiry proximity. They are hypotheses from T7.
5. **Crude Oil Mini:** collect 60 recorded evenings of options and futures books (the recorder already stores the parity-implied forward and circuit limits) before any strategy search; 14 weeks of listed history is one regime.
6. **Futures-based confirmation** of the underlying direction signal (OI, volume, basis) once the recorder has 100+ sessions, tested against the same null protocol.

## 10. Recorder (v1.1.0) status

Separate pm2 process `palagai-recorder` on the droplet; it never imports the order desk, brokers or strategies and only reads the Kite session. Deployed and restarted on 2026-11-02 at 19:15 IST after 18 passing tests; `trading-backend` was not touched, the previous code is backed up at `/var/lib/palagai-recorder-v1.0.0-code.bak`, no data was deleted.

- Records per minute (two `/quote` calls, well under the rate limit): India VIX; NIFTY, BANKNIFTY, SENSEX spot; two nearest futures of each (including CRUDEOILM); ATM +/-3 CE and PE for the nearest expiry (plus the next on expiry day) of each of NIFTY, BANKNIFTY, SENSEX and CRUDEOILM, with LTP, volume, OI, five-level depth (best bid/ask, quantities, orders), exchange timestamp, circuit limits and derived IV/delta/gamma/theta/vega.
- Sessions per underlying (index 09:05-15:45, crude 09:00-23:40). The daily summary derives the real session from the data (minutes where the anchor's exchange timestamp advanced) and reports missing minutes and ranges, option rows without a two-sided book, constant-OI anomalies, DB and raw size, disk free and projected trading days left.
- Duplicate protection by primary key (token, minute); raw NDJSON is append-only and gzipped the next day; restart-safe because all state is in SQLite; `NO_AUTH`, `AUTH_FAILED`, `HTTP_ERROR`, `NO_SPOT`, `PARTIAL` minutes are recorded, never skipped silently.
- Look-ahead rule for research use: a snapshot labelled minute K is fetched at K:03; an event on candle T may only use snapshots with minute_key <= T plus the entry delay.
- Resources at deploy: process RSS about 69 MB on a 458 MB droplet (59% RAM used by the whole host), 2.6 GB free disk; an estimate from the smoke-test record size (about 1 KB per raw quote) is roughly 20-25 MB a trading day all-in, i.e. 100+ trading days of headroom; the daily summary's `projected_trading_days_left` will replace this estimate with a measurement after the first week. The summary logs `projected_trading_days_left` and flags `low_disk` below 500 MB. **No droplet resize is requested.**

## 11. Reproduce

```bash
# data (token only via env; ~3 requests/second)
KT='key:token' python3 market-recorder/research/fetch_history.py
# unit tests
node --test market-recorder/tests/*.test.js
cd market-recorder/research && python3 test_opt_core.py && python3 test_costs.py && python3 test_live_features.py
# Tier 1, null (slow: ~25 s per run per index), reports
python3 opt_run.py; for u in NIFTY BANKNIFTY SENSEX; do python3 opt_null.py $u 40 & done; wait
python3 opt_fut.py; python3 opt_regimes.py; python3 opt_tier2.py; python3 crude_research.py
python3 opt_report.py; python3 opt_tables.py
```
