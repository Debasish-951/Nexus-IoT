import type { Request, Response, NextFunction } from "express";
import { auditContext, type AuditContext } from "../lib/audit-context";
import { needsSafetyNetEntry, describeRequest, outcomeFor } from "../lib/audit-core";
import { recordAudit } from "../lib/audit-store";

/**
 * Audit safety net. Opens the per-request audit context and, when a write under
 * /api finishes without any route having called logActivity(), records a
 * generic entry: method, route, target id and outcome. Failed writes are
 * recorded too (outcome failure / denied). Request bodies are never stored.
 * Ingest, sign-in flows and read-only POSTs are skipped (lib/audit-core.ts).
 */
export function auditSafetyNet(req: Request, res: Response, next: NextFunction): void {
  const ctx: AuditContext = { req, audited: false };
  res.on("finish", () => {
    const path = req.originalUrl.split("?")[0] ?? "";
    if (!needsSafetyNetEntry(req.method, path, res.statusCode, ctx.audited)) return;
    const d = describeRequest(path);
    const outcome = outcomeFor(res.statusCode);
    void auditContext.run({ req, audited: true }, () => recordAudit({
      action: `api.${req.method.toLowerCase()}`,
      category: d.category,
      targetId: d.id,
      targetName: null,
      detail: `${req.method} ${d.pattern} -> ${res.statusCode}`,
    }, req, { outcome }));
  });
  auditContext.run(ctx, () => next());
}
