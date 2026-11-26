import { Router, type IRouter, type Request, type Response } from "express";
import { createReadStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import busboy from "busboy";
import { eq, desc, and, isNull, or, inArray } from "drizzle-orm";
import { db, uploadsTable, assetsTable } from "@workspace/db";
import { hasPermission } from "../lib/rbac";
import { recordSecurityEvent } from "../lib/security-log";
import {
  canListUpload, canDownloadUpload, canDeleteUpload, chooseUploadProject, type UploadViewer,
} from "../lib/upload/access";
import { logActivity } from "./activity_log";
import { logger } from "../lib/logger";
import { AppError, correlationIdOf } from "../lib/errors";
import { validate } from "../middleware/validate";
import { IdParams } from "../schemas/common";
import { z } from "zod";
import { detectType, scanGlbBody, DETECTION_HEAD_BYTES } from "../lib/upload/file-types";
import { checkImage } from "../lib/upload/image-info";
import { scanBuffer, verdictAllowsStorage, verdictAllowsDownload, scanConfig, type ScanResult } from "../lib/upload/scanner";
import {
  uploadStorage, allocate, openForWrite, resolveStoredPath, removeFile,
} from "../lib/upload/storage";

const router: IRouter = Router();

/**
 * Secure file upload.
 *
 * ── Order of checks, and why ─────────────────────────────────────────────────
 *
 * 1. size        enforced WHILE streaming, so an oversized upload is cut off
 *                mid-flight rather than buffered and then measured
 * 2. content     type detected from the bytes; the client's filename and
 *                Content-Type are recorded but never believed
 * 3. image       dimensions read from the header and bounded, BEFORE any
 *                decoder could be handed the file
 * 4. malware     scanned as a whole
 * 5. commit      only now does a database row exist
 *
 * The file is written to its final path as it streams — buffering a 10 MB upload
 * in memory per concurrent request is its own denial of service — and is DELETED
 * if any later check fails. A temporary file that outlives a failed upload is the
 * usual way "rejected" content ends up on disk anyway.
 */

/** The caller, as the upload access rules see them (lib/upload/access.ts, M-2). */
function viewerOf(req: Request): UploadViewer {
  const access = req.principal?.access;
  return {
    userId: req.principal?.user.id ?? null,
    restricted: !!access?.restrictProjects,
    allowedProjects: new Set(access?.allowedProjects ?? []),
    admin: !!access && hasPermission(access, "manage_users"),
  };
}

/** Same answer as a missing file, so ids of other projects' files cannot be probed. */
function refuseUpload(req: Request, id: string, reason: string): never {
  recordSecurityEvent({
    type: "authz.denied", outcome: "failure", reason,
    userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null,
    detail: { uploadId: id, path: req.path, method: req.method }, req,
  });
  throw new AppError(404, "not_found", "That file could not be found.");
}

// ── Metadata shown to clients. Never exposes a path. ─────────────────────────
function toClient(row: typeof uploadsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.originalName,
    mimeType: row.mimeType,
    size: row.sizeBytes,
    width: row.width,
    height: row.height,
    scanStatus: row.scanStatus,
    uploadedBy: row.uploadedByName,
    uploadedAt: row.createdAt,
    projectId: row.projectId,
    // A relative API path, not a filesystem location. The caller never learns
    // where the bytes actually are.
    url: `/api/uploads/${row.id}/content`,
  };
}

interface ReceivedFile {
  id: string;
  extension: string;
  absolutePath: string;
  originalName: string;
  declaredMime: string;
  size: number;
  sha256: string;
  head: Buffer;
}

class UploadRejected extends AppError {
  constructor(message: string, code = "upload_rejected") {
    super(400, code, message);
  }
}

/**
 * Stream one multipart request to disk.
 *
 * busboy rather than multer: it is the parser multer is built on, with far less
 * around it. Fewer layers in the path that handles untrusted bytes.
 */
