# Trap V2 — go-live runbook

Plan: **paper Monday → live Tuesday.** Paper here runs the *identical* code path
as live (`paperLivePath: true`), so Monday proves the plumbing against real
ticks without exposing capital. Going live is one flag.

---

## Step 1 — Rebuild the bundle (in `palagai-main`)

```bash
node scripts/server-live/build-strategy-core.cjs
```

Writes `live/strategy-core.cjs` into Palagai-Order-API. Skipping this means the
boot guard refuses to start (by design — see below).

## Step 2 — Deploy ALL of these together

Two of them are **new files**. `dna-live-green.js` `require`s
`strategy-bundle-guard.js`; deploy without it and the API will not boot.

```
live/strategy-bundle-guard.js     (NEW — required by dna-live-green)
live/instrument-archive.js        (NEW — required by live.worker + backtest)
live/strategy-core.cjs            (rebuilt in step 1)
live/dna-live-green.js
live/daily-desk-defaults.js
live/live.worker.js
live/live-broker.js
live/backtest.js
scripts/preflight.js              (optional but recommended)
```

## Step 3 — Pre-flight on the droplet

```bash
node scripts/preflight.js
```

Exits non-zero on any failure — safe to gate a deploy script with. It verifies
the bundle is fresh, the 3-trades/day cap survives the UI round-trip, the
₹300/lot cap actually binds at the SL order, and Bank/Crude are still off.
**If it fails, do not start the desk.**

## Step 4 — Push Kite auth (daily; tokens expire)

```bash
curl -X PUT https://<host>/live/auth \
  -H "Authorization: Bearer <SITE_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"<API_KEY>","accessToken":"<TODAYS_ACCESS_TOKEN>"}'
```

## Step 5a — MONDAY: start in paper

```bash
curl -X POST https://<host>/live/start \
  -H "Authorization: Bearer <SITE_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"realOrders":false,"capitalRs":40000,"enableNifty":true,"enableBank":false,"enableCrude":false,"niftyMaxTradesDay":3,"dayProfitLock":true,"strictDayStop":true}'
```

## Step 5b — TUESDAY: same command, `realOrders:true`

```bash
curl -X POST https://<host>/live/start \
  -H "Authorization: Bearer <SITE_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"realOrders":true,"capitalRs":40000,"enableNifty":true,"enableBank":false,"enableCrude":false,"niftyMaxTradesDay":3,"dayProfitLock":true,"strictDayStop":true}'
```

Stop any time:

```bash
curl -X POST https://<host>/live/stop -H "Authorization: Bearer <SITE_JWT>"
```

---

## What to check on Monday (paper)

Watch `GET /live/events` and `GET /live/status`. Monday is a plumbing test, not
a profit test — a green paper day proves nothing about live fills.

| Check | Expect |
|---|---|
| Entry times | ONLY 09:45–10:30, 11:00–12:00, 13:30–14:45. Any fill in 10:30–11:00 or 12:00–13:30 = the new time filter is broken. |
| Trade count | ≤ 3. More = the cap regression is back. |
| SKIP events | Some `Charge-path skip … premium > cap ₹150` are normal (~26% of signals). |
| Errors | Zero `ERROR` events. Any = stop and investigate before Tuesday. |
| Signals fire at all | If zero signals all day, a filter is too tight — investigate, don't loosen blindly. |

## Expected reality on ₹40,000 (1 lot)

| | |
|---|---|
| Realistic ₹/day | **~₹456** (not the ₹959 the peak-trail suggests) |
| Red days | **~56%** — more losing days than winning |
| Day stop | ₹1,500 = 3.75% of capital |
| Per-trade cap | ₹300 = 0.75% of capital |
| Modeled max drawdown | ₹6,265 = **15.7%** of capital |

## Known unknowns — read before Tuesday

1. **The peak-trail (₹100/lot arm) is unvalidated.** It generates most of the
   modeled profit, but the Black-Scholes backtest is structurally biased in its
   favour (no bid-ask noise, so a tighter trail always scores better). A
   ₹100/lot arm is a ₹1.54 premium move — roughly one to three spread widths.
   Real fills may trigger it on noise. This is the single biggest open question
   and only live data answers it.
2. **`maxNiftyEntryPremium: 150` is probationary.** It survived holdout only in
   combination with the time filter and had no standalone edge. Kept mainly for
   exposure control: it caps one trade at ₹9,750 (24% of ₹40k) instead of up to
   ~₹25,000 (63%).
3. **Bank Nifty and Crude are hard-off** and were never validated. Research
   suggests the 3-instrument combo earns more, but none of that used real option
   pricing. Do not enable on that basis.
4. **All backtests model premiums** — no real fills, spreads, or slippage have
   ever touched this strategy.

## If Monday goes wrong

Fastest rollback is `git stash` on the Order-API repo (restores the previous
`live/` files) plus the matching `strategy-core.cjs`. The boot guard makes a
half-rollback fail loudly rather than trade a mismatched DNA.
