import crypto from "node:crypto";
import { isNotNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, apiClientsTable, pool } from "./index";

/**
 * One-time conversion of plaintext API client secrets to hashes.
 *
 * Run once per environment after deploying the hashed-secret change:
 *
 *   pnpm --filter @workspace/db run hash-api-secrets
 *
 * For each row that still has a plaintext `client_secret`, this writes
 * SHA-256(secret) into `client_secret_hash` and nulls the plaintext column.
 *
 * EXISTING CREDENTIALS KEEP WORKING. The secret itself is unchanged — only how
 * it is stored — so every gateway already posting telemetry continues to
 * authenticate with the key it holds. Nothing needs to be re-issued.
 *
 * What it DOES change: the secret can no longer be read back from the API
 * Clients page. Anyone who has not recorded their key must rotate it. Tell the
 * team before running this.
 *
 * Safe to run more than once — rows already converted have a null plaintext and
 * are skipped.
 */

function hash(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function main(): Promise<void> {
  const rows = await db
    .select({ id: apiClientsTable.id, name: apiClientsTable.name, secret: apiClientsTable.clientSecret })
    .from(apiClientsTable)
    .where(isNotNull(apiClientsTable.clientSecret));

  if (rows.length === 0) {
    console.log("Nothing to do — no API client is storing a plaintext secret.");
    return;
  }

  console.log(`Converting ${rows.length} API client secret(s) to hashes…`);
  let done = 0;
  for (const row of rows) {
    if (!row.secret) continue;
    await db
      .update(apiClientsTable)
      .set({ clientSecretHash: hash(row.secret), clientSecret: null })
      .where(eq(apiClientsTable.id, row.id));
    done++;
    console.log(`  ✓ ${row.name}`);
  }

  console.log(
    `\nDone — ${done} secret(s) hashed.\n` +
    "Existing keys still authenticate. They can no longer be revealed in the UI;\n" +
    "anyone who did not record theirs must use Rotate Secret to get a new one.",
  );
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