function receive(req: Request, fields: Record<string, string> = {}): Promise<ReceivedFile[]> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      reject(new UploadRejected("Send the file as multipart/form-data.", "not_multipart"));
      return;
    }

    const bb = busboy({
      headers: req.headers,
      limits: {
        fileSize: uploadStorage.maxBytes,
        files: uploadStorage.maxFiles,
        // A multipart part name is attacker-controlled; bound it like anything else.
        fieldNameSize: 100,
        fieldSize: 8192,
        fields: 20,
      },
    });

    const files: ReceivedFile[] = [];
    const pending: Promise<void>[] = [];
    let failure: Error | null = null;

    const fail = (err: Error) => {
      if (!failure) failure = err;
    };

    bb.on("file", (_field, stream, info) => {
      const declaredMime = String(info.mimeType ?? "");
      // The client's filename is recorded for display and NEVER used to build a
      // path. Bounded here because it is about to be stored and rendered.
      const originalName = String(info.filename ?? "file").slice(0, 255);

      const detection = { head: Buffer.alloc(0) as Buffer };
      const hash = createHash("sha256");
      const allocated = allocate(".tmp");
      let size = 0;
      let truncated = false;

      const task = (async () => {
        const out = await openForWrite(allocated);
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          hash.update(chunk);
          if (detection.head.length < DETECTION_HEAD_BYTES) {
            detection.head = Buffer.concat([detection.head, chunk]).subarray(0, DETECTION_HEAD_BYTES);
          }
        });
        // busboy raises this the moment the limit is passed, so the rest of the
        // body is discarded instead of written.
        stream.on("limit", () => { truncated = true; });

        try {
          await pipeline(stream, out);
        } catch (err) {
          await removeFile(allocated.absolutePath);
          throw err;
        }

        if (truncated) {
          await removeFile(allocated.absolutePath);
          throw new UploadRejected(
            `"${originalName}" is larger than the ${Math.round(uploadStorage.maxBytes / 1024 / 1024)} MB limit.`,
            "file_too_large",
          );
        }
        if (size === 0) {
          await removeFile(allocated.absolutePath);
          throw new UploadRejected(`"${originalName}" is empty.`, "empty_file");
        }

        files.push({
          id: allocated.id,
          extension: allocated.extension,
          absolutePath: allocated.absolutePath,
          originalName,
          declaredMime,
          size,
          sha256: hash.digest("hex"),
          head: detection.head,
        });
      })().catch(fail);

      pending.push(task);
    });

    // Plain form fields (only `projectId` is read). Bounded by `limits` above.
    bb.on("field", (name, value) => { if (typeof value === "string") fields[name] = value; });

    bb.on("filesLimit", () => fail(new UploadRejected(
      `At most ${uploadStorage.maxFiles} files can be uploaded at once.`, "too_many_files")));
    bb.on("error", (err) => fail(err as Error));

    bb.on("close", () => {
      void Promise.allSettled(pending).then(async () => {
        if (failure) {
          // Anything already on disk from a partially successful batch goes too.
          await Promise.allSettled(files.map((f) => removeFile(f.absolutePath)));
          reject(failure);
          return;
        }
        if (files.length === 0) {
          reject(new UploadRejected("No file was included in the request.", "no_file"));
          return;
        }
        resolve(files);
      });
    });

    req.pipe(bb);
  });
}

