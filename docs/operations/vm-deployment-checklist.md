# VM Deployment Checklist

Plain-language, step-by-step. Written for a single Linux VM (Ubuntu/RHEL) serving one
site. Follow it in order — each step is verifiable before you move on.

> **Installing for a company?** Each company needs its own server and database. Start with
> [new-company-installation.md](new-company-installation.md).

> **Why this exists:** the API server serves only `/api` — it has no static-file
> handling at all. Something in front has to serve the built web interface and
> forward `/api` to the backend, and on a plain VM that something is yours to set up
> (step 6). Everything else here is configuration.

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
| `HOST` | `127.0.0.1` | The API listens on every network interface, so anyone who can reach port 8080 skips nginx: no TLS, and a forged `X-Forwarded-For` is believed |
| `AUTH_PUBLIC_URL` | `https://iot.yourcompany.com` | Password-reset emails link to `localhost` |
| `CORS_ORIGINS` | `https://iot.yourcompany.com` | Browser calls rejected |
| `AUTH_EMAIL_TRANSPORT` | `smtp` | **Server refuses to start** (see below) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | your mail server | Invitations and resets never arrive |
| `AUTH_EMAIL_FROM` | `Integrated Suite <no-reply@yourcompany.com>` | Uses a `localhost` sender |
| `SECRETS_ENC_KEY` | 32 random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | **Server refuses to start.** It encrypts broker passwords, destination tokens and ingest URLs. Keep a copy outside the server (see [backup-restore.md](backup-restore.md)); without it a restored database cannot decrypt them. |

**About `AUTH_EMAIL_TRANSPORT`:** in production the app deliberately refuses to boot
with the default (`console`), because that would print account-activation links into
the server log instead of emailing them. Set it to `smtp` and fill in the SMTP values.
If you genuinely want to defer email, set `AUTH_EMAIL_ALLOW_CONSOLE=true` — but then
you must read activation links out of the log yourself.

**If you are not using HTTPS yet**, also set `AUTH_COOKIE_SECURE=false`, otherwise
nobody can log in: the browser will refuse to send the session cookie over plain HTTP.
Change it back to `true` once TLS is in place.

## Step 3 — Set up the database

Choose one:

