#!/usr/bin/env bash
# Deploy Selective Crude Autobot DNA to the Order-API droplet and restart pm2.
# Requires SSH: root@168.144.28.89
set -euo pipefail
HOST="${ORDER_API_HOST:-root@168.144.28.89}"
ssh "$HOST" 'set -euo pipefail
  cd /var/www/Palagai-Order-API
  git fetch origin main
  git checkout main
  git pull origin main
  echo "HEAD=$(git log -1 --oneline)"
  grep -n "selective" live/live.store.js live/live.worker.js | head -20
  node -e "const {resolveCrudeStrategyProfile}=require(\"./live/strategy-core.cjs\"); const p=resolveCrudeStrategyProfile(); if(p.profileId!==\"selective\"||p.maxEveningTradesDay!==1||p.maxOrWidth!==60){console.error(p); process.exit(1)} console.log(\"resolve OK\", p.profileId, \"max\", p.maxEveningTradesDay, \"OR\", p.maxOrWidth)"
  npm install --omit=dev
  pm2 restart trading-backend --update-env
  sleep 2
  curl -s http://127.0.0.1:3000/health
  echo
  curl -s http://127.0.0.1:3000/live/health
  echo
  pm2 status trading-backend
'
echo
echo "From laptop: curl -s http://168.144.28.89:3000/live/health"
