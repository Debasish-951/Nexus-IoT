import { pgTable, text, timestamp, uuid, integer, index } from "drizzle-orm/pg-core";

/**
 * Uploaded file metadata.
 *
 * The FILE never lives in the database and the DATABASE never holds a path the
 * client supplied. A row stores the generated id, and the bytes live at a path
 * derived from that id alone (see api-server lib/upload/storage.ts). Nothing a
 * user types ever reaches the filesystem, which is what makes path traversal
 * structurally impossible rather than something a filter has to catch.
 *
 * `originalName` is kept for display only. It is shown in the UI and used to
 * suggest a download filename, and is sanitised again at that point — it is
 * remembered, not trusted.
 */
export const uploadsTable = pgTable(
  "uploads",
  {
    /** Also the on-disk filename stem. Generated server-side, never client-supplied. */
    id: uuid("id").primaryKey().defaultRandom(),

    /** What the user called it. Display only — never used to build a path. */
    originalName: text("original_name").notNull(),

    /**
     * Extension chosen by the server from the SNIFFED content type, not from the
     * uploaded filename. `evil.php.png` is stored as `<uuid>.png` because the
     * bytes are a PNG; if the bytes were not a PNG it would have been rejected.
     */
    extension: text("extension").notNull(),

    /** Content type as DETECTED from the file's magic bytes. */
    mimeType: text("mime_type").notNull(),

    /** Content type the client CLAIMED. Stored only to spot clients that lie. */
    declaredMimeType: text("declared_mime_type"),

    sizeBytes: integer("size_bytes").notNull(),

    /** SHA-256 of the content: de-duplication, and a tamper check for the file at rest. */
    sha256: text("sha256").notNull(),

    /** Image dimensions when the file is an image, for layout and bomb detection. */
    width: integer("width"),
    height: integer("height"),

    /** pending | clean | infected | skipped | error */
    scanStatus: text("scan_status").notNull().default("pending"),
    /** Signature name when infected. Recorded so an incident can be investigated. */
    scanSignature: text("scan_signature"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),

    /** Who uploaded it — every file is attributable. */
    uploadedBy: uuid("uploaded_by"),
    uploadedByName: text("uploaded_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("uploads_created_idx").on(t.createdAt),
    // Lets a re-upload of identical bytes be recognised instead of stored twice.
    index("uploads_sha256_idx").on(t.sha256),
  ],
);

export type Upload = typeof uploadsTable.$inferSelect;
