import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, destinationsTable, brokersTable } from "@workspace/db";
import { initSecretBox, encryptionEnabled, isEncrypted, decryptSecret, encryptSecret, keyRingStatus } from "../lib/secret-box";

/**
 * Encrypt-at-rest migration AND key rotation, in one idempotent pass.
 *
 * Both operations are the same work — read every credential, decrypt it under
 * whichever key wrote it, re-encrypt it under the CURRENT key — so they are one
 * script rather than two that could drift.
 *
 *   First run:  plaintext rows become ciphertext under key 1
 *   Rotation:   set SECRETS_ENC_KEY to the new key, keep the old one available
 *               as SECRETS_ENC_KEY_<oldId>, run again, then retire the old key
 *
 * Safe to run repeatedly: a row already encrypted under the current key is left
 * alone, so an interrupted run is resumed simply by running it again.
 *
 *   pnpm --filter @workspace/api-server run rotate-secrets
 *   pnpm --filter @workspace/api-server run rotate-secrets -- --dry-run
 *
 * ── Rotation cadence ─────────────────────────────────────────────────────────
 *
 * Rotate the data key on a schedule (quarterly is a reasonable default) and
 * immediately on any suspected exposure — someone leaving, a key appearing in a
 * log, a restored backup handled outside the normal process. Rotating the KEY
 * does not rotate the CREDENTIALS: if a webhook token itself leaked, it must be
 * reissued at the third party. This script only changes what protects them.
 */

interface Target {
  label: string;
  load(): Promise<Array<{ id: string; values: Record<string, string | null> }>>;
  save(id: string, values: Record<string, string | null>): Promise<void>;
  fields: string[];
  context(field: string): string;
}

const TARGETS: Target[] = [
  {
    label: "destinations",
    fields: ["token", "secretKey", "basicPass"],
    context: (f) => `destinations.${f}`,
    async load() {
      const rows = await db.select().from(destinationsTable);
      return rows.map((r) => ({
        id: r.id,
        values: { token: r.token, secretKey: r.secretKey, basicPass: r.basicPass },
      }));
    },
    async save(id, values) {
      await db.update(destinationsTable).set(values).where(eq(destinationsTable.id, id));
    },
  },
  {
    label: "brokers",
    fields: ["mqttPassword"],
    context: () => "brokers.mqttPassword",
    async load() {
      const rows = await db.select().from(brokersTable);
      return rows.map((r) => ({ id: r.id, values: { mqttPassword: r.mqttPassword } }));
    },
    async save(id, values) {
      await db.update(brokersTable).set(values).where(eq(brokersTable.id, id));
    },
  },
];

/** Which key id encrypted this value, or null if it is still plaintext. */
function keyIdOf(value: string): string | null {
  return isEncrypted(value) ? value.split(":")[2] ?? null : null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  initSecretBox();
  if (!encryptionEnabled()) {
    console.error(
      "\n  SECRETS_ENC_KEY is not set, so there is nothing to encrypt with.\n\n" +
      "  Generate a key:\n" +
      "    node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n\n" +
      "  Then write it to a file readable only by the service account and set\n" +
      "  SECRETS_ENC_KEY_FILE to that path (preferred), or set SECRETS_ENC_KEY.\n",
    );
    process.exit(1);
  }

  const status = keyRingStatus();
  console.log(`\n  Current key: ${status.currentKeyId}`);
  console.log(`  Keys loaded: ${status.loadedKeyIds.join(", ")}`);
  if (dryRun) console.log("  DRY RUN — nothing will be written\n");
  else console.log("");

  let converted = 0, rewrapped = 0, unchanged = 0, failed = 0;

  for (const target of TARGETS) {
    const rows = await target.load();
    for (const row of rows) {
      const next: Record<string, string | null> = {};
      let changed = false;

      for (const field of target.fields) {
        const stored = row.values[field];
        if (!stored) continue;

        const existingKeyId = keyIdOf(stored);
        if (existingKeyId === status.currentKeyId) { unchanged++; continue; }

        const plaintext = decryptSecret(stored, target.context(field));
        if (plaintext === null) {
          // Never overwrite something we could not read. The row keeps its
          // current value and the operator is told which one needs attention —
          // silently blanking a credential here would take a live integration
          // down with no way to recover it.
          console.error(`    ! ${target.label}/${row.id}.${field}: could not decrypt (retired key removed?) — left untouched`);
          failed++;
          continue;
        }

        next[field] = encryptSecret(plaintext, target.context(field));
        changed = true;
        if (existingKeyId === null) converted++; else rewrapped++;
      }

      if (changed && !dryRun) await target.save(row.id, next);
    }
    console.log(`  ${target.label}: ${rows.length} row(s) examined`);
  }

  console.log(
    `\n  plaintext → encrypted : ${converted}` +
    `\n  re-wrapped under new key: ${rewrapped}` +
    `\n  already current        : ${unchanged}` +
    `\n  failed                 : ${failed}\n`,
  );

  if (failed > 0) {
    console.error("  Some values could not be decrypted. Restore the retired key and run again.\n");
    process.exit(2);
  }
  if (dryRun) console.log("  Dry run complete — re-run without --dry-run to apply.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("rotate-secrets failed:", err);
  process.exit(1);
});
