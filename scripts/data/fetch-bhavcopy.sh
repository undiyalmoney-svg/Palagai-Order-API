#!/usr/bin/env bash
# Downloads NSE daily bhavcopy archives — the survivorship-aware price source.
#
# WHY THIS AND NOT THE BROKER API: a broker's instrument list contains only
# CURRENTLY listed securities. Bhavcopy is a daily snapshot of everything that
# actually traded that day, so a company that traded in 2016 and delisted in
# 2019 appears in 2016-19 files and then stops. That is structurally
# survivorship-free. Verified: DHFL and JETAIRWAYS present in Jan-2018,
# absent in Aug-2025.
#
# TWO FORMATS: NSE switched format in mid-2024.
#   legacy (<= 2024-06): .../content/historical/EQUITIES/YYYY/MON/cmDDMONYYYYbhav.csv.zip
#   new    (>= 2024-07): .../content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip
# Both are handled; holidays return 404 and are skipped (expected, not an error).
#
# Politeness: modest concurrency, retries off, weekends skipped client-side.
#
# Usage: fetch-bhavcopy.sh <FROM_YYYY-MM-DD> <TO_YYYY-MM-DD> <OUTDIR>
set -uo pipefail

FROM="${1:?from date}"; TO="${2:?to date}"; OUT="${3:?outdir}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
RAW="$OUT/raw"; mkdir -p "$RAW"

# Build the list of candidate weekday URLs
LIST="$OUT/_urls.txt"; : > "$LIST"
cur="$FROM"
while [[ "$cur" < "$TO" || "$cur" == "$TO" ]]; do
  dow=$(date -j -f "%Y-%m-%d" "$cur" "+%u" 2>/dev/null || date -d "$cur" "+%u")
  if [[ "$dow" -le 5 ]]; then
    y=${cur:0:4}; m=${cur:5:2}; d=${cur:8:2}
    MON=$(date -j -f "%Y-%m-%d" "$cur" "+%b" 2>/dev/null || date -d "$cur" "+%b")
    MON=$(echo "$MON" | tr '[:lower:]' '[:upper:]')
    if [[ "$cur" > "2024-06-30" ]]; then
      echo "$cur|https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${y}${m}${d}_F_0000.csv.zip" >> "$LIST"
    else
      echo "$cur|https://nsearchives.nseindia.com/content/historical/EQUITIES/${y}/${MON}/cm${d}${MON}${y}bhav.csv.zip" >> "$LIST"
    fi
  fi
  cur=$(date -j -v+1d -f "%Y-%m-%d" "$cur" "+%Y-%m-%d" 2>/dev/null || date -d "$cur +1 day" "+%Y-%m-%d")
done
TOTAL=$(wc -l < "$LIST" | tr -d ' ')
echo "candidate weekdays: $TOTAL"

fetch_one() {
  local line="$1"
  local dt="${line%%|*}"; local url="${line#*|}"
  local zipf="$RAW/$dt.zip"
  [[ -s "$RAW/$dt.csv" ]] && return 0          # already extracted
  local code
  code=$(curl -s -m 45 -o "$zipf" -w "%{http_code}" -H "User-Agent: $UA" -H "Accept: */*" "$url")
  if [[ "$code" != "200" ]]; then rm -f "$zipf"; return 0; fi   # holiday / missing -> skip
  if unzip -o -q -d "$RAW/tmp_$dt" "$zipf" 2>/dev/null; then
    local f; f=$(find "$RAW/tmp_$dt" -name '*.csv' -type f | head -1)
    # Guard: if a stale DIRECTORY occupies the target name, `mv` would nest the
    # file inside it and the consolidator would later hit EISDIR. Clear it first.
    [[ -d "$RAW/$dt.csv" ]] && rm -rf "$RAW/$dt.csv"
    [[ -n "$f" ]] && mv "$f" "$RAW/$dt.csv"
  fi
  rm -rf "$RAW/tmp_$dt" "$zipf"
}
export -f fetch_one; export RAW UA

cat "$LIST" | xargs -P 4 -I{} bash -c 'fetch_one "$@"' _ {}

GOT=$(ls "$RAW"/*.csv 2>/dev/null | wc -l | tr -d ' ')
echo "downloaded trading days: $GOT / $TOTAL weekday candidates"
