#!/usr/bin/env bash
# Per-boot startup: bring up the local MongoDB the API's additive features use.
# Idempotent — a mongod already listening on 27017 is left as-is.
set -euo pipefail

MONGO_DATA_DIR="${MONGO_DATA_DIR:-$HOME/.local/share/palagai-mongo/data}"
MONGO_LOG="${MONGO_LOG:-$HOME/.local/share/palagai-mongo/mongod.log}"
MONGO_PORT="${MONGO_PORT:-27017}"

mkdir -p "$MONGO_DATA_DIR" "$(dirname "$MONGO_LOG")"

if ! command -v mongod >/dev/null 2>&1; then
  echo "[start] mongod not installed — skipping (API runs in in-memory mode)."
  exit 0
fi

is_up() {
  (exec 3<>"/dev/tcp/127.0.0.1/${MONGO_PORT}") 2>/dev/null && return 0 || return 1
}

if is_up; then
  echo "[start] MongoDB already listening on ${MONGO_PORT}."
  exit 0
fi

echo "[start] Starting mongod on 127.0.0.1:${MONGO_PORT}…"
mongod --dbpath "$MONGO_DATA_DIR" --bind_ip 127.0.0.1 --port "$MONGO_PORT" \
  --logpath "$MONGO_LOG" --fork

for _ in $(seq 1 30); do
  if is_up; then
    echo "[start] MongoDB is ready."
    exit 0
  fi
  sleep 1
done

echo "[start] ERROR: MongoDB did not become ready in time. Recent log:" >&2
tail -n 20 "$MONGO_LOG" >&2 || true
exit 1
