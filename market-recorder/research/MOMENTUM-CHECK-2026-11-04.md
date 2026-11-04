# Momentum check and Paper test strategy change (2026-11-04)

Research only. No order is placed; `liveOrders` stays false. The Kite token was used from the environment and is not stored.

## Verdict

**No strategy here is validated as profitable.** The pre-registered MOMENTUM entry (OPTIONS-BUYING-RESEARCH.md, section 9.2) is still the only entry that beats random entries and its own reversed direction over 3 years of modelled premiums, and on real Nifty premiums over the last 16 sessions it was positive while the desk's rules were not. That is enough to forward-test it on paper on Nifty, not to trade it with money. Sensex, Bank Nifty and Crude Mini move to watch-only.

## 1. Same exit for every entry, 3 years of modelled premiums

`momentum_check.py`, data `/tmp/optres2` (the study's 5-minute index bars and VIX, plus 2026-11-02 to 11-04). ATM, stop 40%, target 100%, 24-bar time exit, fill at the next bar's open, base spread, exact charges, one lot at today's lot. Nothing was chosen on these numbers: the exit is the study's fixed reference trade. Rupees net per trade, train / validation / test with the test 95% day-bootstrap interval.

| Entry | Nifty DTE1 | Nifty DTE3 | Sensex DTE1 | Sensex DTE3 |
|---|---|---|---|---|
| MOMENTUM | 201 / -7 / **449** [67, 836] | 380 / -1 / 403 [-38, 846] | 202 / -28 / **447** [55, 840] | 275 / -23 / 364 [-104, 817] |
| MOMENTUM, direction reversed | -31 / -94 / -244 | -196 / -52 / -351 | -50 / 3 / -201 | -129 / 3 / -410 |
| PDHL (desk) | 94 / 36 / 151 | 75 / 39 / 105 | 188 / 27 / 174 | 121 / -20 / 36 |
| ORB15 (desk orb_break) | 78 / -37 / -114 | 91 / -90 / -165 | 92 / -35 / -210 | 48 / -126 / -279 |
| AVGREJECT (desk vwap_fade proxy) | 121 / 72 / -18 | 42 / 56 / -124 | -42 / 54 / -53 | -104 / 42 / -136 |
| RANDOM | 32 / 213 / 172 | 6 / 159 / 43 | 59 / 217 / 173 | -1 / 146 / 43 |

- Reversing momentum's direction turns every segment negative, so the result is directional, not just "buy volatility after a thrust".
- Validation (2025-06 to 2026-01) is flat for momentum and every other family. Random entries are positive on validation and test in the model, which is the model's long-volatility bias; momentum is above random on train and test, below it on validation.
- Momentum was named in the 2026-11-02 study after looking at all three years, so the test segment is not untouched for it. Sessions after 2026-10-30: Nifty 0 momentum trades, Sensex 1 trade (-Rs1,991 at DTE1).
- Risk on traded days: Nifty worst day -Rs5,487 (DTE1) / -Rs6,832 (DTE3); about half of traded days lose.

## 2. Real premiums, last 16 sessions (2026-10-13 to 2026-11-04)

`palagai/tools/paper-replay.ts`: the Paper test engine minute by minute on Kite 1-minute and 5-minute candles of the real contracts. Past sessions can only use contracts listed today, so expiries are 1-4 weeks out instead of 1-3 days, and the 40% / 100% levels were never hit in two hours (exits were the time stop or 15:15).

| Book | MOMENTUM, real premiums | Desk rules (4 Nov), real premiums | MOMENTUM, modelled, DTE20, same days |
|---|---|---|---|
| Nifty | 12 trades, 4 wins, **+Rs3,638** | 19 trades, 9 wins, -Rs769 | 13 trades, +Rs3,911 |
| Sensex | 11 trades, 3 wins, **-Rs14,974** | 21 trades, 11 wins, +Rs7,472 | 18 trades, -Rs5,043 |

Nifty agrees with the model. Sensex real premiums ran far below the model, as in the study's fidelity table (T10: Sensex real -Rs437 vs model -Rs45 per trade). Sixteen sessions are far too few to call either number an edge.

## 3. Paper test change (palagai)

- **Nifty 50**: MOMENTUM exactly as pre-registered. 6-bar close-to-close move beyond 1.5 x sqrt(6) x the mean range of the previous 20 bars, from the 7th bar of the day; at most 3 trades a day, signals at least 12 bars apart; ATM CE on an up thrust, ATM PE on a down thrust, nearest expiry that is not today; stop 40% and target 100% of the entry premium; out after 24 bars or at 15:15; 1 lot at the live ask; exact charges. No cooldown, no 2-loss stop, no tuning.
- **Sensex, Bank Nifty, Crude Mini**: watch only. They still show the live 1-lot cash needed.
- One stop on a Nifty ATM lot is about Rs2,500-4,000 (premium Rs100-150 x 65 x 40%).

## 4. Pre-registered success rule for the forward paper test (unchanged from the study)

More than 400 trades and a one-sided lower 95% confidence bound on net per trade above zero, on the desk's own fills at the ask. Until then the result is "unproven", whatever the running total says.
