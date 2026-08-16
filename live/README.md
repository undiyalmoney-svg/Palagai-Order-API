# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

## DNA — All3 daily (`appBuild: 2026.08.11-all3-daily`)

1. **Nifty Trap** — primary index session  
2. **Bank Trap** — only **after Nifty has traded that day** (zero-red research rule)  
3. **Crude LIVE_CRUDE_GREEN** — after NSE close (16:00–21:00, gate 15:30)

### Capital from UI
- Send `capital` / `capitalRs` on Start → server maps to `niftyLots` / `bankLots`
- ₹40k → Nifty 1×2 trades · Bank 2×1 trade
- ₹80k → Nifty 2×2 · Bank 2×1
- ₹1.2L → Nifty 3×2 · Bank 3×1
- ₹2L → Nifty 5×2 · Bank 5×1
- Then `floor(capital / ₹40k)` both books (cap 10). Stop→Start to apply.

### Paper ≡ Live
- Reject estimated/synthetic premiums  
- One open leg  
- Option-₹ day lock/stop  
- Fill friction  
- Bank-after-Nifty desk filter  

### Research (13 Jul–11 Aug, live-path)
- **bankOnlyAfterNifty**: **9/9 green**, ~₹13k, all three books present  
- Unconstrained all-three: 20/22 green but 2 Bank-alone red days  

## Ops
- `POST /live/start` with UI capital/lots  
- `POST /live/backtest` → Paper≡Live filtered trades  
- After deploy: **Stop → Start**
