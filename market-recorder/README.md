# Market recorder (Nifty and Bank Nifty futures and options)

A separate process (`palagai-recorder` under pm2). It only reads Kite market data. It imports no order, broker,
desk or strategy module, never places an order, and writes only to its own directory.

## What it records, every minute (09:05 to 15:45 IST, weekdays)

Call 1 (one `/quote` request): Nifty 50, Nifty Bank, India VIX, and the two nearest NIFTY and BANKNIFTY futures.
Call 2: CE and PE for ATM, ATM +/-1, +/-2, +/-3 on the nearest expiry (plus the next expiry on expiry day).
ATM is picked from the spot returned by call 1, so a row's `atm_ref` is known at fetch time.

Per row: exchange timestamp, last trade time, LTP, OHLC, volume, volume change, OI, OI change, OI day high/low,
best bid/ask with quantities and order counts, five-level bid/ask quantity totals, buy/sell quantity, average price.
Options also carry `rel_strike` and a derived Black-Scholes `iv_calc` from the bid/ask mid (Kite does not publish IV;
it is NULL when the book is empty or the price is outside no-arbitrage bounds).
`day_context` stores the open, gap, previous-day high/low/close and the opening range with the minute each became known.

Kite limits checked on 2026-11-02 with the owner's token: `/quote` accepts up to 500 instruments and is limited to
about 1 request per second; the recorder uses 2 per minute. Historical candles are about 3 per second and the minute
interval returns at most 60 days per request. The owner's session has NFO, MCX, NSE, BSE, BFO, so futures and options
quotes, depth, OI and 1-minute history with OI are all permitted.

## Guarantees

- Raw responses: `raw/YYYY-MM-DD.ndjson`, append-only, gzipped (never rewritten) on the next trading day.
- `quotes` primary key is `(token, minute_key)`; a duplicate is ignored and counted, never overwritten.
- `minutes` has one row for every attempted minute with its status (OK, PARTIAL, NO_AUTH, AUTH_FAILED, HTTP_ERROR, NO_SPOT).
- Real update times are kept: `exch_ts`, `ltt`, `stale_s`, and `ltt_changed` (0 = Kite sent the same last trade again).
- Expected session length is derived from data (minutes in which the NIFTY spot exchange timestamp advanced), not hardcoded.
  Futures traded to 15:40 in 2026, and F&O hours changed between 2026-07-31 and 2026-08-03.
- `errors.ndjson` and `recorder.log` keep every failure. pm2 restarts the process after a crash; all state is in SQLite.
- Daily summary: `summaries/YYYY-MM-DD.json` (status, missing minute ranges, per-instrument zero-volume/stale/no-book
  counts, OI-constant check, disk free). Run `node market-recorder/status.js [date]` any time.

## Timing rule for research (look-ahead guard)

A row with `minute_key` K was fetched at K:03. For an event on the 1-minute candle labelled T (it closes at T+1:00),
a trade entering at the open of bar T+1+delay may only use rows with `minute_key <= T + delay minutes`.
`research/live_features.py` implements this and `research/test_live_features.py` proves later rows cannot change a feature.

## Kite session

The recorder uses the newest session the site already saved (`momentum.sqlite` broker_sessions, opened read-only), or
`auth.json` if newer. Kite tokens die every morning, so open Get Token once before 09:15; until then minutes are logged as
NO_AUTH or AUTH_FAILED and the process picks the new token up by itself. Fallback:
`printf '%s\n%s\n' "$API_KEY" "$ACCESS_TOKEN" | node market-recorder/set-auth.js`.

## Storage

Roughly 35 rows per minute: about 13,000 rows and 12 MB of raw JSON a session (about 1.5 MB gzipped) plus a few MB of SQLite.
Plan on well under 2 GB a year; the droplet had 2.6 GB free on 2026-11-02, so `low_disk` is raised in the summary below 500 MB.

## Backfill and research

`node market-recorder/backfill-futures.js [days]` (needs `KITE_AUTH`) loads Kite 1-minute history with OI for futures that are
still listed, plus index spot and VIX, into `hist_bars`. Expired contracts cannot be fetched, and a far-month contract is thin
early in its life, so futures history is limited to the contracts listed today (NOV FUT from 2026-08-26).
`research/` holds the cost model (`costs.py`), breakout events and labels (`events.py`), Models A-D (`models.py`),
the no-model target/stop sweep (`rr_sweep.py`) and the as-of options/book features (`live_features.py`).
Tests: `node --test market-recorder/tests/*.test.js`, `cd market-recorder/research && python3 test_costs.py && python3 test_live_features.py`.
