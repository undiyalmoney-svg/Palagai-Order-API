# PHASE 3.6 — NIFTY FUTURES INTRADAY DATA COLLECTION
2026-08-28 · BUILD PHASE · no research, no signals, no trading

## §1 COMPLIANCE
  No directional hypothesis was run. No parameter was optimised. The collected
  data was NOT inspected for predictive relationships. No performance statistic
  was computed. TEST was not opened. The output of this phase is an archive.

## WHAT WAS BUILT
  scripts/fut-fetch.js       research-local fetcher that requests oi=1
                             (live/kite-market.js is NOT modified — it never
                             requests OI and drops any 7th column)
  scripts/fut-collector.js   COLLECTOR_VERSION 1.1.0 · SCHEMA_VERSION 1
  archive: futarchive/
    candles.ndjson    append-only raw observations + discrepancy records
    contracts.ndjson  append-only contract metadata with first_seen
    ledger.ndjson     append-only per-session quality ledger + run summaries
    errors.ndjson     every failed request

## §2/§3 DATA AND CONTRACT COVERAGE
  Interval 5-minute (mandatory) · NIFTY futures only.
  Per candle stored RAW and unmodified: instrument_token, tradingsymbol,
  expiry, lot_size, trading_date, timestamp, open, high, low, close, volume,
  open_interest, exchange_timestamp, collected_at, request_window.
  Contract discovery uses ONLY the live instrument dump. Final daily volume
  and final daily OI are never used to decide what to collect (§12).
  Full contract universe recorded each run: SEP/OCT/NOV 2026, lot 65.

## SEEDING RUN
  window 2026-06-01 .. 2026-08-28
  5,261 candles · 43 distinct sessions · 69 contract-sessions
  status counts: OK 69 · INCOMPLETE 0 · DUPLICATE 0 · OUT_OF_ORDER 0 ·
                 OI_CONSTANT 0 · OI_MISSING 0
  dataset_hash fd80551bf6cadb9b

## §10 IDEMPOTENCY — VERIFIED TWICE
  Re-running the identical window:
    added 0 new candles · 5,261 identical duplicates CONFIRMED ·
    0 discrepancies · dataset_hash UNCHANGED
  Duplicate handling is by design: identical re-downloads are confirmed and
  counted, never re-appended; a DIFFERING value would append a `discrepancy`
  record and preserve the original rather than overwrite it. None occurred.

## §6 OI VALIDATION — PASSES, AND CONTINUOUSLY MONITORED
  Every one of the 69 contract-sessions shows OI varying intraday.
  Distinct OI values per session ranged 45-77 out of 75-77 bars.
  Front contract example (2026-08-24): 6,707,090 -> 10,208,835 across the day.
  Missing OI is never replaced with zero; a session with constant or absent OI
  is flagged OI_CONSTANT / OI_MISSING and would be visible in the ledger.

## §7 VOLUME VALIDATION
  Zero-volume bars are counted per session (0-5, concentrated in the far NOV
  contract, which is expected for a newly listed contract). Impossible values
  (high<low, negatives) are counted: 0 found. No normalisation, no
  winsorising — raw values only; derived features are the research layer's job.

## §8 SESSION INTEGRITY — AND A REAL FINDING
  Expected bar count is DERIVED PER DATE, never hardcoded. That mattered:

    SESSION-LENGTH CHANGE: 2026-07-31 (75 bars, last bar 15:25)
                        -> 2026-08-03 (77 bars, last bar 15:35)

  NSE extended F&O session hours between those dates. The change is purely
  date-driven — 0 of 43 dates showed disagreement between contracts. A
  hardcoded expected count (75 or 77) would have misclassified every session
  on one side of the change as INCOMPLETE. Collector v1.0.0 used a fixed
  threshold; v1.1.0 derives expected bars per date from the contracts observed
  that date. This is exactly the failure §8 warned against.

## §9 API FAILURE HANDLING
  Bounded retries (4 attempts, exponential backoff 1.5s->12s), no infinite
  loops. Every failed request is appended to errors.ndjson. A contract whose
  history cannot be fetched writes an API_ERROR ledger row and does not abort
  the run. Safe to restart after crash, network failure or reboot: the
  in-memory index is rebuilt from the archive on every start.

## §13/§14 RAW VS DERIVED, AND VERSIONING
  The archive contains ONLY source observations and immutable metadata. No
  relative volume, no dOI, no basis, no event labels — those belong to
  research code and must be reproducible from the raw archive.
  Every run records collector version, schema version, run timestamp, window,
  contract count, added/duplicate/discrepancy counts, archive line count and
  dataset hash.

## §15 SAFETY AUDIT
  collector + fetcher: placeOrder 0 · modifyOrder 0 · cancelOrder 0 ·
                       live-broker 0 · kiteService 0 · realOrders 0
  imports: fs, path, crypto, ./fut-fetch (axios only)
  repo-wide reachable realOrders:true : 0
  production live/kite-market.js      : UNMODIFIED
  Real orders placed: NO.

## CURRENT POSITION AND WHAT IT BUYS
  43 usable sessions collected. A credible Phase 3.5 re-run needs a
  chronological DEV/VALID/TEST split; at roughly 250 sessions/year, a minimal
  three-way split is ~500+ sessions, i.e. about two years away.

  The archive is now the binding asset. Every session not collected is
  permanently lost, because expired futures tokens become unresolvable — the
  same mechanism that made the historical test impossible in the first place.

## OPERATION
  Run daily after market close. Idempotent; safe to run repeatedly, and safe
  to run over a wide window to backfill anything missed:

    FUT_DIR=<archive> KAPI=<api_key> KTOK=<access_token> \
      node scripts/fut-collector.js <FROM> <TO>

  Kite access tokens are daily, so the token must be refreshed each session.
  A missed day is recoverable ONLY while the contract is still listed —
  roughly a three-month window. After that it is gone for good.
