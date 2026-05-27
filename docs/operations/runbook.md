# Operations Runbook

**Confidence: High** — based on implemented server code and Replit platform model.

---

## Deployment

### Initial Deployment to Production (Replit)
1. Ensure all workflows are running and the preview pane shows a working app
2. Run `pnpm run typecheck` — must return zero errors
3. In Replit, click **Deploy** (top-right) → **Publish**
4. Replit builds both artifacts and deploys to `<project-name>.replit.app`
5. Verify the production URL is accessible and the API responds: `GET https://<domain>/api/dashboard/summary`

### Database Migration (Production)
```bash
# From Replit workspace shell — runs against DATABASE_URL (dev DB)
pnpm --filter @workspace/db run migrate

# To migrate production database, connect to the prod DB URL explicitly:
DATABASE_URL=<prod-db-url> pnpm --filter @workspace/db run migrate
```

> **Caution:** Always back up the production database before running migrations on it.

---

## Recovery

### API Server Not Responding
1. Check workflow logs: `artifacts/api-server: API Server`
2. Restart the workflow in Replit
3. If `PORT` error: ensure the workflow is configured correctly in `.replit-artifact/artifact.toml`
4. If `DATABASE_URL` error: verify the Replit PostgreSQL database is provisioned and `DATABASE_URL` secret is set

### Database Connection Failures
1. Check `DATABASE_URL` is set in secrets
2. Verify PostgreSQL service is running: Replit Database panel
3. Test connection: `pnpm --filter @workspace/db run migrate` (will fail fast if unreachable)

### MQTT Subscriber Not Connecting
1. Check API server logs for `MQTT subscriber startup failed`
2. Verify broker host, port, credentials in `Broker Management` UI
3. Restart the API Server workflow — MQTT subscriber restarts on every server start
4. If broker is unreachable from Replit network, consider firewall rules or VPN

### WebSocket Not Receiving Events
1. Open browser DevTools → Network → WS — check for connection to `/api/ws`
2. Verify the API server workflow is running
3. If connection fails: check proxy routing is intact (path `/api/ws` → API server port 8080)
4. Reload the page — `useWsEvents` reconnects on page load

---

## Monitoring

### Health Check
```bash
curl https://<domain>/api/healthz
```
Expected: `200 OK` with a health payload.

### Storage Check
```bash
curl https://<domain>/api/system/storage
```
Shows total rows, table sizes, and per-asset breakdown. Use this to identify runaway telemetry producers.

### Active Alarms
```bash
curl https://<domain>/api/alarms
```

### Broker Status
The Broker Status Bar at the bottom of the UI shows real-time MQTT connection status.  
For history: `GET /api/brokers/:id/history` (up to 500 events).

---

## Incident Response

### High Telemetry Volume (Storage Concern)
1. Check `GET /api/system/storage` — identify the asset generating the most rows
2. Create a retention policy via `System → Data Management → Add Policy`
3. Trigger immediate pruning: `POST /api/system/retention/run`

### Alarm Storm (Many False Alarms)
1. Identify the triggering rule: `GET /api/alarm-rules`
2. Disable the rule: `PUT /api/alarm-rules/:id` with `{ "enabled": false }`
3. Put the affected asset in maintenance mode: `POST /api/assets/:id/maintenance` with `{ "enabled": true, "note": "Investigating alarm storm" }`
4. Adjust threshold or add deadband, then re-enable

### Rate Limit Triggered for API Client
1. Check the client's `totalRequests` and `lastUsedAt` in `Security → API Clients`
2. If legitimate: consider creating a separate API client for high-frequency operations
3. If malicious: revoke the client: `PUT /api/api-clients/:id` with `{ "status": "revoked" }`

---

## Rollback Procedures

### Code Rollback
1. In Replit workspace: open checkpoint history (clock icon or History tab)
2. Identify the last known-good checkpoint
3. Click **Restore** — the workspace reverts to that state
4. Verify the restored state works in preview
5. Re-deploy if previously deployed to production

### Data Rollback
- No automated data rollback is implemented
- Replit manages PostgreSQL backups — contact Replit support for point-in-time recovery
- For telemetry data: rows are append-only and can be queried/exported but not rolled back without a DB restore

---

## Scheduled Maintenance Tasks

| Task | Frequency | Method |
|------|-----------|--------|
| Telemetry pruning | Hourly (automatic) | `setInterval` in API server process |
| Manual prune | On-demand | `POST /api/system/retention/run` or UI button |
| Broker reconnect | On disconnect (automatic) | mqtt package built-in reconnect |
| Secret rotation | As needed | Replit Secrets panel + `PUT /api/api-clients/:id` |