// ── POST /uploads ────────────────────────────────────────────────────────────
router.post("/uploads", async (req: Request, res: Response): Promise<void> => {
  const fields: Record<string, string> = {};
  const received = await receive(req, fields);

  // Which project the files belong to (M-2). Checked before anything is committed;
  // a refusal removes the received files.
  const requested = typeof fields.projectId === "string" && /^[0-9a-f-]{36}$/i.test(fields.projectId.trim())
    ? fields.projectId.trim()
    : null;
  const projects = requested
    ? await db.select({ id: assetsTable.id }).from(assetsTable).where(and(eq(assetsTable.id, requested), isNull(assetsTable.parentId)))
    : [];
  const chosen = chooseUploadProject(viewerOf(req), requested, (id) => projects.some((p) => p.id === id));
  if ("error" in chosen) {
    await Promise.allSettled(received.map((f) => removeFile(f.absolutePath)));
    res.status(403).json({ error: chosen.error, code: "project_forbidden" });
    return;
  }
  const stored: Array<ReturnType<typeof toClient>> = [];
  const rejected: Array<{ name: string; reason: string }> = [];

  for (const file of received) {
    try {
      // ── 2. What IS this, actually? ────────────────────────────────────────
      const detected = detectType(file.head, file.declaredMime);
      if (!detected.ok || !detected.type) {
        throw new UploadRejected(detected.reason ?? "That file type is not supported.", "type_not_allowed");
      }

      // A GLB is scanned in full: the head check above sees only the first
      // DETECTION_HEAD_BYTES, and a model can carry markup further in.
      if (detected.type.mime === "model/gltf-binary") {
        const body = scanGlbBody(await fs.readFile(file.absolutePath));
        if (!body.ok) throw new UploadRejected(body.reason ?? "That file cannot be accepted.", "type_not_allowed");
      }

      // Worth knowing about: a mismatch is not always an attack (browsers guess
      // badly), but a run of them is the signature of someone probing.
      const declared = file.declaredMime.split(";")[0].trim().toLowerCase();
      if (declared && declared !== detected.type.mime) {
        logger.warn(
          { declared, detected: detected.type.mime, correlationId: correlationIdOf(req) },
          "upload content type did not match its declared type",
        );
      }

      // ── 3. If it is an image, is it a SANE image? ─────────────────────────
      const image = checkImage(detected.type.mime, file.head);
      if (!image.ok) throw new UploadRejected(image.reason ?? "The image could not be validated.", "invalid_image");

      // ── 4. Malware ────────────────────────────────────────────────────────
      let scan: ScanResult = { status: "skipped" };
      if (scanConfig.mode !== "off") {
        scan = await scanBuffer(await fs.readFile(file.absolutePath));
        if (!verdictAllowsStorage(scan)) {
          throw new UploadRejected(
            scan.status === "infected"
              ? "That file was rejected by the malware scanner."
              : "The file could not be scanned, so it was not accepted. Please try again later.",
            scan.status === "infected" ? "malware_detected" : "scan_unavailable",
          );
        }
      }

      // ── 5. Commit ─────────────────────────────────────────────────────────
      // The extension is now known, so the placeholder is renamed to its final
      // name. `rename` within one directory is atomic.
      const finalPath = resolveStoredPath(file.id, detected.type.extension);
      if (!finalPath) throw new AppError(500, "storage_error", "The file could not be stored.");
      await fs.rename(file.absolutePath, finalPath);

      const [row] = await db.insert(uploadsTable).values({
        id: file.id,
        originalName: file.originalName,
        extension: detected.type.extension,
        mimeType: detected.type.mime,
        declaredMimeType: file.declaredMime || null,
        sizeBytes: file.size,
        sha256: file.sha256,
        width: image.info?.width ?? null,
        height: image.info?.height ?? null,
        scanStatus: scan.status,
        scanSignature: scan.signature ?? null,
        scannedAt: scanConfig.mode === "off" ? null : new Date(),
        uploadedBy: req.principal?.user.id ?? null,
        uploadedByName: req.principal?.user.fullName ?? null,
        projectId: chosen.projectId,
      }).returning();

      void logActivity("upload.created", "upload", row.id, row.originalName,
        `${detected.type.label}, ${Math.round(file.size / 1024)} KB`, req);
      stored.push(toClient(row));
    } catch (err) {
      // One bad file in a batch does not discard the good ones, but it is never
      // left on disk.
      await removeFile(file.absolutePath);
      if (err instanceof AppError) {
        rejected.push({ name: file.originalName, reason: err.message });
      } else {
        logger.error({ err, correlationId: correlationIdOf(req) }, "upload failed");
        rejected.push({ name: file.originalName, reason: "The file could not be stored." });
      }
    }
  }

  if (stored.length === 0) {
    res.status(400).json({
      error: rejected[0]?.reason ?? "The upload was rejected.",
      code: "upload_rejected",
      rejected,
      correlationId: correlationIdOf(req),
    });
    return;
  }
  res.status(201).json({ uploaded: stored, rejected });
});

// ── GET /uploads ─────────────────────────────────────────────────────────────
router.get("/uploads", validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }) }),
  async (req, res): Promise<void> => {
    const { limit } = req.query as unknown as { limit: number };
    const viewer = viewerOf(req);
    // Narrowed in the query for a restricted user, so the limit counts visible files.
    const rows = await db.select().from(uploadsTable)
      .where(viewer.restricted
        ? or(
            viewer.userId ? eq(uploadsTable.uploadedBy, viewer.userId) : undefined,
            // Only well-formed ids reach the uuid column; anything else matches nothing.
            ...[[...viewer.allowedProjects].filter((p) => /^[0-9a-f-]{36}$/i.test(p))].filter((l) => l.length > 0).map((l) => inArray(uploadsTable.projectId, l)),
          )
        : undefined)
      .orderBy(desc(uploadsTable.createdAt)).limit(limit);
    res.json(rows.filter((r) => canListUpload(viewer, r)).map(toClient));
  });

