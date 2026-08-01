# Auth · Admin · Vault

## Site login (Mongo `users`)
- Owner seed: **Devil** / (same password as before) — created on boot if missing
- Friends: created in Admin; bcrypt hashes only
- Blocked → login returns **Contact admin**

## Admin (separate)
- URL: `/admin/login`
- Username **Admin** / password in `auth/credentials.js` (not Mongo)
- Create users, modules (`trade` `crude` `auto` `token`), block, Kite API key

## Modules
| Module | Who |
|---|---|
| trade, crude, auto, token | Friends (as granted) + owner |
| strat, pnl, vault | Owner only |

VAULT unlock password: **Krishnan1789@9871** (constant in `credentials.js`, not Mongo).

After changing the vault password, unlock once and click **Seed defaults** so Devil / angel / IP keys are written with the new encryption key.

## Multi-user Auto Trader
- Each site user has own `/live` session + encrypted kite auth
- Requires module `auto` + site Bearer JWT
