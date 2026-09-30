# Auth · Admin · Vault

## Site login (Mongo `users`)
- Owner seed: **Devil** / (same password as before) — created on boot if missing
- Friends: created in Admin; bcrypt hashes only
- Blocked → login returns **Contact admin**

## Admin (separate)
- URL: `/admin/login`
- Admin portal: `/admin/login` — **Admin** / (see `credentials.js`) — create friends, modules, block
- Site login: `/login` — Mongo users only (owner **Devil** + friends Admin creates; bcrypt check)
- Create users, modules (`trade` `crude` `auto` `momentum` `token`), block, Kite API key

## Modules
| Module | Who |
|---|---|
| trade, crude, auto, momentum, token | Friends (as granted) + owner |
| strat, pnl, vault | Owner only |

VAULT unlock password: **Krishnan1789@9871** (constant in `credentials.js`, not Mongo).

After changing the vault password, unlock once and click **Seed defaults** so Devil / angel / IP keys are written with the new encryption key.

## Momentum Portfolio Manager
- Requires module `momentum` + site Bearer JWT (owner always allowed)
- All data is per site user (portfolio, orders, decisions, settings)
- Users who had the retired Trade Bot (`auto`) are granted `momentum` once on boot
