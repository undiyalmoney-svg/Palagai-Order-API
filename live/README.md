# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

## DNA (Phase 1)
- Nifty = Trap (fixed)
- Crude = All-Green (fixed)
- Bank = Trap | Genie (selectable)

## Behaviour
- `POST /live/start` → 60s ticks (same cadence as Trade Desk Local Live)
- Replays Trap / Genie / All-Green on Kite 5m candles
- When `realOrders=true`: MARKET BUY + SL-M via `kite.service` (tags `PALAGAI` / `PALAGAISL`)
- When `realOrders=false`: signals/events only (paper)
- Auth: `PUT /live/auth` with daily apiKey + accessToken

## Files
- `strategy-core.cjs` — bundled Trap/Genie/All-Green engines (rebuild from palagai `scripts/server-live/build-strategy-core.cjs`)
- `live.worker.js` — tick orchestrator
- `live-broker.js` — place / modify SL / exit
- `kite-market.js` — instruments + historical + quotes

## Safety
- Push token before real-money Start
- Prefer paper first (`realOrders` unchecked) to watch SIGNAL / DATA events
- Stop Local Live on the same books if you run Server Live real money (avoid double orders)
