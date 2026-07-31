# VM Deployment Checklist

Plain-language, step-by-step. Written for a single Linux VM (Ubuntu/RHEL) serving one
site. Follow it in order — each step is verifiable before you move on.

> **Why this exists:** the app currently runs on Replit, where Replit's own router
> serves the web interface and forwards `/api` to the backend. On a plain VM that
> router does not exist, so you provide it (step 6). Everything else is configuration.

---

## What you need before starting

- A VM with **Node.js 22.12+ or 24** (22.10 is too old — Vite refuses to build)
- **PostgreSQL 16** (on the VM or a managed instance you can reach)
- **pnpm** (`npm install -g pnpm`)
- A DNS name pointing at the VM, e.g. `iot.yourcompany.com`
- A TLS certificate for that name (Let's Encrypt, or your corporate CA)

Optional but recommended: a second name for testing, e.g. `iot-uat.yourcompany.com`,
so a test gateway can never accidentally post into production.

---

## Step 1 — Get the code and install

```bash
git clone <your repo> /opt/nexus-iot
cd /opt/nexus-iot
pnpm install
```

## Step 2 — Create the settings file

Create `/opt/nexus-iot/.env`. These are the values that **must** be set:

| Setting | Value | What happens if you skip it |
|---|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/dbname` | Server refuses to start |
| `NODE_ENV` | `production` | Login breaks behind a web server; visitor IPs all show as the proxy |
| `PORT` | `8080` | Defaults to 8080 anyway |
| `AUTH_PUBLIC_URL` | `https://iot.yourcompany.com` | Password-reset emails link to `localhost` |
| `CORS_ORIGINS` | `https://iot.yourcompany.com` | Browser calls rejected |
| `AUTH_EMAIL_TRANSPORT` | `smtp` | **Server refuses to start** (see below) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | your mail server | Invitations and resets never arrive |
| `AUTH_EMAIL_FROM` | `Integrated Suite <no-reply@yourcompany.com>` | Uses a `localhost` sender |

**About `AUTH_EMAIL_TRANSPORT`:** in production the app deliberately refuses to boot
with the default (`console`), because that would print account-activation links into
the server log instead of emailing them. Set it to `smtp` and fill in the SMTP values.
If you genuinely want to defer email, set `AUTH_EMAIL_ALLOW_CONSOLE=true` — but then
you must read activation links out of the log yourself.

**If you are not using HTTPS yet**, also set `AUTH_COOKIE_SECURE=false`, otherwise
nobody can log in: the browser will refuse to send the session cookie over plain HTTP.
Change it back to `true` once TLS is in place.

## Step 3 — Set up the database

```bash
# Creates/updates all tables. Safe to re-run.
pnpm --filter @workspace/db run push
```

Then either:

- **Moving an existing system:** restore your current database with `pg_dump`/`psql`.
  Your assets, templates, dashboards **and API keys** come across, so your gateway
  keeps working with the key it already has.
- **Starting fresh:** run `pnpm --filter @workspace/db run seed` to create the initial
  users, then create your own API key in the app (Admin Center → API Clients).

> Never run `push-force` on this database — it is destructive.

## Step 4 — Build

```bash
pnpm run build
```

This produces two things:
- the backend at `artifacts/api-server/dist/index.mjs`
- the web interface at `artifacts/iot-platform/dist/public/`

## Step 5 — Run the backend as a service

Create `/etc/systemd/system/nexus-api.service`:

```ini
[Unit]
Description=Nexus IoT API
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/nexus-iot/artifacts/api-server
EnvironmentFile=/opt/nexus-iot/.env
ExecStart=/usr/bin/node --enable-source-maps ./dist/index.mjs
Restart=always
RestartSec=5
User=nexus

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now nexus-api
sudo systemctl status nexus-api      # should say active (running)
journalctl -u nexus-api -f           # watch the log
```

Two things matter here:

- **`EnvironmentFile`** — set the values as real environment variables. Do not rely on
  the app finding `.env` on its own; it looks for it at a fixed relative path
  (`../../.env` from the working directory) and will fail confusingly if that is wrong.
- **`Restart=always`** — a crash otherwise takes ingestion down until someone notices.

## Step 6 — Put a web server in front

This is the piece that replaces Replit's router. Example nginx site:

```nginx
server {
    listen 443 ssl;
    server_name iot.yourcompany.com;

    ssl_certificate     /etc/ssl/certs/yourcompany.crt;
    ssl_certificate_key /etc/ssl/private/yourcompany.key;

    # The web interface (built files from step 4)
    root /opt/nexus-iot/artifacts/iot-platform/dist/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # SPA fallback
    }

    # The API and ingest endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;

        # IMPORTANT: overwrite, do not append. See the warning below.
        proxy_set_header X-Forwarded-For   $remote_addr;

        # Required for the live-data WebSocket at /api/ws
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {                       # redirect plain HTTP
    listen 80;
    server_name iot.yourcompany.com;
    return 301 https://$host$request_uri;
}
```

> ⚠️ **Use `X-Forwarded-For $remote_addr`, not the usual
> `$proxy_add_x_forwarded_for`.** The API-key IP allowlist reads the *first* value of
> that header to decide whether to accept a request. The common `$proxy_add_...` form
> *appends* to whatever the caller sent, leaving a caller-supplied value first — which
> would let someone spoof their way past an IP allowlist. Overwriting closes that.

> ⚠️ **Run only one copy of the backend.** No PM2 cluster mode, no replicas. Four
> things are held in the process's own memory: API-key rate-limit counters, the
> seen-devices list, live-update fan-out to browsers, and the hourly data-retention
> job. With two copies you would get double the effective rate limit, live updates
> reaching only half your browsers, and the retention job running twice.

If you keep using the `?key=` URL form, also stop nginx logging the key:

```nginx
location /api/ingest/ {
    access_log off;              # the URL contains the secret
    # ...same proxy_ lines as above...
}
```

## Step 7 — Point your gateway at the new address

In your Node-RED HTTP request node, change **only the URL**. The part after the host
does not change:

```
Before   http://localhost:5173/api/ingest/payload
After    https://iot.yourcompany.com/api/ingest/payload
```

The method, headers, key and payload all stay exactly as they are.

The easiest way to get the right URL: open **Broker Management** on the deployed site.
The page builds the addresses from whatever site you are viewing, so it will show the
correct ones to copy.

**If your certificate is self-signed**, Node-RED will refuse to connect. Either install
a proper certificate, or untick **"Verify server certificate"** in the request node.
This is the most common first-post failure after a move.

## Step 8 — Verify, in this order

1. **Backend is up** — from the VM:
   ```bash
   curl http://127.0.0.1:8080/api/healthz     # expect {"status":"ok"}
   ```
   This endpoint needs no login, so it also works as your monitoring check.
2. **Site loads** — open `https://iot.yourcompany.com` and log in.
3. **Live badge** — the dashboard header should read **Live** (green). If it says
   *Reconnecting*, the WebSocket lines in step 6 are wrong.
4. **One test reading** — post a single payload:
   ```bash
   curl -X POST https://iot.yourcompany.com/api/ingest/payload \
     -H "X-API-Key: <your client secret>" \
     -H "Content-Type: application/json" \
     -d '{"deviceId":"energy","chiller":{"energy_kWh":18.4}}'
   ```
   Expect `200`. A `401` means the key is wrong, `403` means scope or IP allowlist,
   `429` means the rate limit.
5. **It was attributed** — Broker Management should show the request count for your key
   increase, and "last used" become *less than a minute ago*.
6. **It reached a chart** — open your dashboard; the widget should show the new point.
7. **Turn the gateway back on** and watch the count climb.

---

## Things that will bite you

| Symptom | Cause |
|---|---|
| Server won't start, mentions email | `AUTH_EMAIL_TRANSPORT` still `console` in production |
| Server won't start, mentions `DATABASE_URL` | Wrong `WorkingDirectory`, or value not in `EnvironmentFile` |
| Login page accepts the password then returns to login | `AUTH_COOKIE_SECURE=true` without HTTPS |
| Dashboard says "Reconnecting" forever | Missing `Upgrade`/`Connection` headers for `/api/ws` |
| Gateway gets `401` | Key not sent, or wrong key for that endpoint |
| Gateway gets `403 client_mismatch` | Posting to another client's `/k/<id>/` endpoint |
| Gateway gets `429` | Over 120 requests/minute on that key — batch, or use a second key |
| Data posts fine but no chart | Tag not declared on the asset — undeclared tags are **dropped**. Use the Payload Simulator's validate step to see which |
| Password-reset links point at localhost | `AUTH_PUBLIC_URL` not set |

---

## After it is live

- Take a `pg_dump` on a schedule — all your configuration and history is in Postgres.
- Watch `journalctl -u nexus-api` for restarts.
- Keep an eye on the request counts in Broker Management; they are your simplest
  "is data still flowing" indicator.
