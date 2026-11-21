/**
 * Per-request audit context. The safety-net middleware (middleware/audit.ts)
 * opens it for every /api request; logActivity() marks it as audited, and uses
 * its request for the actor, IP and correlation id when a caller did not pass
 * `req` itself.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";

export interface AuditContext { req: Request; audited: boolean }

export const auditContext = new AsyncLocalStorage<AuditContext>();

export function currentAuditContext(): AuditContext | undefined { return auditContext.getStore(); }

/**
 * Mark the current request as audited without writing an entry: for writes
 * deliberately not recorded (a dashboard layout autosave), so the safety net
 * does not record them either.
 */
export function markAudited(): void {
  const ctx = auditContext.getStore();
  if (ctx) ctx.audited = true;
}
