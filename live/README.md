# Server Live — strategy worker (additive)

Runs on the Order-API droplet. **Does not change** `/api/kite/*` handlers.

## DNA — S/R Daily Band (`appBuild: 2026.08.12-sr-band-750-2000`)

**Entry = Support / Resistance Trap** (droplet hunt winner):

1. Swing lookback **5** → local S/R (high = resistance, low = support)  
2. **Pierce** beyond level (Nifty 20 / Bank 60) + **close reclaim** + EMA side  
3. **Next-bar confirm** · mode **both** (trap + bounce at swing)  
4. OR-confluence **OFF** (hunt: it pulled Aug 10/11 out of the ₹750–2000 band)  

**Desk loop → ₹750–₹2000 @ 1 lot:**

5. Nifty → Bank only after Nifty day is green  
6. Band lock **₹750** / hard **₹2000** / stop **−₹2950** · no dig after green  
7. Crude after 15:15 only if still &lt; ₹750 · one-leg · stand-down ₹350  

### Hunt proof (live-path option marks)
| Config | Result |
|---|---|
| **BOTH pierce20/B60 swing5** | 10 Aug **+₹1,251** · 11 Aug **+₹1,149** (2/2 in band) |
| Trap-only | **0** live-path days |
| BOTH + OR40 confluence | +₹435 / +₹728 (below band) |

### Ops
- `POST /live/start` · After deploy: **Stop → Start**  
- Offline: `node scripts/test-daily-band-loop.js`  
- Droplet hunt: `node scripts/sr-band-hunt.js`
