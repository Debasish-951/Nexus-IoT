import { and, eq, or } from "drizzle-orm";
import { db, apiClientsTable } from "@workspace/db";
import { logger } from "./logger";
import { hashToken } from "./tokens";

/**
 * The secret that older versions of the seed script gave the "Local Dev Client".
 * It is written in the repository, so any server still accepting it accepts a
 * key that anyone with the source code knows.
 */
const PUBLIC_SEED_CREDENTIAL = "local-dev-secret";

/**
 * Refuse to start in production while an active API client still accepts the
 * published seed secret. In other environments, warn.
 *
 * Fix: revoke or rotate that client in Integration Hub → API Clients, or re-run
 * the seed script, which now replaces the secret with a random one.
 */
export async function assertNoPublicApiKey(): Promise<void> {
  let found: { id: string; clientId: string }[];
  try {
    found = await db
      .select({ id: apiClientsTable.id, clientId: apiClientsTable.clientId })
      .from(apiClientsTable)
      .where(and(
        eq(apiClientsTable.status, "active"),
        or(
          eq(apiClientsTable.clientSecret, PUBLIC_SEED_CREDENTIAL),
          eq(apiClientsTable.clientSecretHash, hashToken(PUBLIC_SEED_CREDENTIAL)),
        ),
      ));
  } catch (err) {
    // The database may not be reachable yet. Other startup steps report that;
    // this check must not be the reason the API cannot start.
    logger.warn({ err }, "Could not check for the published seed API key");
    return;
  }
  if (found.length === 0) return;

  const message =
    `API client "${found.map((c) => c.clientId).join(", ")}" accepts the published seed secret. ` +
    "Revoke or rotate it in Integration Hub → API Clients, or re-run the seed script, which replaces it.";
  if (process.env.NODE_ENV === "production") {
    logger.fatal({ apiClientIds: found.map((c) => c.id) }, message);
    process.exit(1);
  }
  logger.warn({ apiClientIds: found.map((c) => c.id) }, message);
}
