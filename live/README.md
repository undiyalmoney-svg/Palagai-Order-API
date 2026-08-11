# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

## DNA — multi-strategy Paper≡Live (`appBuild: 2026.08.11-paper-live-multi`)

Not a single-strategy desk:

1. **Nifty Trap** — index session (09:45–14:45)
2. **Bank Trap** — same session, **one open leg** shared with Nifty
3. **Crude LIVE_CRUDE_GREEN** — after NSE close only (16:00–21:00, worker gate 15:30)

### Paper ≡ Live (critical)

Autobot Paper used to look greener than the broker because it:
- booked **estimated/synthetic** option premiums (live skips those)
- allowed **overlapping Nifty+Bank** legs (live `maxOpenLegs: 1`)
- locked the day on **index points** while option ₹ was still red

Paper backtest now applies the same gates:
- `rejectEstimatedPremium`
- desk **one-leg** chronological filter
- **option-₹** day profit lock / strict stop
- **fill friction** (entry +0.5 / exit −0.5 premium)

### Index Trap
- piercePts 20 · Bank 40 · peak trail ₹100/50/50 · max3 · 3.5R · stand-down ₹350
- Day lock **+₹3,000** / stop **−₹2,950** on **option ₹** (50/50 share when both books on)

### Crude LIVE_CRUDE_GREEN
- Session-OR · width 40–60 · SL30/TP80 · trail ₹350→₹180 · max 1/day · first-win
- Engine-validated May–Aug 2026: **13/14 green** · 0 entries before 15:30
- Shares capital via `maxOpenLegs: 1`

## Behaviour
- `POST /live/start` → 60s ticks
- `POST /live/backtest` → Paper date-range (live-path filtered)
- `GET /live/health` → build + DNA + liveOps
- Real-money totals prefer **broker fills** only (no phantom paper P&L)

## Safety
- Push token before real-money Start
- Prefer paper first (`realOrders` unchecked) — Paper now matches live gates
- Do **not** re-enable unlimited All-Green or Nat Gas as defaults
- EXIT always cancels resting SL before MARKET SELL
- No guarantee of every calendar day green — diversify sessions, cut fiction
