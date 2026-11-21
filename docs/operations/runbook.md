# Operations Runbook

**Applies to:** the self-hosted Linux VM described in
[vm-deployment-checklist.md](vm-deployment-checklist.md), which is the source of truth for
installation. The API runs as the systemd service `nexus-api` from `/opt/nexus-iot`,
nginx serves the web interface and proxies `/api`, and logs go to the journal.

> **History.** Earlier versions of this runbook described a Replit-hosted preview
> (workflows, the Deploy button, the Secrets panel, checkpoint restore). None of that
> applies to the VM, and those steps have been removed.

Commands below run on the VM unless stated otherwise. Endpoints other than `/api/healthz`
and `/api/readyz` need a signed-in session or an API key, so use the UI for them, or a
`curl` with a key that has the right scope.

---

## Deployment

### First installation
Follow [vm-deployment-checklist.md](vm-deployment-checklist.md) step by step. For a new
company, also follow [new-company-installation.md](new-company-installation.md): every
company gets its own installation and database.

### Upgrading to a new version
1. Back up the database and the uploads folder ([backup-restore.md](backup-restore.md)).
2. Get the code and install dependencies:
   ```bash
   cd /opt/nexus-iot
   git fetch && git checkout <release tag or commit>
   pnpm install
   ```
3. Apply schema changes with the schema-owner role, not the runtime role (see the
   "Least privilege" block in `.env.example`):
   ```bash
   DATABASE_URL='postgresql://app_owner:<pw>@localhost:5432/<db>' \
     pnpm --filter @workspace/db run push
   ```
   Never run `push-force` on a live database. If the installation has adopted reviewed
   migrations, run `migrate` instead ([database-migrations.md](database-migrations.md)).
4. Build and restart:
   ```bash
   pnpm run build
   sudo systemctl restart nexus-api
   ```
5. Verify as in Step 8 of the checklist: `curl http://127.0.0.1:8080/api/readyz` returns
   `{"status":"ok","database":"ok"}`, the site loads, and the header shows **Live**.

