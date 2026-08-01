#!/usr/bin/env bash
# Deploy Palagai-Order-API message/payment fields to the droplet.
# Run from any machine that can SSH as root@168.144.28.89
set -euo pipefail
HOST="${ORDER_API_HOST:-root@168.144.28.89}"
ssh "$HOST" 'set -euo pipefail
  cd /var/www/Palagai-Order-API
  git fetch origin main
  git checkout main
  git pull origin main
  echo "HEAD=$(git log -1 --oneline)"
  grep -n "dismiss-message" auth/auth.routes.js
  grep -n "adminMessage" auth/users.store.js | head -5
  npm install --omit=dev
  pm2 restart trading-backend --update-env
  sleep 1
  curl -s http://127.0.0.1:3000/health
  echo
  curl -s -X POST http://127.0.0.1:3000/auth/me/dismiss-message -H "Content-Type: application/json" -d "{}"
  echo
'
echo
echo "From your laptop, confirm (expect HTTP 401 Login required, NOT 404):"
echo "  curl -s -w \"\\nHTTP %{http_code}\\n\" -X POST http://168.144.28.89:3000/auth/me/dismiss-message -H \"Content-Type: application/json\" -d \"{}\""
