# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

Matches **Trade Desk Daily ₹1k–₹3k** DNA (palagai.app / Autobot `appBuild: 2026.08.10-desk-parity-option350`).

## DNA
- Nifty = **Trap** (SR Trap Confirm — next-bar confirm ON)
- Bank = Trap by default (Genie only if client sends `bankStrategy: 'genie'`)
- Crude = **Selective** (OFF by default — fee protection)
- Nat Gas / Kutty = off unless client enables

### Index Trap
- piercePts 20 · Bank40 · peak trail arm ₹100 / lock ₹50 / giveback ₹50
- soft / SL-confirm cutoff OFF
- targetRMultiple 3.5 · maxTradesPerDay 3 · dayStopPts 60
- **Option day-loss stand-down −₹350/lot** (real option OHLC P&L — skip new entries)

### Crude Selective
- SL 30 / TP 60 · session 10:00–22:00 · max 2/day · confirm ON · no OR-width skip

## Desk risk defaults
- **Day profit lock ON** — base ₹3,000 at 1 lot (50/50 Nifty/Bank when both on)
  - Points = ₹3000 × share / ₹-per-point (**not** × lots)
  - Money ≈ ₹3,000 × lots (1→₹3k · 3→₹9k)
- **Strict day stop ON** unless client opts out — Trap `dayStopPts` 60 + desk −₹2,950 label
- **Option stop −₹350 × lots** — stand-down on combined Nifty+Bank option-₹ net
- Empty start body → Daily 3k books: Nifty+Bank on, Crude off, lots 1/1/1, Trap, Selective

## Behaviour
- `POST /live/start` → 15s ticks
- Two-pass index replay (discover ATM → fetch option 5m → replay with option bars)
- Protective stop = exchange **SL** (limit), never SL-M — if SL cannot place, emergency flatten
- `GET /live/defaults` → Daily preset + checkbox hint
- `GET /live/health` → `appBuild: 2026.08.10-desk-parity-option350`
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
