# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

## DNA — All3 daily (`appBuild: 2026.08.12-first-win-green-lock`)

1. **Nifty Trap** — primary index session  
2. **Bank Trap** — only after Nifty traded **and Nifty day net is green**  
3. **Index first-win green lock** — after first green Nifty/Bank close, stop index hunting (prevents giveback). One recovery shot if desk is red after a prior green leg.  
4. **Smart exit trail** — arm ₹80 / lock ₹70 / giveback ₹30 (tightens further as MFE stretches)  
5. **Crude LIVE_CRUDE_GREEN** — after NSE close (16:00–21:00, gate 15:15)

### Capital from UI
- Send `capital` / `capitalRs` on Start → server maps to `niftyLots` / `bankLots` / `crudeLots`
- One-leg desk: same capital rotates across books (only one open at a time)
- Explicit lot fields still override when provided
- ₹12k+ → 1/1/1 · ₹75k+ → 2/2/2

### Paper ≡ Live
- Reject estimated/synthetic premiums  
- One open leg  
- Option-₹ day lock/stop  
- Fill friction  
- Bank-after-Nifty (+ Nifty green) desk filter  
- Index first-win green lock + one recovery shot  

### Research (13 Jul–11 Aug, live-path)
- **bankOnlyAfterNifty**: **9/9 green**, ~₹13k, all three books present  
- Unconstrained all-three: 20/22 green but 2 Bank-alone red days  
- **12 Aug live giveback**: first-win lock would keep ~+₹387 and skip later red legs  

## Ops
- `POST /live/start` with UI capital/lots  
- `POST /live/backtest` → Paper≡Live filtered trades  
- After deploy: **Stop → Start**
