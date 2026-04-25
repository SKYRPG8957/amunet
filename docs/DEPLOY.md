# Cloud Deploy

The production server is a single Node process:

- serves the built React app from `dist`
- serves all `/api/*` routes
- prewarms the unified world feed in memory
- optionally opens `19132/udp` for the Bedrock transfer bridge

## Recommended Server

Use a normal Linux VM/VPS for the real service. The app needs long-running Node,
fast outbound HTTP to Xbox/Eggnet, and optional UDP `19132`.

Good starting point:

- Oracle Cloud Always Free Ampere VM, if you can get capacity
- Any cheap Seoul/Tokyo/Singapore VPS with 1-2 vCPU and 1 GB+ RAM

Avoid relying on sleep-based free web hosts for production. They make the first
user wait while the service wakes up, and most do not handle Bedrock UDP well.

## VPS Setup

On Ubuntu 24.04:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

Clone and configure:

```bash
git clone https://github.com/YOUR_ACCOUNT/amunet.git
cd amunet
cp .env.example .env
```

Edit `.env`:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
AMUNET_SERVE_STATIC=1
AMUNET_PREWARM=1
AMUNET_PROVIDER_EGGNET=1
AMUNET_PROVIDER_XBOX=0
AMUNET_PREWARM_XBOX=0
AMUNET_ADMIN_REFRESH_KEY=change-this-to-a-long-random-secret
AMUNET_BRIDGE_PORT=19132
```

Open firewall ports:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 19132/udp
sudo ufw --force enable
```

Run:

```bash
docker compose up -d --build
docker compose logs -f amunet
```

Smoke test:

```bash
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/worlds/live
```

## Domain + HTTPS

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, set your domain, then:

```bash
sudo systemctl reload caddy
```

## What Moves Off Your PC

Cloud server:

- web app
- Eggnet-compatible public feed cache
- Luma Xbox SessionDirectory provider, only when explicitly enabled and accessed with the operator key
- join URI generation
- Supabase-backed app data
- optional public UDP transfer bridge

Still local to the user:

- Minecraft Bedrock itself
- `minecraft://activityHandleJoin` handling by the user's OS/app
- true LAN discovery, because LAN broadcast only exists on the user's local network

That last point is a protocol boundary, not an app bug. A remote VPS can make the
website and feed fast, but it cannot magically broadcast as a LAN world inside a
user's home Wi-Fi. For "Friends" style joining at cloud scale, use activity
handles and deep links; keep the LAN bridge as an optional desktop/mobile helper.

Do not expose the Node helper without `AMUNET_ADMIN_REFRESH_KEY`. The bridge,
Bedrock UDP ping, Xbox login, Xbox friend/world queries, and forced feed refresh
routes are operator-only outside localhost.
