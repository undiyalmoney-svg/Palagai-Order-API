# Paper module — exhaustion-fade-v1

RESEARCH / PAPER ONLY. Generates and scores signals. No broker imports; cannot
place, modify, or cancel any order. Verified read-only against broker state.

## Files
- `../strategy/exhaustion-fade-v1.js` — frozen strategy (pure signal generator)
- `backtest-through-module.js` — integration test (must PASS: ALL +58,946, t2.89)
- `paper-tracker.js` — daily TRADE/NO-TRADE logger + scorer
- `ledger.ndjson` — append-only signal log (created on first `signal` run)

## Daily use
Run once after the close each trading day (or intraday from ~15:15):
```
node research/paper/paper-tracker.js signal <YYYY-MM-DD> research-data/midintra
```
Prints TRADE (symbol, side, entry, stop, exit) or NO TRADE, appends to ledger.

## Score the paper record so far
```
node research/paper/paper-tracker.js score research-data/midintra
```

## Verify the module still matches the backtest
```
node research/paper/backtest-through-module.js
```

## Honest status
Edge is real but modest and was found by search. TEST (out-of-sample) t=1.66,
pooled t=2.89, 67% of random 57-day windows profitable, worst day ~-Rs2,200,
~1 trade/week. Assumes 0.05%/side slippage (real mid-cap spreads unmeasured).
PAPER-PROVE for 2-3 months before any real capital. Do not skip this step.
