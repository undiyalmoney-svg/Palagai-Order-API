# Agent handoff — Charts Protect

**Date:** 2026-10-02  
**Repos:** `palagai` (frontend) and `Palagai-Order-API` (droplet)  
**Branch (both):** `cursor/protect-charts-auto-9eb1`

Same document lives in the frontend repo (`palagai/AGENT-HANDOFF.md`). Keep them in sync when you change Protect.

## This droplet’s job

Be the unattended Charts Protect brain: **place** the ATM when SMC prints a fresh BUY/SELL, **rest the 25% SL**, **watch 0.5R**, **cancel every resting SELL**, then **MARKET SELL**. The owner should not need the Charts tab open.

Worker: `charts-protect/worker.js` (started from `server.js`).  
Entries: `charts-protect/entry.js` + bundled `from-charts/bundle.js` (`analyzeSmc`, `buildAtmOrderPlan`).  
Rules: `charts-protect/rules.js` (windows, HTF, one book, lots).  
API: `GET/PUT /momentum/charts-protect`, `POST /momentum/charts-protect/fill`.  
State: `data/charts-protect/state.json`.

Exit path (do not “simplify”):

1. Cancel every resting MIS SELL on that tradingsymbol (SL and any leftover TP).
2. Wait ~400ms; if still live, cancel again.
3. If a stop is still live, **do not** send the market sell (Kite will reject it).
4. MARKET SELL tagged `PALAGAI_CHART_EXIT`.
5. Never rest a LIMIT target beside the SL.

Also rest a missing 25% `PALAGAI_CHART_SL` (SL-LIMIT, limit 10% under trigger). 15s grace after SL.

Entry path:

1. First ingest of a book is history — do not chase signals already on the chart.
2. `decideProtectAuto` must allow (window, HTF, one NSE slot, no open fill).
3. `store.markPlaced` **before** `placeOrder`. `unmarkPlaced` if Kite refuses.
4. Lots from `fetchUserMargins` equity cash, ₹40k / index lot, Crude 3×.
5. MARKET BUY tagged `PALAGAI_CHART`, then SL only.

`publicView.dropletPlacing` is true only when Protect is on **and** the Kite session is live. The Charts tab skips `fireAuto` in that case so two brains cannot double-buy.

Rebuild the SMC bundle (palagai checkout must sit at `../palagai`):

```
node charts-protect/from-charts/build.js
node --test charts-protect/protect.test.js
```

Kite token: `PUT /momentum/broker/auth`. Worker uses `momentum.sessions.authorization(userId)`.

Restart on droplet only when the owner asks: `git pull && pm2 restart trading-backend`. Logs: `[charts-protect] placing and watching PALAGAI_CHART`.

## Pending (next agent)

Owner merge + droplet restart. Do not merge or restart unless they ask. After it is live, watch the first session: GET `/api/momentum/charts-protect` should show `dropletPlacing: true` and a recent `lastTick`. If palagai SMC TypeScript changes, rebuild `bundle.js`.
