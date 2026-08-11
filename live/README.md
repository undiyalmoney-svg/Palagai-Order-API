# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

Matches **Trade Desk Daily ₹1k–₹3k** DNA (palagai.app `appBuild: 2026.08.04-desk-one-profit`).

## DNA
- Nifty = **Trap** (SR Trap Confirm — next-bar confirm ON)
- Bank = Trap by default (Genie only if client sends `bankStrategy: 'genie'`)
- Crude = **LIVE_CRUDE_GREEN** when enabled (OFF by default — fee protection)
- Nat Gas / Kutty = off unless client enables

### Index Trap (LIVE_GREEN)
- piercePts 20 · Bank 40 · peak trail ₹100/50/50 · max5 · 3.5R · stand-down ₹350

### Crude LIVE_CRUDE_GREEN (v3 · after NSE only)
- **Autobot hard-off for now** (`AUTOBOT_ALLOW_CRUDE=false`) — Start ignores Crude toggle; index only
- When re-enabled: **no entries during Nifty/Bank session** — window **16:00–21:00**, worker gate **15:30**
- Session-OR · width **40–60** · SL30 / TP80 · trail ₹350→₹180 · max **1**/day · first-win
- Engine-validated May–Aug 2026: **13/14 green (92.9%)**, 0 entries before 15:30
- Shares capital with index via `maxOpenLegs: 1`

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
- Live money ledger on `GET /live/status` → `trades` + `totals`: paper marks kept as `paper*`, overwritten by broker `average_price` fills (`fillSource: "broker"`). Auto UI should show these for real-money P&L, not candle/trail estimates.
