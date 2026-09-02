# PHASE 5 — HOLDING HORIZON AS A COST-AMORTISATION LEVER

**Status: NEGATIVE. Hypothesis rejected.**
Date: 2026-08-29 · Read-only · No broker imports · No live orders

---

## 1. The hypothesis (pre-registered before any result was seen)

The dummy-confirmed 1H breakout is the only strategy in ~200 pre-registered
conditions to produce **positive gross** (+₹14,358 over 6 years, +₹2.0/trade).
It fails only because intraday round-trip charges are ₹10.2/trade.

> **H5:** if the edge persists over a multi-day horizon, holding longer pays the
> toll once instead of ~20 times, and net turns positive.

The entry signal was **frozen verbatim** from `scripts/p4p-dummy.js` and not
re-tuned. The only variable changed was the exit horizon.

## 2. What was measured first: the cost floor is size-dependent

Before testing, the charge model was re-derived. A prior figure of 0.258% for
delivery was **wrong at the sizes actually being traded**:

| notional | MIS (intraday) | CNC (delivery) | CNC/MIS |
|---|---|---|---|
| ₹10,000 | 0.1060% | **0.3992%** | 3.77× |
| ₹25,000 | 0.1061% | 0.2930% | 2.76× |
| ₹50,000 | 0.1060% | 0.2576% | 2.43× |
| ₹100,000 | 0.0824% | 0.2399% | 2.91× |

The ₹15 + GST **DP charge is flat per sell**. At ₹10,000 that single fee is
0.177% — larger than the entire intraday charge rate. Delivery is only
competitive with size *and* few round trips. This alone raised the bar the
hypothesis had to clear.

## 3. Phase 5.A — the sweep

`scripts/p5a-horizon.js`. 42 cells: 3 sizings × 2 stop modes × 7 horizons.
Capital ₹50,000, slot-constrained (a position blocks its slot until it exits, so
long holds genuinely cost opportunity). TEST (≥2023) excluded at load.
DEV ≤2019-12-31, VALID 2020–2022.

Exactly **one** cell of 42 had both DEV and VALID net positive:
₹50,000 × 1 position, no stop, hold 3 sessions → **net +₹2,752 (+5.5%)**.

## 4. Phase 5.B — adversarial verification of that one cell

`scripts/p5b-verify.js`. It does not survive:

```
session-clustered t          0.06      (Bonferroni threshold for 42 cells: 3.02)
drop the single best trade   -Rs10,780        SIGN INVERTED
sign pattern across horizon  0 0 0 1 0 1 0 0 0 1 0
```

The sign pattern is the decisive evidence. A real horizon effect is
**contiguous** — if 3 sessions works, 2 and 4 should be adjacent-good. Instead:
H=3 profitable, H=4 −₹63,728, H=5 profitable, H=6 −₹63,369. That is a noise
surface sampled 42 times, returning the cell one would expect by chance.
`t = 0.06` is indistinguishable from zero.

**H5 is rejected.** Holding longer does not amortise the cost into profit.

## 5. Phase 5.C — the frozen signal on the most recent months

`scripts/p5c-lastmonth.js`. TEST window deliberately spent on an
already-failed candidate: it can confirm the failure, not reverse it.
Original specification — ₹10,000/stock, max 5/day, SL = 1H candle close,
exit 15:15, MIS charges.

| | July 2026 | August 2026 (to 21st) |
|---|---|---|
| sessions | 23 | 15 |
| trades | 110 | 71 |
| win rate | 31% | 30% |
| gross | −₹324 | −₹523 |
| charges | ₹1,099 | ₹694 |
| **NET** | **−₹1,423** | **−₹1,217** |
| return on ₹50,000 | −2.85% | −2.43% |
| green days | 7 / 23 | 2 / 15 |

Both months lose. The equity curve in July is instructive: it peaks at **+₹850
on 7 July** and declines monotonically to −₹1,423 by month end. There is no
regime in which this was working and then stopped; charges grind it down from
a starting position of roughly zero gross.

### Where the money goes

```
July      STOP exits  35 trades  -Rs2,280      TIME exits  75 trades  +Rs856
August    STOP exits  25 trades  -Rs1,206      EOD  exits  46 trades   -Rs11
```

In both months the stop-outs account for the entire loss and more. The
time-based exits are roughly break-even to positive.

## 6. The one finding that may be structural — and its limit

Across the 5.A sweep, removing the 1H-close stop improved results in
**21 of 21** paired comparisons (every sizing × every horizon). Sign test
p ≈ 5×10⁻⁷. Win rate moved 39% → 50–55%. The interpretation: a stop placed at
the 1H candle close sits *inside* ordinary price noise and converts trades that
would have resolved favourably into realised losses.

**However — this does not replicate on the 2026 months:**

| | with 1H-close SL | no stop |
|---|---|---|
| July 2026 | −₹1,423 | −₹1,706 (**worse**) |
| August 2026 | −₹1,217 | −₹952 (better) |

One of two. Two months cannot overturn 21/21, but they are not confirmation
either. The honest statement is: **the stop is harmful in the 2017–2022
multi-day tests and unproven intraday in 2026.** It should not be presented as
an established result until tested properly on its own pre-registered terms.

What *is* established, and matters independently: a stop narrower than one bar
of ordinary movement is a loss engine. The live options bot's ₹300/lot cap
divides to **₹4.62 of premium = 0.56× the median 5-min true range**. That is the
same defect, on a different instrument.

## 7. Conclusion

Three levers were named as remaining after Phase 4. Two are now closed:

1. ~~**Longer holds**~~ — tested here, rejected (t = 0.06, sign-alternating).
2. ~~**Larger positions**~~ — tested inside 5.A; helps the rate slightly, does not
   change the sign.
3. **Lower-cost instruments** — NIFTY futures at 0.0218% remain untested for lack
   of data. 43 of ~500 sessions collected. ~1.8 years out. **Still open.**

The programme's central measured result is unchanged and now re-confirmed on
out-of-sample 2026 data: **the largest genuine edge found (~0.02%) is smaller
than the statutory + brokerage cost of accessing it (0.106% intraday,
0.26–0.40% delivery).** No arrangement of entry, exit, direction, selection,
sizing, strictness, or horizon has closed that gap.

## 8. Reproduction

```bash
node scripts/p5a-horizon.js  "$PWD/research-data/eqintra"
EQDIR="$PWD/research-data/eqintra" node scripts/p5b-verify.js
EQDIR="$PWD/research-data/eqintra" node scripts/p5c-lastmonth.js 2026-07
EQDIR="$PWD/research-data/eqintra" NOSTOP=1 node scripts/p5c-lastmonth.js 2026-07
```

Data: `research-data/eqintra`, 26 symbols, 2017-01-02 → 2026-08-21.