- **Moving an existing system:** follow the restore steps in
  [backup-restore.md](backup-restore.md#4-restore). Restore into an empty database
  first, then run `push`. Your assets, templates, dashboards **and API keys** come
  across, so your gateway keeps working with the key it already has. Bring the same
  `SECRETS_ENC_KEY`, or stored broker and destination credentials cannot be decrypted.
- **Starting fresh:** create the tables, then create the first administrator:
  ```bash
  # Creates/updates all tables. Back up first on a live system (backup-restore.md).
  pnpm --filter @workspace/db run push
  ```
  Then create the first owner account as described in
  [new-company-installation.md](new-company-installation.md). Do not run `seed` on a
  production server: it creates demo assets, demo users and a demo API key. Create
  your own API key in the app (Admin Center → API Clients).

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
# Logs go to the journal (stdout). The identifier lets rsyslog filters match.
SyslogIdentifier=nexus-api

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

### Logs: journald

The API writes JSON lines to stdout and never opens a log file. The unit above leaves
stdout to systemd, so the journal is the only log store. Do not add
`StandardOutput=append:...` or a logrotate rule; one destination keeps the
permissions and retention below in one place.

The log contains stack traces, user ids, usernames and client IPs, so treat it like a
credential store:

1. **Who can read it.** Root and members of the `systemd-journal` group, and on
   Debian/Ubuntu also the `adm` group. Keep both to the people who operate the server:
   ```bash
   getent group systemd-journal adm
   ```
2. **The syslog copy (Ubuntu).** rsyslog copies the journal into `/var/log/syslog`,
   readable by `adm`. Keep `adm` equally tight, or stop the copy for this service:
   ```bash
   echo ':programname, isequal, "nexus-api" stop' | sudo tee /etc/rsyslog.d/10-nexus.conf
   sudo systemctl restart rsyslog
   ```
3. **How long it is kept.** journald retention applies to the whole machine. Keep the
   journal on disk and cap it, for example 30 days or 2 GB, whichever comes first:
   ```bash
   sudo mkdir -p /etc/systemd/journald.conf.d
   printf '[Journal]\nStorage=persistent\nSystemMaxUse=2G\nMaxRetentionSec=30day\n' \
     | sudo tee /etc/systemd/journald.conf.d/retention.conf
   sudo systemctl restart systemd-journald
   ```

Useful commands: `journalctl -u nexus-api -f` (follow), `journalctl -u nexus-api
--since "1 hour ago" -p err` (recent errors), `journalctl --disk-usage`.

## Step 6 — Put a web server in front

This is the piece that serves the SPA and routes `/api`. Example nginx site:

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
> `$proxy_add_x_forwarded_for`.** The API decides who the caller is (for rate limits,
> the security log and API-key IP allowlists) from that header, trusting `TRUST_PROXY`
> hops of it. The common `$proxy_add_...` form *appends* to whatever the caller sent,
> so a forged value can end up in the position the API trusts. Overwriting closes that.

> ⚠️ **Set `HOST=127.0.0.1`** when nginx runs on the same machine. Without it the API
> also answers on port 8080 from the network, where a caller talks to it directly and
> chooses its own `X-Forwarded-For`. With it, port 8080 is reachable only through nginx.
> Leaving `HOST` unset keeps the old behaviour (all interfaces); use that only if nginx
> runs on a different machine, and then firewall port 8080 to that machine alone.
>
> Check: `ss -ltnp | grep 8080` should show `127.0.0.1:8080`, not `0.0.0.0:8080` or `*:8080`.

> **API-key IP allowlists** take exact addresses (`203.0.113.7`) or CIDR blocks
> (`203.0.113.0/24`, `2001:db8::/32`). Entries are checked when saved. An entry saved
> before November 2026 in the old prefix style (`10.0.0.`) no longer matches anything,
> so a client whose list holds only such entries is refused until the list is corrected.

> ⚠️ **Run only one copy of the backend.** No PM2 cluster mode, no replicas. Several
> things live in the process's own memory: all rate-limit counters (sign-in, API,
> API-key), the MQTT broker connections, alarm On/Off delay timers, the seen-devices
> cache, live-update fan-out to browsers, and the hourly retention job. With two copies
> you would get double the effective rate limits, two MQTT connections with the same
> client id knocking each other off the broker in a reconnect loop, live updates
> reaching only half your browsers,
> and the retention job running twice.
>
> A restart clears that memory. Rate-limit counters start from zero, a running alarm
> On/Off delay starts again (an alarm can fire up to one delay period late), MQTT
> connections reopen, and browsers reconnect their live feed. Sessions, lockouts, alarms and data are in PostgreSQL and survive. See
> [technical-reference.md](../technical-reference.md#process-local-state-single-process-requirement).

**Keys in URLs.** Gateways should send the key in a header (`X-API-Key: <secret>` or
`Authorization: Bearer <secret>`). A key in the query string (`?key=`, `?apiKey=` or
`?api_key=`) is **ignored** unless you set `API_KEY_ALLOW_QUERY_PARAM=true`: the
request then gets `401` and the server logs a warning at most once a minute. Turn it on
only for devices that can set a URL but no header. The API's own log masks secrets in
URLs, but nginx's access log records the full request line. If you enable the query
form, or use the copy-and-paste ingest URLs (`/api/ingest/e/<token>/...`, where the
token is the credential), stop nginx logging those URLs:

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
   curl http://127.0.0.1:8080/api/readyz      # expect {"status":"ok","database":"ok"}
   ```
   Neither needs a login. Point monitoring at `/api/readyz`: it returns 503 when the
   database is unreachable, while `/api/healthz` only shows the process is running.
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
| Gateway gets `429` | Over 1200 requests/minute on that key (`INGEST_RATE_LIMIT_RPM`) — batch readings, use a second key, or raise the limit |
| Data posts fine but no chart | Tag not declared on the asset — undeclared tags are **dropped**. Post the same payload to `/api/ingest/validate` to see which tags are dropped |
| Password-reset links point at localhost | `AUTH_PUBLIC_URL` not set |
| Sign-in fails with `origin_not_allowed` | The browser's address is not in `AUTH_PUBLIC_URL`/`CORS_ORIGINS` and nginx is not passing the original `Host` (`proxy_set_header Host $host;`) |

---

## After it is live

- Set up nightly encrypted backups of the database **and** the uploads folder, and keep
  `SECRETS_ENC_KEY` safe and separate: see [backup-restore.md](backup-restore.md).
  The database alone is not enough to restore.
- Watch `journalctl -u nexus-api` for restarts.
- Keep an eye on the request counts in Broker Management; they are your simplest
  "is data still flowing" indicator.

## Security response headers for the SPA (nginx)

The API sets its own security headers on every `/api` response. The **app shell**
— the HTML, JS and CSS nginx serves — sets none, because nothing in this
repository serves them. That is the one place a Content-Security-Policy has to
live, and without it the application has no defence-in-depth against injected
script beyond React's own escaping.

Add to the `server` block that serves the SPA:

```nginx
# Content-Security-Policy is the important one. The production bundle contains
# ZERO inline <script> tags (verified against the built index.html), so the
# strict form works — no 'unsafe-inline' for scripts is required.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;

add_header X-Content-Type-Options    "nosniff" always;
add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
add_header Permissions-Policy        "geolocation=(), microphone=(), camera=()" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# `frame-ancestors 'none'` in the CSP supersedes X-Frame-Options in modern
# browsers; keep both only if you must support very old ones.
add_header X-Frame-Options "DENY" always;
```

**This needs one pass with the browser console open before you rely on it.** A
CSP that breaks the UI is worse than none, because it gets removed wholesale
instead of adjusted. Two directives are the likely candidates:

- **`style-src 'unsafe-inline'`** is present deliberately. React and Recharts set
  inline `style` attributes for layout, so removing it breaks rendering. This is
  the standard compromise and is far less dangerous than the script equivalent.
- **`img-src`** allows `self`, `data:` and `blob:` only. The Media Library also
  accepts *external* image URLs — if you use that feature, those images will be
  blocked until you either widen this to `img-src *` (weakens it meaningfully,
  since it re-enables tracking-pixel style exfiltration) or proxy external media
  through the API. Prefer the proxy.
- **`connect-src 'self'`** must cover the WebSocket at `/api/ws`. It does when
  the socket is same-origin, which it is in this deployment. If you ever move the
  API to a different host, this needs that origin added explicitly.

Verify with:

```bash
curl -sI https://your-host/ | grep -i "content-security-policy\|x-content-type"
```

### Database connection is not encrypted

`DATABASE_URL` has no `sslmode`, so the connection to PostgreSQL is plaintext.
That is acceptable **only** while the database is on the same host over the
loopback interface, which is the reference deployment. The moment Postgres moves
to another machine — a managed service, a separate VM, a container on another
node — that connection carries credentials and every row in cleartext across the
network.

Before moving the database off-host:

```
DATABASE_URL=postgresql://user:pass@db-host:5432/integrated_suite?sslmode=verify-full&sslrootcert=/etc/ssl/certs/db-ca.pem
```

`verify-full` rather than `require`: `require` encrypts but does not verify the
server's identity, so it stops passive sniffing and not an active
man-in-the-middle — which is the threat that matters once the traffic leaves the
host.
