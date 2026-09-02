#!/usr/bin/env bash
# NSE MTO (Market Trade-to-delivery) archive — per-security daily delivery position.
#
# Format (verified live before writing):
#   line1  Security Wise Delivery Position - Compulsory Rolling Settlement
#   line2  10,MTO,<DDMMYYYY>,<total qty>,<record count>
#   line3  Trade Date <15-JAN-2019>,Settlement Type <N>,...
#   line4  Record Type,Sr No,Name of Security,Quantity Traded,Deliverable Quantity,% ...
#   data   20,<srno>,<SYMBOL>,<SERIES>,<qtyTraded>,<delivQty>,<delivPct>
#
# NOTE: the series column carries non-equity instruments too (NC/N4 debentures
# seen in 2025 files), so the parser MUST filter series==EQ. Delivery % is
# SUPPLIED by NSE, not computed by us — the audit re-derives it independently
# to check internal consistency.
#
# Usage: fetch-mto.sh <FROM_YYYY-MM-DD> <TO_YYYY-MM-DD> <OUTDIR>
set -uo pipefail
FROM="${1:?from}"; TO="${2:?to}"; OUT="${3:?outdir}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
RAW="$OUT/raw"; mkdir -p "$RAW"

LIST="$OUT/_urls.txt"; : > "$LIST"
cur="$FROM"
while [[ "$cur" < "$TO" || "$cur" == "$TO" ]]; do
  dow=$(date -j -f "%Y-%m-%d" "$cur" "+%u" 2>/dev/null || date -d "$cur" "+%u")
  if [[ "$dow" -le 5 ]]; then
    y=${cur:0:4}; m=${cur:5:2}; d=${cur:8:2}
    echo "$cur|https://nsearchives.nseindia.com/archives/equities/mto/MTO_${d}${m}${y}.DAT" >> "$LIST"
  fi
  cur=$(date -j -v+1d -f "%Y-%m-%d" "$cur" "+%Y-%m-%d" 2>/dev/null || date -d "$cur +1 day" "+%Y-%m-%d")
done
echo "candidate weekdays: $(wc -l < "$LIST" | tr -d ' ')"

fetch_one() {
  local line="$1"; local dt="${line%%|*}"; local url="${line#*|}"
  [[ -s "$RAW/$dt.dat" ]] && return 0
  local code
  code=$(curl -s -m 45 -o "$RAW/$dt.dat.part" -w "%{http_code}" -H "User-Agent: $UA" "$url")
  if [[ "$code" == "200" ]] && [[ -s "$RAW/$dt.dat.part" ]]; then
    if head -1 "$RAW/$dt.dat.part" | grep -qi "delivery"; then
      mv "$RAW/$dt.dat.part" "$RAW/$dt.dat"
    else rm -f "$RAW/$dt.dat.part"; fi
  else rm -f "$RAW/$dt.dat.part"; fi
}
export -f fetch_one; export RAW UA
cat "$LIST" | xargs -P 4 -I{} bash -c 'fetch_one "$@"' _ {}
echo "downloaded: $(ls "$RAW"/*.dat 2>/dev/null | wc -l | tr -d ' ')"