A restart resets in-memory state: rate-limit counters, running alarm On/Off delays and
MQTT connections. See
[technical-reference.md](../technical-reference.md#process-local-state-single-process-requirement).
Run only one copy of the API.

---

## Recovery

### API server not responding
1. Check the service: `sudo systemctl status nexus-api`.
2. Read the most recent errors: `journalctl -u nexus-api --since "15 min ago" -p warning`.
3. Common start-up refusals (all logged with the reason):
   - `DATABASE_URL` missing: the value is not in the unit's `EnvironmentFile`.
   - `AUTH_EMAIL_TRANSPORT=console in production`: configure SMTP or a webhook relay.
   - Missing `SECRETS_ENC_KEY` in production.
   - `AUTH_ENFORCE=false` or `AUTH_SESSION_REQUIRED=false` in production.
4. Restart: `sudo systemctl restart nexus-api`. `Restart=always` in the unit restarts it
   automatically after a crash.
5. Check it listens only locally: `ss -ltnp | grep 8080` shows `127.0.0.1:8080`.

### Database connection failures
1. `curl http://127.0.0.1:8080/api/readyz` returns `503` with `"database":"unreachable"`
   while the database is down; `/api/healthz` stays `200`.
2. Check PostgreSQL: `sudo systemctl status postgresql` (or the remote database host).
3. Test the credentials from the VM: `psql "$DATABASE_URL" -c 'select 1'`.
4. After a schema change, `permission denied for table ...` means the runtime role lacks
   grants on a new table. Apply the `GRANT` and `ALTER DEFAULT PRIVILEGES` statements from
   the "Least privilege" block in `.env.example`.

### MQTT subscriber not connecting
1. Look for `MQTT subscriber startup failed` or broker errors:
   `journalctl -u nexus-api | grep -i mqtt`.
2. Check host, port, credentials and topic in Integration Hub → Broker. Saving a broker
   reconnects it.
3. Test reachability from the VM, for example
   `mosquitto_sub -h <host> -p <port> -u <user> -P <pw> -t '<topic>' -C 1`.
4. Check that only one API process runs. Two processes share the broker client id and
   keep disconnecting each other.

### WebSocket not receiving events
1. Browser DevTools → Network → WS: check the connection to `/api/ws`.
2. If the header says *Reconnecting* forever, the nginx `location /api/` block is missing
   `proxy_http_version 1.1` and the `Upgrade`/`Connection` headers (checklist Step 6).
3. Reload the page; `useWsEvents` reconnects on load.

---

## Monitoring

| Check | How | Expected |
|---|---|---|
| Process alive | `curl http://127.0.0.1:8080/api/healthz` | `200 {"status":"ok"}` |
| Ready (database reachable) | `curl http://127.0.0.1:8080/api/readyz` | `200`; `503` when the database is down. Point external monitoring here |
| Service restarts | `journalctl -u nexus-api \| grep -i "started\|stopped"` | No unexpected restarts |
| Errors | `journalctl -u nexus-api -p err --since today` | Empty or explained |
| Data flowing | Integration Hub → API Client / Broker: request counts and "last used" | Increasing |
| Storage | Governance → Data Management (or `GET /api/system/storage`, signed in) | Table sizes and largest assets |
| Security events | Governance → Security Center | No unexplained denials or lockouts |
| Journal size | `journalctl --disk-usage` | Within the journald limit set in the checklist |

---

## Incident response

### High telemetry volume (storage concern)
1. Open Governance → Data Management and find the asset producing the most rows.
2. Add a retention policy there (most specific policy wins: asset+metric over asset,
   asset over metric, metric over global).
3. Run pruning now with the button on that page (`POST /api/system/retention/run`).

### Alarm storm (many false alarms)
1. Find the rule in Event Manager → Alarm Rule.
2. Disable it (toggle **Enabled** off, or `PUT /api/alarm-rules/:id` with
   `{ "enabled": false }`).
3. Put the asset in maintenance mode from its detail page (Maintenance Mode toggle), or
   `POST /api/assets/:id/maintenance` with `{ "enable": true, "note": "Investigating alarm storm" }`.
   Maintenance mode suppresses alarm evaluation for that asset.
4. Adjust the threshold or deadband, then re-enable the rule and end maintenance mode.

### API client hitting the rate limit (HTTP 429)
1. Check the client's request counts and "last used" in Integration Hub → API Client.
2. The default limit is 1200 requests per minute per client (`INGEST_RATE_LIMIT_RPM`).
3. If the traffic is legitimate: batch readings (`/api/ingest/batch`), give the device a
   second client, or raise `INGEST_RATE_LIMIT_RPM` and restart.
4. If it is not: revoke the client from its row, or `POST /api/api-clients/:id/revoke`.
   `POST /api/api-clients/:id/restore` reactivates it.

### Leaked API key
Rotate the secret from the client's row (`POST /api/api-clients/:id/rotate-secret`). The
new secret is shown once; update the gateway. For a copy-and-paste ingest URL, regenerate
it (`POST /api/api-clients/:id/regenerate-ingest-url`).

---

## Rollback

### Code rollback
1. Check out the last known-good release and rebuild:
   ```bash
   cd /opt/nexus-iot
   git checkout <previous release tag>
   pnpm install
   pnpm run build
   sudo systemctl restart nexus-api
   ```
2. If the newer version changed the schema, the older code may not work against it. In
   that case restore the database backup taken before the upgrade
   ([backup-restore.md](backup-restore.md#4-restore)).
3. For an over-tight permission table after an upgrade, `AUTH_ENFORCE=false` disables
   route authorisation as a short-term escape hatch. The server refuses to start with it
   in production, so it helps only on non-production installations; on production, roll
   the code back instead.

### Data rollback
Restore from backup as described in [backup-restore.md](backup-restore.md). There is no
hosting provider to recover data for you. Telemetry is append-only and cannot be rolled
back without a database restore.

---

## Scheduled maintenance tasks

| Task | Frequency | Method |
|------|-----------|--------|
| Telemetry and operational-table pruning | Hourly (automatic) | `setInterval` in the API process; also prunes expired sessions and old security events |
| Manual prune | On demand | Governance → Data Management, or `POST /api/system/retention/run` |
| Broker reconnect | On disconnect (automatic) | Built-in reconnect of the `mqtt` package |
| Database and uploads backup | Nightly | [backup-restore.md](backup-restore.md) |
| `SECRETS_ENC_KEY` rotation | Quarterly, and on suspected exposure | Steps in `.env.example` (`rotate-secrets` script) |
| API client secret rotation | As needed | Integration Hub → API Client → rotate secret |
| OS and package updates | Monthly | `apt upgrade`, then `sudo systemctl restart nexus-api` |
