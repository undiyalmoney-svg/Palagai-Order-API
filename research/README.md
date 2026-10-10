# Intraday research (paper only)

This module scans the app's Nifty 50-style universe, runs five independent strategy accounts, and simulates entries and exits. It never calls a real-order API.

## Environment

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Existing Mongo connection. Without it the module keeps state in memory and says so. |
| `MONGODB_DB` | Database name, default `palagai`. |
| `KITE_API_KEY` | Existing Kite Connect key. Required before the experiment can start. |
| `KITE_ACCESS_TOKEN` | Existing Kite access token. Never put this in the chat or the repo. |
| `RESEARCH_WORKER` | `1` (default) runs an idle supervisor inside `node server.js`. `0` disables it. The supervisor does not trade until an operator starts the experiment. |

## Start

```bash
npm start
```

The website Research tab calls `POST /research/start` with `{ "confirm": "START PAPER EXPERIMENT" }` after readiness passes. Readiness requires Mongo or an explicit in-memory warning, five strategies, the universe, risk settings, Kite credentials, and instrument tokens.

There is no live-order switch in this module.
