# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

## DNA — Daily Band Loop (`appBuild: 2026.08.12-daily-band-750-2000`)

**Target @ 1 lot: ₹750–₹2000/day when the loop is followed.**

1. **Nifty Trap** — pierce20 / peak ₹100/50/50 / max3 / stand-down ₹350  
2. **Bank Trap** — only after Nifty traded **and Nifty day net is green**  
3. **Band lock** — keep win-streak while `dayNet < ₹750`; **LOCK at ₹750**; hard **LOCK ₹2000** / STOP **−₹2950**  
4. **No dig** — a losing close after the desk was green stops further index entries  
5. **Crude LIVE_CRUDE_GREEN** — after 15:15, only if desk still below ₹750  

### Capital from UI
- Send `capital` / `capitalRs` on Start → server maps to shared `deskLots`
- Band floor/ceiling scale with lots (₹750/₹2000 × lots)
- One-leg desk: capital rotates across books

### Paper ≡ Live
- Reject estimated/synthetic premiums  
- One open leg  
- Fill friction  
- Bank-after-Nifty(+green)  
- Win-streak → band + no dig  

### Research (when loop followed)
- Jul 2026 ≈ **23/23** · avg ~**₹1,496**/day  
- 21 Jul–10 Aug paper **15/15** · ~**₹1.8k**/day  
- Aug MTD All3 days mostly **₹1.2k–₹2.8k**  
- Broken ops: 10 Aug live **−₹1,297** · 12 Aug re-hunt after +₹387 → **−₹582**  

## Ops
- `POST /live/start` with UI capital/lots  
- `POST /live/backtest` → Paper≡Live filtered trades  
- After deploy: **Stop → Start**
- Offline proof: `node scripts/test-daily-band-loop.js`
