#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Palagai Order API.
# Installs a local MongoDB (so the additive Auth/Live/P&L features work),
# installs Node dependencies, and creates a local .env if one is missing.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

MONGO_MAJOR="8.0"
MONGO_DATA_DIR="${MONGO_DATA_DIR:-$HOME/.local/share/palagai-mongo/data}"

echo "[install] Palagai Order API setup starting in $REPO_DIR"

# --- 1. Local MongoDB (optional feature backend) --------------------------
if ! command -v mongod >/dev/null 2>&1; then
  echo "[install] Installing MongoDB $MONGO_MAJOR (mongodb-org)…"
  . /etc/os-release
  UBUNTU_CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-noble}}"
  curl -fsSL "https://pgp.mongodb.com/server-${MONGO_MAJOR}.asc" \
    | sudo gpg -o "/usr/share/keyrings/mongodb-server-${MONGO_MAJOR}.gpg" --dearmor --yes
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-${MONGO_MAJOR}.gpg ] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CODENAME}/mongodb-org/${MONGO_MAJOR} multiverse" \
    | sudo tee "/etc/apt/sources.list.d/mongodb-org-${MONGO_MAJOR}.list" >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y mongodb-org
else
  echo "[install] mongod already present: $(mongod --version | head -n1)"
fi

mkdir -p "$MONGO_DATA_DIR"

# --- 2. Node dependencies -------------------------------------------------
if [ -f package-lock.json ]; then
  echo "[install] npm ci"
  npm ci
else
  echo "[install] npm install"
  npm install
fi

# --- 3. Local environment file -------------------------------------------
# .env is gitignored. Seed it for local dev so the Mongo-backed Auth/Live/P&L
# features are exercised end to end. Existing files are left untouched.
if [ ! -f .env ]; then
  echo "[install] Writing local .env (Mongo pointed at 127.0.0.1)"
  cat > .env <<'ENVEOF'
PORT=3000
FRONTEND_URLS=https://palagai.app,http://localhost:4200,http://127.0.0.1:4200
KITE_API_BASE_URL=https://api.kite.trade

# Local MongoDB started by .cursor/start.sh — enables Auth/Live/P&L persistence.
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=palagai

# Encrypts per-user Kite tokens in the Live store (local dev value only).
LIVE_AUTH_SECRET=palagai-local-dev-secret
ENVEOF
else
  echo "[install] .env already exists — leaving it untouched"
fi

echo "[install] Done."