// ── GET /uploads/:id/content ─────────────────────────────────────────────────
router.get("/uploads/:id/content", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as { id: string };
  const [row] = await db.select().from(uploadsTable).where(eq(uploadsTable.id, id)).limit(1);
  if (!row) throw new AppError(404, "not_found", "That file could not be found.");
  if (!canDownloadUpload(viewerOf(req), row)) refuseUpload(req, id, "upload_out_of_scope");

  const filePath = resolveStoredPath(row.id, row.extension);
  if (!filePath) throw new AppError(404, "not_found", "That file could not be found.");

  // A file whose scan never came back clean is not served. Serving it would make
  // this endpoint the delivery mechanism for whatever it is.
  if (row.scanStatus === "infected") {
    throw new AppError(403, "malware_detected", "That file was quarantined and cannot be downloaded.");
  }
  // In `required` mode a file must have scanned clean to be served at all.
  if (!verdictAllowsDownload(row.scanStatus)) {
    throw new AppError(403, "scan_not_clean",
      "That file has not passed a malware scan, so it cannot be downloaded. Upload it again once scanning is available.");
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    // Row without bytes: the file was removed underneath us.
    logger.error({ id: row.id }, "upload row has no file on disk");
    throw new AppError(404, "not_found", "That file could not be found.");
  }

  // ── Response headers are half the security of a download endpoint ──────────
  //
  // nosniff stops a browser second-guessing the type and, say, treating a
  // text/csv as HTML. The CSP neutralises anything active inside a document that
  // is rendered anyway. `attachment` means even a type a browser WOULD render is
  // downloaded rather than executed in this origin — which is what keeps a
  // stored file from becoming stored XSS against the app's own domain.
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Disposition", `attachment; filename="${safeDownloadName(row.originalName, row.extension)}"`);
  res.setHeader("Cache-Control", "private, max-age=0, no-store");

  await pipeline(createReadStream(filePath), res);
});

/**
 * Rebuild a download filename from the stored original.
 *
 * Reduced to a conservative allow-list, then given the extension the server
 * chose — not the one the name arrived with. A quote or CRLF here would break
 * out of the header; `../` would be a traversal hint to whatever saves it.
 */
function safeDownloadName(originalName: string, extension: string): string {
  const stem = originalName
    .normalize("NFC")
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return `${stem || "download"}${extension}`;
}

// ── DELETE /uploads/:id ──────────────────────────────────────────────────────
router.delete("/uploads/:id", validate({ params: IdParams }), async (req, res): Promise<void> => {
  const { id } = req.params as unknown as { id: string };
  // Uploader or an administrator only (M-2), checked before the delete.
  const [existing] = await db.select().from(uploadsTable).where(eq(uploadsTable.id, id)).limit(1);
  if (!existing) throw new AppError(404, "not_found", "That file could not be found.");
  const viewer = viewerOf(req);
  if (!canDeleteUpload(viewer, existing)) {
    if (!canListUpload(viewer, existing)) refuseUpload(req, id, "upload_out_of_scope");
    recordSecurityEvent({
      type: "authz.denied", outcome: "failure", reason: "upload_delete_not_owner",
      userId: viewer.userId, username: req.principal?.user.username ?? null,
      detail: { uploadId: id }, req,
    });
    res.status(403).json({ error: "Only the person who uploaded this file, or an administrator, can delete it.", code: "not_uploader" });
    return;
  }
  const [row] = await db.delete(uploadsTable).where(eq(uploadsTable.id, id)).returning();
  if (!row) throw new AppError(404, "not_found", "That file could not be found.");

  // Row first, then bytes. If the unlink fails the file is orphaned but
  // unreachable; the other order could leave a row pointing at nothing, which
  // the download endpoint would report as a 404 anyway but noisily.
  const filePath = resolveStoredPath(row.id, row.extension);
  if (filePath) await removeFile(filePath);

  void logActivity("upload.deleted", "upload", row.id, row.originalName, null, req);
  res.sendStatus(204);
});

export default router;
