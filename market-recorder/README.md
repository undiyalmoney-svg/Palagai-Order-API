# Market recorder (Nifty, Bank Nifty, Sensex and Crude Oil Mini futures and options)

A separate process (`palagai-recorder` under pm2). It only reads Kite market data. It imports no order, broker,
desk or strategy module, never places an order, and writes only to its own directory.

## What it records (weekdays; version 1.1.0)

Each underlying has its own session: NIFTY, BANKNIFTY, SENSEX 09:05 to 15:45 IST; CRUDEOILM (MCX Crude Oil Mini) 09:00 to
23:40 IST (the exchange closes at 23:30, or 23:55 in US summer time). Only underlyings whose session is open are fetched.

Call 1 (one `/quote` request): India VIX, the spot index of each active index group (Nifty 50, Nifty Bank, BSE Sensex),
and the two nearest futures of every active underlying (NIFTY, BANKNIFTY, SENSEX, CRUDEOILM).
Call 2: CE and PE for ATM, ATM +/-1, +/-2, +/-3 on the nearest expiry (plus the next expiry on expiry day) of each active underlying.
ATM is picked from the reference price returned by call 1 (spot for indices, the matching future for crude), so a row's
`atm_ref` is known at fetch time. The big CRUDEOIL contract is excluded on purpose. Kite lot sizes: Nifty 65, Bank Nifty 30,
Sensex 20, CRUDEOILM 1 lot = 10 barrels.

Per row: exchange timestamp, last trade time, LTP, OHLC, volume, volume change, OI, OI change, OI day high/low,
best bid/ask with quantities and order counts, five-level bid/ask quantity totals, buy/sell quantity, average price.
Rows also carry the exchange circuit limits (`lower_circuit`, `upper_circuit`). Options carry `rel_strike`, a derived
`iv_calc` from the bid/ask mid and the Greeks `delta`, `gamma`, `theta_day` (per calendar day), `vega_1pct` (Kite does not
publish IV or Greeks; they are NULL when the book is empty or the price is outside no-arbitrage bounds). Index options use
Black-Scholes on spot with r = 6.5%. Crude options use Black-76 with r = 0 on the **forward implied by put-call parity** of the
near-ATM pairs (`spot_ref`), not the future's LTP: on 2026-11-02 the Nov future sat at its lower circuit with no bids while the
options kept trading about 90 points lower, and the future's LTP gave puts and calls different IVs.
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
- Expected session length is derived per underlying from data (minutes in which the anchor's exchange timestamp advanced:
  the spot index, or the front future for crude), not hardcoded.
  Futures traded to 15:40 in 2026, and F&O hours changed between 2026-07-31 and 2026-08-03.
- `errors.ndjson` and `recorder.log` keep every failure. pm2 restarts the process after a crash; all state is in SQLite.
- Daily summaries: `summaries/YYYY-MM-DD.<UNDERLYING>.json` when each session ends and `summaries/YYYY-MM-DD.json` at 23:40
  (per-underlying status, missing minute ranges, option rows without a two-sided book, zero-volume/stale/no-book counts,
  OI-constant check, DB/raw size, disk free and `projected_trading_days_left`). Run `node market-recorder/status.js [date]` any time.
- Schema upgrades are additive only (`migrate()` adds columns); existing rows are never touched.

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

About 80 rows a minute while the index sessions are open (11 market rows + about 70 option rows) and 16 while only crude is open:
roughly 46,000 rows and about 46 MB of raw JSON a day (about 7 MB gzipped the next day) plus about 12-15 MB of SQLite.
That is about 22 MB a day once history is compressed, so the droplet's 2.6 GB free (2026-11-02) is about 100+ trading days.
These are estimates from the smoke test; the daily summary reports the measured `avg_mb_per_recorded_day` and `projected_trading_days_left`,
and raises `low_disk` below 500 MB. The droplet has 458 MB of RAM; the recorder process uses about 70 MB.

## Backfill and research

`node market-recorder/backfill-futures.js [days]` (needs `KITE_AUTH`) loads Kite 1-minute history with OI for futures that are
still listed, plus index spot and VIX, into `hist_bars`. Expired contracts cannot be fetched, and a far-month contract is thin
early in its life, so futures history is limited to the contracts listed today (NOV FUT from 2026-08-26).
`research/` holds the cost model (`costs.py`, NSE/BSE/MCX futures and options), breakout events and labels (`events.py`), Models A-D (`models.py`),
the no-model target/stop sweep (`rr_sweep.py`), the as-of options/book features (`live_features.py`), and the options-buying study
(`opt_core.py`, `opt_run.py`, `opt_null.py`, `opt_tier2.py`, `opt_fut.py`, `opt_regimes.py`, `crude_research.py`, `fetch_history.py`;
results and verdict in `research/OPTIONS-BUYING-RESEARCH.md`).
Tests: `node --test market-recorder/tests/*.test.js`, `cd market-recorder/research && python3 test_costs.py && python3 test_live_features.py && python3 test_opt_core.py`.
