import { pgTable, text, timestamp, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiClientsTable = pgTable("api_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  clientId: text("client_id").notNull().unique(),
  /**
   * LEGACY plaintext secret. Retained only so credentials issued before hashing
   * keep authenticating; nothing writes it any more. Run
   * `pnpm --filter @workspace/db run hash-api-secrets` to convert existing rows,
   * after which every value here is null and the column can be dropped.
   */
  clientSecret: text("client_secret"),
  /**
   * SHA-256 of the secret, hex — the only form stored for anything issued now.
   *
   * Unsalted SHA-256 is the right primitive here and NOT the scrypt used for
   * passwords: the input is a randomUUID (122 bits of entropy), so there is
   * nothing to brute-force, and the lookup has to be a deterministic indexed
   * equality. Same reasoning as session tokens — see api-server lib/tokens.ts.
   *
   * The consequence is that a secret cannot be shown again after it is issued.
   * That is the point: read access to this table no longer yields working ingest
   * credentials.
   */
  clientSecretHash: text("client_secret_hash"),
  /**
   * Optional owning project — a root-level asset (one with no parent).
   *
   * This is what lets a team share one credential: the project head creates a
   * project, assigns people to it (users.access_overrides.allowedProjects), and
   * gives the project a dedicated API client. Everyone on the project sees and
   * uses that one endpoint, instead of each person needing their own key.
   *
   * NULL means a platform-wide client, visible only to administrators — the
   * pre-existing behaviour, so old rows keep working untouched.
   *
   * Deliberately NOT a foreign key: assets are user-managed and deleting a
   * project should orphan its client (surfaced in the UI as "unassigned")
   * rather than cascade-delete a live credential out from under a running
   * gateway.
   */
  projectId: uuid("project_id"),
  /**
   * ── Ingest URL token ──────────────────────────────────────────────────────
   *
   * A SECOND credential, separate from `clientSecret`, that exists only to be
   * embedded in a copy-and-paste ingest URL:
   *
   *   http://host/api/ingest/e/<token>/payload
   *
   * The product requirement is that an operator can return to Broker Management
   * at any time and copy a working URL. A hash cannot satisfy that — there is
   * nothing to put back into the URL — so this token is stored REVERSIBLY, and
   * that is a deliberate trade made safe by bounding what the token can do:
   *
   *   • It is accepted ONLY on /ingest/* routes.
   *   • It is accepted ONLY when the client's scopes are ingest-only. A
   *     `*` super-key is never usable through a URL, however it is stored.
   *   • It is revocable and rotatable independently of `clientSecret`.
   *
   * So the blast radius of a leaked ingest URL is "someone can write telemetry
   * to one project" — attributable, rate-limited, and revoked in one click.
   * This is the same trade Slack, Teams and Stripe webhook URLs make.
   *
   * Two columns, because encryption is not searchable:
   *   `ingestTokenHash` — SHA-256, indexed, what authentication looks up.
   *   `ingestTokenEnc`  — AES-256-GCM ciphertext, only ever decrypted to show
   *                       an administrator the URL again. Requires
   *                       SECRETS_ENC_KEY; without it no token is issued at all
   *                       rather than one being stored in clear.
   */
  ingestTokenHash: text("ingest_token_hash"),
  ingestTokenEnc: text("ingest_token_enc"),
  ingestTokenIssuedAt: timestamp("ingest_token_issued_at", { withTimezone: true }),

  tags: text("tags").array().notNull().default([]),
  scopes: text("scopes").array().notNull().default([]),
  status: text("status").notNull().default("active"), // active|inactive|revoked
  allowedIps: text("allowed_ips").array().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
  totalRequests: integer("total_requests").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApiClientSchema = createInsertSchema(apiClientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApiClient = z.infer<typeof insertApiClientSchema>;
export type ApiClient = typeof apiClientsTable.$inferSelect;
