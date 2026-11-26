import type { Request, Response, NextFunction } from "express";
import { normalise } from "../../routes/ingest";

/**
 * Sandbox clients (api_clients.sandbox = true) never store anything.
 *
 * Ingest: a single payload is answered by the existing dry-run endpoint
 * (/validate), so an integrator sees exactly which asset and attributes each
 * metric would reach. A batch is normalised and counted. The /api/v1 writes
 * check the flag themselves.
 *
 * Only requests made with a sandbox credential are touched; every other
 * request passes straight through.
 */
const PAYLOAD = /^(\/ingest(?:\/k\/[^/]+|\/e\/[^/]+)?)\/payload\/?$/;
const BATCH = /^\/ingest(?:\/k\/[^/]+|\/e\/[^/]+)?\/batch\/?$/;

export function sandboxIngest(req: Request, res: Response, next: NextFunction): void {
  if (!req.apiClient?.sandbox || req.principal || req.method !== "POST") { next(); return; }
  const payload = PAYLOAD.exec(req.path);
  if (payload) {
    res.setHeader("X-Nexus-Sandbox", "true");
    req.url = req.url.replace(/\/payload(\/?)(\?|$)/, "/validate$1$2");
    next();
    return;
  }
  if (BATCH.test(req.path)) {
    res.setHeader("X-Nexus-Sandbox", "true");
    const items = Array.isArray(req.body) ? (req.body as unknown[]) : null;
    if (!items) { res.status(400).json({ error: "Body must be an array", sandbox: true }); return; }
    let valid = 0, invalid = 0, metrics = 0;
    for (const item of items) {
      const n = item && typeof item === "object" ? normalise(item as Record<string, unknown>) : null;
      if (!n) { invalid++; continue; }
      valid++; metrics += Object.keys(n.metrics).length;
    }
    res.json({ sandbox: true, stored: false, totalRecords: items.length, valid, invalid, metrics,
      message: "Sandbox client: the batch was checked but nothing was stored." });
    return;
  }
  next();
}
