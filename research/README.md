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

The Research tab **Start today** button sends the browser’s saved Kite session (`X-Kite-Authorization` from Get Token). The server uses it for prices only, carries each strategy’s previous close into the new session, and keeps recording after the browser closes.

`POST /research/start` with `{ "confirm": "START PAPER EXPERIMENT" }` remains available. It still refuses a live-order mode.

Each strategy account keeps its ending equity. A loss stays in that account. A gain stays in that account. The next day does not restore ₹20,000. The Excel workbook has Trades, Capital, Names, and Notes sheets.

There is no live-order switch in this module.
