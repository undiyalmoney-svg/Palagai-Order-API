# Auth · Admin · Vault

## Site login (Mongo `users`)
- Owner seed: **Devil** / (same password as before) — created on boot if missing
- Friends: created in Admin; bcrypt hashes only
- Blocked → login returns **Contact admin**

## Admin (separate)
- URL: `/admin/login`
- Username **angel** (constant in `auth/credentials.js`, not Mongo)
- Create users, modules (`trade` `crude` `auto` `token`), block, Kite API key

## Modules
| Module | Who |
|---|---|
| trade, crude, auto, token | Friends (as granted) + owner |
| strat, pnl, vault | Owner only |

## Vault
- Unlock password constant: `VAULT_PASSWORD` in `auth/credentials.js` (not in Mongo)
- Encrypted rows in Mongo `vault_secrets`
- UI: `/dashboard/vault` (owner)

## Multi-user Auto Trader
- Each site user has own `/live` session + encrypted kite auth
- Requires module `auto` + site Bearer JWT
