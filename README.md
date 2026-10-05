# Palagai Order API

Fixed-IP Express backend for **Kite order APIs only**.  
DigitalOcean Droplet egress IP must be whitelisted in Zerodha Kite Connect.

Quotes, historical candles, instruments, and session token exchange stay on the Angular / Vercel app.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| POST | `/api/kite/orders/:variety` | Place order |
| PUT | `/api/kite/orders/:variety/:orderId` | Modify order |
| DELETE | `/api/kite/orders/:variety/:orderId` | Cancel order |
| GET | `/api/kite/orders` | Day order book |
| GET | `/api/kite/orders/:orderId` | Order history |
| GET | `/api/kite/orders/:orderId/trades` | Order trades |
| GET | `/api/kite/trades` | Day trades |
| GET | `/api/kite/portfolio/positions` | Positions |

Auth: send the same header as Kite Connect:

```http
Authorization: token {api_key}:{access_token}
X-Kite-Version: 3
```

## Momentum Portfolio Manager (`/momentum`)

All trading logic for the Palagai Momentum Portfolio Manager lives here; the Angular app only renders decisions and sends explicit user actions. Code is in `momentum/`.

```
market data -> indicators -> regime -> scan -> rank -> entry/exit timing -> portfolio analysis
  -> capital allocation -> risk check -> BUY/HOLD/SELL/EXIT -> order validation
  -> paper or broker execution -> confirmation -> portfolio update -> history -> performance
```

- Default weekly book is **Dual Momentum 12-1, 2–3 names**: rank NSE large/mid **plus Gold BeES, Silver BeES and Nifty BeES**. Sit in cash when Nifty’s own trend is broken. On the live NSE tape this is the sleeve that prints the ~15% months (e.g. concentrated 12-1 paydays). Classic 5-name is still in Settings if you want a smoother book. Paper: this week’s tickets plus last week / last 12 months / last calendar year / custom dates, with start → end capital on top. Live is Get Token → we read Kite cash → Buy/Hold/Sell cards.
- Holding period is a strategy parameter (review cadence). A position is never sold because of its age; exits come from the stop, trailing stop, thesis failure (trend / momentum / RS / volume / regime / sector / rank) or a clearly better replacement net of costs.
- Persistence: SQLite (`better-sqlite3`), 23 tables including stocks, prices, quotes, indicators, strategies, strategy runs, backtests, backtest trades, portfolios, positions, signals, orders, trades, capital events, risk settings and market regimes. Every decision run is stored with its full explanation. Mongo is still used for users and the vault.
- Execution: Signal mode (default), Paper trading, and Live/automated execution which needs a Kite session, the phrase `ENABLE LIVE TRADING` and (for automation) `ENABLE AUTOMATED EXECUTION`. Enabling live trading imports CNC holdings that are in the momentum universe (other names are skipped). Orders are idempotent (`pf<portfolio>:<decisionKey>` is unique), pass a validation pipeline, and the portfolio only changes from fill quantities reported by the broker — except this one-time holdings seed. Ambiguous submissions are resolved by tag lookup, never by re-sending.
- Jobs: daily (data, indicators, regime, decisions, order reconcile), weekly (full review), monthly (performance/risk/strategy validation). `job_runs` deduplicates by period.
- AI: the narrator explains stored, deterministic decisions only and cannot create trades.
- Data: `MOMENTUM_PROVIDER=synthetic` (default) uses a clearly labelled deterministic simulator so the app runs without credentials; `kite` uses Kite historical candles/quotes via the session of `MOMENTUM_DATA_USER`.

Environment (all optional): `MOMENTUM_PROVIDER`, `MOMENTUM_DATA_USER`, `MOMENTUM_DB_PATH` (default `data/momentum/momentum.sqlite`), `MOMENTUM_SECRET` (encrypts stored Kite sessions; falls back to the JWT secret), `MOMENTUM_SCHEDULER=0` to disable the in-process scheduler.

Tests: `npm test` (engine, orders, jobs, research and API suites).

## Local install

```bash
cp .env.example .env
npm install
npm run dev
```

Health check: `curl http://127.0.0.1:3000/health`

## DigitalOcean Ubuntu deployment

### 1. SSH into droplet

```bash
ssh root@168.144.28.89
```

### 2. Install Node.js 20, git, nginx (optional)

```bash
apt update
apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v
```

### 3. Clone this repo

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/undiyalmoney-svg/Palagai-Order-API.git
cd Palagai-Order-API
cp .env.example .env
npm install --omit=dev
```

### 4. Firewall (DigitalOcean + ufw)

Allow inbound **3000** (or 80/443 if using Nginx):

```bash
ufw allow OpenSSH
ufw allow 3000/tcp
ufw enable
ufw status
```

Also open port **3000** in the DigitalOcean Cloud Firewall if one is attached.

### 5. PM2

```bash
npm install -g pm2
pm2 start server.js --name trading-backend
pm2 save
pm2 startup
# run the command pm2 prints
```

Useful:

```bash
pm2 logs trading-backend
pm2 restart trading-backend
```

### 6. Whitelist IP in Zerodha

Kite Connect app → **IP whitelist** → add:

```text
168.144.28.89
```

### 7. Test from your laptop

```bash
curl http://168.144.28.89:3000/health
```

Expect: `{"status":"ok","service":"palagai-order-api"}`

## Nginx (optional, later + domain)

```nginx
server {
  listen 80;
  server_name api.palagai.app;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/palagai-order-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## SSL (when you have a domain)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.palagai.app
```

> **Note:** `https://palagai.app` cannot call plain `http://IP:3000` (browser mixed-content block).  
> Palagai frontend uses a same-origin `/api/order-kite` proxy to this droplet so production HTTPS works. Localhost can call the droplet IP directly.

## Environment

See `.env.example`.

## Git

```bash
git init
git add .
git commit -m "Initial Palagai Order API"
# create empty repo Palagai-Order-API on GitHub, then:
git remote add origin https://github.com/undiyalmoney-svg/Palagai-Order-API.git
git branch -M main
git push -u origin main
```
