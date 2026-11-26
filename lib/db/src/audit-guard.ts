/**
 * Install or upgrade the audit log guard (triggers, the insert-only checkpoint
 * table and the retention function). Run it as the OWNER of `activity_logs`:
 *
 *   pnpm --filter @workspace/db run audit-guard
 *   pnpm --filter @workspace/db run audit-guard -- --runtime-role nexus_app   # also set the runtime login's grants
 *   pnpm --filter @workspace/db run audit-guard -- --print [--runtime-role nexus_app]   # print the SQL, change nothing
 *
 * The connection string is AUDIT_GUARD_DATABASE_URL, else DATABASE_URL. With a
 * separate runtime login, run the API once after upgrading (it hashes entries
 * from before the chain existed, which needs UPDATE), then run this with
 * --runtime-role, which revokes UPDATE, DELETE and TRUNCATE on the audit tables
 * from that login. Safe to run again. See docs/features/audit-log.md.
 */
import * as dotenv from "dotenv";
import pg from "pg";
import { AUDIT_GUARD_SQL, AUDIT_GUARD_VERSION, auditGuardGrantsSql } from "./audit-guard-sql";

dotenv.config({ path: "../../.env" });

const argv = process.argv.slice(2);
const print = argv.includes("--print");
const roleArg = argv.find((a) => a.startsWith("--runtime-role="))?.split("=")[1]
  ?? (argv.includes("--runtime-role") ? argv[argv.indexOf("--runtime-role") + 1] : undefined);

async function main(): Promise<void> {
  const sql = AUDIT_GUARD_SQL + (roleArg ? auditGuardGrantsSql(roleArg) : "");
  if (print) { console.log(sql); return; }
  const url = process.env.AUDIT_GUARD_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set AUDIT_GUARD_DATABASE_URL (the owner login) or DATABASE_URL.");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const who = await c.query<{ me: string; owner: string | null }>(
      `SELECT current_user AS me, (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('activity_logs')) AS owner`);
    const { me, owner } = who.rows[0]!;
    if (!owner) throw new Error("activity_logs does not exist yet: run `pnpm --filter @workspace/db run push` first.");
    if (owner !== me) console.warn(`Warning: connected as "${me}" but activity_logs is owned by "${owner}"; this usually fails. Connect as the owner.`);
    await c.query("BEGIN");
    await c.query(sql);
    await c.query("COMMIT");
    const nulls = await c.query<{ n: string }>(`SELECT count(*)::bigint AS n FROM activity_logs WHERE seq IS NULL`);
    console.log(`Audit log guard version ${AUDIT_GUARD_VERSION} installed${roleArg ? `, grants set for "${roleArg}"` : ""}.`);
    if (Number(nulls.rows[0]?.n ?? 0) > 0) console.warn(`${nulls.rows[0]!.n} entries have no seq; Verify integrity reports them. New entries without seq are refused.`);
    if (owner === me && !roleArg) console.log("Tip: the application should use a separate login; rerun with --runtime-role <login> to limit it to reading and appending.");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
