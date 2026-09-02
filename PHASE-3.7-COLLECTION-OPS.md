# PHASE 3.7 — FUTURES COLLECTION OPERATIONS + INTEGRITY
2026-08-28 · OPERATIONS PHASE · no research, no signals, no trading

## §0 COMPLIANCE
  No hypothesis was run. The collected futures data was NOT inspected for
  predictive relationships. No parameter was optimised. TEST was not opened.
  No order was placed, modified or cancelled.

## §1 SAFETY AUDIT (run BEFORE any change)
  In collector + fetcher: realOrders 0 · placeOrder 0 · modifyOrder 0 ·
  cancelOrder 0 · live-broker 0 · live.worker 0 · LiveBroker 0 · kiteService 0
  Repo-wide reachable `realOrders: true`: 0
  Transitive import closure of the collector, computed by walking requires:
      fs · path · crypto · axios      (local files: fut-collector.js, fut-fetch.js)
  The collector cannot reach the trading desk, cannot instantiate a worker and
  has no order path of any kind. Same for the watchdog.

## §2 PHASE 3.6 PRESERVED — REPRODUCTION VERIFIED
  Re-ran the 3.6 collector on the identical window:
      added 0 · 5,261 identical duplicates confirmed · 0 discrepancies
      status counts {OK:69} · dataset_hash fd80551bf6cadb9b (UNCHANGED)
  production live/kite-market.js still requests oi: 0 occurrences (untouched).
  All 3.6 guarantees intact: oi=1 research fetcher, raw OHLC/volume/OI,
  append-only, idempotent, duplicates confirmed not appended, conflicts never
  overwrite, deterministic hash, contract identity preserved, per-date session
  length, no silent normalisation.

## §3 WATCHDOG — scripts/fut-watchdog.js v1.0.0
  Separate from the collector and STRICTLY READ-ONLY with respect to the
  archive; reports go to a different directory. Verified empirically every run:
      archive hash before/after: fd80551bf6cadb9b / fd80551bf6cadb9b UNCHANGED
  Detects: missing sessions · incomplete sessions · unexpected bar counts ·
  out-of-order timestamps · duplicate candles · CONFLICTING duplicates ·
  missing OHLC · impossible OHLC relationships · negative volume · missing or
  invalid OI · OI constant across a session · contract identity conflicts ·
  multiple expiries per symbol · contract gaps · archive parse corruption ·
  hash consistency.
  Expected bar count is derived from the date's own observed session, never
  hardcoded (the NSE F&O session-hours change of 2026-07-31 -> 2026-08-03
  makes any constant wrong on one side).

## §4 SESSION CALENDAR — REUSED, NOT INVENTED
  The NIFTY index itself is the authoritative record of whether the exchange
  traded: the index has bars only on real sessions. The watchdog derives the
  calendar from it (token 256265) rather than creating a competing hand-made
  holiday list.
  Window 2026-06-01..2026-08-28 classified as:
      64 trading sessions · 24 weekend · 1 EXCHANGE HOLIDAY
  The holiday is classified as a holiday, NOT as missing data — §4 satisfied.

## §5 CONTRACT COVERAGE
  contract        token       expiry       observed range          bars
  NIFTY26SEPFUT   17512194    2026-09-29   2026-07-01 -> 08-28     3,265
  NIFTY26OCTFUT   12468226    2026-10-27   2026-07-29 -> 08-28     1,765
  NIFTY26NOVFUT   15736578    2026-11-23   2026-08-26 -> 08-28       231
  Token conflicts 0 · multiple-expiry-per-symbol 0.

  IMPORTANT OPERATIONAL FINDING — 20 sessions flagged SINGLE_CONTRACT_ONLY.
  Every July session holds only NIFTY26SEPFUT. On those dates the JUL and AUG
  contracts were also live, but they had ALREADY EXPIRED by the time we
  collected on 28 Aug, so they were unreachable.
  => BACKFILLED SESSIONS HAVE PERMANENTLY DEGRADED CONTRACT COVERAGE.
     Only FORWARD collection captures the full contract universe of a session.
     This is not a bug; it is a property of the data source, and it is a
     second, quieter form of the same loss mechanism.

## §6 MISSED-DAY DETECTION + RECOVERY
  usable (OK) 43 / 64 expected sessions in window.
      MISSING 21 · INCOMPLETE 0 · OK 43
  All 21 missing sessions are June 2026 — before collection began. Each was
  probed against every currently-live contract:
      RECOVERABLE 0 · PERMANENTLY UNRECOVERABLE 21
  The loss mechanism is now quantified rather than asserted: 21 sessions of
  intraday futures volume and OI are gone and cannot be obtained at any price.

## §7 FAIL-CLOSED — VERIFIED IN BOTH DIRECTIONS
  The collector never manufactures candles, never interpolates, never copies
  another contract, never substitutes zero for missing OI, and never marks a
  bad session OK; failures are preserved in errors.ndjson and surfaced.
  scripts/fut-daily.sh exits NON-ZERO when the archive needs attention:
      window with a known gap        -> exit 1  (ATTENTION)
      fully-collected window         -> exit 0  (HEALTHY)
  A missed session therefore cannot be silently overlooked by an operator or
  a scheduler.

## §8 HEALTH REPORT
  Machine-readable: reports/health-summary.json and reports/health-daily.json
  Per-session fields: date · expected_session · contracts_seen ·
  bars_by_contract · expected_bars · first_timestamp · last_timestamp ·
  volume_status · oi_status · duplicate_count · discrepancy_count ·
  out_of_order · ohlc_invalid · archive_hash · status
  Summary fields: last_successful_session · last_attempted_session ·
  usable_sessions · missing/incomplete/unrecoverable/recoverable lists ·
  contract_coverage_anomalies · oi_anomalies · duplicate/conflict counts ·
  archive integrity block · overall_status

  CURRENT STATE
    last successful session      2026-08-28
    usable sessions              43
    missing                      21 (all pre-collection June 2026)
    unrecoverable                21
    incomplete                   0
    OI anomalies                 0
    duplicate physical keys      0
    discrepancy records          0
    parse errors                 0
    archive hash                 fd80551bf6cadb9b
    OVERALL                      ATTENTION (solely due to the pre-collection
                                 June gap, which is permanent and closed)

## OPERATION
  Daily, after market close, with a fresh Kite access token:

    FUT_DIR=<archive> KAPI=<key> KTOK=<token> ./scripts/fut-daily.sh

  Defaults to a trailing 7-day window, which self-heals a missed run while the
  contracts are still listed. Idempotent. Exits non-zero on any anomaly.

## POSITION
  43 usable sessions banked toward the ~500+ needed for Phase 3.8.
  Two distinct decay clocks now measured, not assumed:
    1 a session missed entirely is unrecoverable once its contracts expire
      (~3 months) — 21 already lost
    2 even a recoverable backfill loses the contracts that expired in the
      interim, permanently degrading that session's coverage
  Both argue for running the collector every day rather than in batches.
