#!/bin/bash
# PHASE 3.7 — daily operational runner. READ-ONLY w.r.t. broker state.
# Collects, then audits, then FAILS CLOSED (non-zero exit) if the archive
# needs attention, so a missed or degraded session cannot be overlooked.
set -uo pipefail
: "${FUT_DIR:?FUT_DIR required}"; : "${KAPI:?}"; : "${KTOK:?}"
OUT_DIR="${OUT_DIR:-$FUT_DIR/reports}"
FROM="${1:-$(date -v-7d +%F)}"; TO="${2:-$(date +%F)}"
SUMMARY="$OUT_DIR/health-summary.json"

echo "=== collect $FROM .. $TO ==="
FUT_DIR="$FUT_DIR" KAPI="$KAPI" KTOK="$KTOK" node scripts/fut-collector.js "$FROM" "$TO" || { echo "COLLECTOR FAILED"; exit 2; }
echo
echo "=== audit ==="
# Remove any previous summary first: if the audit aborts before writing a new
# one, a stale file must not be mistaken for today's verdict.
rm -f "$SUMMARY"
FUT_DIR="$FUT_DIR" OUT_DIR="$OUT_DIR" KAPI="$KAPI" KTOK="$KTOK" node scripts/fut-watchdog.js "$FROM" "$TO" | tail -20
WD=${PIPESTATUS[0]}
[ "$WD" -eq 0 ] || { echo; echo "WATCHDOG ABORTED (exit $WD) — no verdict produced."; exit "$WD"; }
[ -f "$SUMMARY" ] || { echo; echo "WATCHDOG produced no summary at $SUMMARY — refusing to pass."; exit 3; }

ST=$(node -e "console.log(require('$SUMMARY').overall_status)" 2>/dev/null || echo UNKNOWN)
echo
echo "OVERALL STATUS: $ST"
[ "$ST" = "HEALTHY" ] || { echo "ATTENTION REQUIRED — see $SUMMARY"; exit 1; }
