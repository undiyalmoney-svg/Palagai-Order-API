# Server Live (additive) — does NOT change /api/kite order endpoints.

## What this folder is
Control plane for Auto Trader (start/stop/status/auth/heartbeat scaffold).

## What this folder is NOT
- Not a replacement for `controllers/kiteOrders.controller.js`
- Not a change to `services/kite.service.js`
- Not a change to existing Order Test / Trade Desk Local Live flows

## Endpoints (new)
- GET  /live/health
- GET  /live/status
- GET  /live/events
- POST /live/start
- POST /live/stop
- PUT  /live/auth

## Fixed DNA (Phase 1)
- Nifty = Trap
- Crude = All-Green
- Bank = Trap | Genie (selectable)

## Safety
Strategy order placement is NOT wired in this scaffold yet.
Heartbeat-only until strategy port is explicitly approved.
