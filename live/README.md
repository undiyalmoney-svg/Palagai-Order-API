# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

## DNA
- Nifty = Trap (fixed)
- Crude = **Selective** (default) — charge-aware; All-Green only if `crudeStrategy: 'all-green'` is sent explicitly
- Bank = Trap | Genie (selectable)

### Crude Selective DNA
- `entryMode`: session-or
- `maxOrWidth`: 60 (skip wild OR days)
- Evening window: 18:30–22:00
- Stop 40 / target 80
- `requireConfirm`: true · `firstWinLock`: true
- `maxEveningTradesDay`: 1
- `dayLossStopPts` / `strictDayLossPts`: 40
- Trail / protect: OFF

## Behaviour
- `POST /live/start` → 60s ticks (same cadence as Trade Desk Local Live)
- Replays Trap / Genie / Selective on Kite 5m candles
- When `realOrders=true`: MARKET BUY + SL-M via `kite.service` (tags `PALAGAI` / `PALAGAISL`)
  - Note: Zerodha may block bare SL-M on some commodity options — monitor REJECT events
- When `realOrders=false`: signals/events only (paper)
- Auth: `PUT /live/auth` with daily apiKey + accessToken
- Futures: prefer next CRUDEOILM contract on expiry day (options already roll)

## Files
- `strategy-core.cjs` — bundled Trap/Genie/Crude engines (rebuild from palagai `scripts/server-live/build-strategy-core.cjs`)
- `live.worker.js` — tick orchestrator
- `live-broker.js` — place / modify SL / exit
- `kite-market.js` — instruments + historical + quotes

## Safety
- Push token before real-money Start
- Prefer paper first (`realOrders` unchecked) to watch SIGNAL / DATA events
- Auto Trader UI keeps Crude checkbox **OFF** by default (fee protection)
- Stop Local Live on the same books if you run Server Live real money (avoid double orders)
- Do **not** re-enable unlimited All-Green or Nat Gas as defaults
