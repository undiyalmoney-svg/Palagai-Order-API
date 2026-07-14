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
