# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

Matches **Trade Desk Daily ₹1k–₹3k** DNA (palagai.app `appBuild: 2026.08.04-desk-one-profit`).

## DNA
- Nifty = **Trap** (SR Trap Confirm — next-bar confirm ON)
- Bank = Trap by default (Genie only if client sends `bankStrategy: 'genie'`)
- Crude = **Selective** (default)
- Nat Gas / Kutty = off unless client enables

### Index Trap
- piercePts 10 · peak trail arm ₹150 / lock ₹75 / giveback ₹75
- soft / SL-confirm cutoff OFF
- targetRMultiple 2 · maxTradesPerDay 0 · dayStopPts 80

### Crude Selective
- SL 30 / TP 60 · session 10:00–22:00 · max 2/day · confirm ON · no OR-width skip

## Desk risk defaults
- **Day profit lock ON** — base ₹3,000 at 1 lot (50/50 Nifty/Bank when both on)
  - Points = ₹3000 × share / ₹-per-point (**not** × lots)
  - Money ≈ ₹3,000 × lots (1→₹3k · 3→₹9k)
- **Strict day stop OFF** unless client opts in — base −₹2,950 × lots
- Empty start body → Daily 3k books: Nifty+Bank+Crude on, lots 1/1/1, Trap, Selective

## Behaviour
- `POST /live/start` → 60s ticks
- `GET /live/defaults` → Daily preset + checkbox hint
- `GET /live/health` → `appBuild: 2026.08.04-autobot-daily-3k`
- Futures: prefer next CRUDEOILM on expiry day (options already roll)
- Options long only via broker path (BUY→CE / SELL→PE); per-trade SL does not halt the day

## Files
- `daily-desk-defaults.js` — ₹ bands, lot-scaled labels, start normalize
- `strategy-core.cjs` — Trap / Genie / Selective engines
- `live.worker.js` — tick orchestrator + day-risk overrides on Trap init
- `live-broker.js` — place / modify SL / exit

## Safety
- Push token before real-money Start
- Prefer paper first (`realOrders` unchecked)
- Do **not** re-enable unlimited All-Green or Nat Gas as defaults
- Do **not** disable Trap next-bar confirm
- EXIT always cancels / confirms resting SL is gone before MARKET SELL — a locked SL qty makes Zerodha treat the SELL as a naked short (“Insufficient funds” ~full option margin)
