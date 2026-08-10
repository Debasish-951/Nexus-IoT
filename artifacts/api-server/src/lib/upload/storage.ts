import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../logger";
import { ALLOWED_TYPES } from "./file-types";

/**
 * Where uploaded bytes live.
 *
 * ── Outside every executable and served directory ────────────────────────────
 *
 * The deployment serves `artifacts/iot-platform/dist/public` through nginx and
 * runs `artifacts/api-server/dist`. Uploads go to NEITHER. The default is a
 * sibling `var/uploads`, and `UPLOAD_DIR` should point at something outside the
 * deployment tree entirely (`/var/lib/nexus/uploads`) in production.
 *
 * This matters because the classic upload compromise is not a clever parser
 * exploit — it is a file landing somewhere the web server will execute or serve.
 * If uploads are never inside a served root, a stored `.php` is an inert blob
 * even if every other check somehow failed. Defence that does not depend on
 * validation being correct.
 *
 * Files are also written with mode 0600 and the directory 0700: the account that
 * runs the API is the only one that can read them back.
 *
 * ── Path traversal ───────────────────────────────────────────────────────────
 *
 * There is no sanitising of user filenames here, because no user filename ever
 * reaches this module. A path is `<UPLOAD_DIR>/<shard>/<uuid><ext>` where the
 * uuid is generated and the extension comes from the sniffed content type. The
 * traversal defence is that there is nothing to traverse WITH.
 *
 * `resolveStoredPath` still re-checks containment before every read, because a
 * defence that is obvious today is one someone edits around later.
 */

const DEFAULT_DIR = path.resolve(process.cwd(), "var", "uploads");

export const uploadStorage = {
  root: path.resolve(process.env.UPLOAD_DIR ?? DEFAULT_DIR),
  /** Hard ceiling per file, enforced while streaming — not after buffering. */
  maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024),
  /** Files accepted in one request. */
  maxFiles: Number(process.env.UPLOAD_MAX_FILES ?? 5),
};

/**
 * Two-character shard directory from the id.
 *
 * A single flat directory with a few hundred thousand entries makes `readdir`
 * and some filesystems slow enough to notice. 256 subdirectories keeps that
 * manageable and costs nothing.
 */
function shardOf(id: string): string {
  return id.slice(0, 2);
}

export async function ensureUploadRoot(): Promise<void> {
  await fs.mkdir(uploadStorage.root, { recursive: true, mode: 0o700 });
  // mkdir's mode is ignored when the directory already exists, so it is set
  // explicitly — an upgrade from an earlier version may have created it 0755.
  await fs.chmod(uploadStorage.root, 0o700).catch(() => { /* non-POSIX filesystem */ });
  logger.info({ dir: uploadStorage.root, maxBytes: uploadStorage.maxBytes }, "upload storage ready");
  void sweepOrphans();
}

/**
 * Remove `.tmp` files left by uploads that never completed.
 *
 * An upload is written under a placeholder name and only renamed once every
 * check has passed, so a crash or a kill between those two points leaves a file
 * with no database row and nothing to ever reference it. Without a sweep those
 * accumulate silently until the disk fills — a slow failure that presents as
 * something else entirely.
 *
 * One hour, so a long upload in flight during a restart is never taken out from
 * under itself.
 */
async function sweepOrphans(): Promise<void> {
  const cutoff = Date.now() - 3_600_000;
  let removed = 0;
  try {
    for (const shard of await fs.readdir(uploadStorage.root)) {
      const shardPath = path.join(uploadStorage.root, shard);
      let entries: string[];
      try { entries = await fs.readdir(shardPath); } catch { continue; }
      for (const entry of entries) {
        if (!entry.endsWith(".tmp")) continue;
        const full = path.join(shardPath, entry);
        try {
          const stat = await fs.stat(full);
          if (stat.mtimeMs < cutoff) { await fs.unlink(full); removed++; }
        } catch { /* raced with another sweep or already gone */ }
      }
    }
  } catch (err) {
    logger.warn({ err }, "upload orphan sweep failed");
    return;
  }
  if (removed > 0) logger.info({ removed }, "removed incomplete uploads");
}

export interface AllocatedFile {
  id: string;
  extension: string;
  absolutePath: string;
}

/** Reserve a path for a new file. The id is the filename; nothing else feeds it. */
export function allocate(extension: string): AllocatedFile {
  const id = randomUUID();
  const dir = path.join(uploadStorage.root, shardOf(id));
  return { id, extension, absolutePath: path.join(dir, `${id}${extension}`) };
}

/**
 * Open a write stream that REFUSES to overwrite.
 *
 * `wx` is exclusive-create: if the path exists the open fails. With generated
 * UUIDs a collision is already implausible, but "implausible" is not the same as
 * "cannot", and the failure mode of a silent overwrite is one user's file
 * replacing another's. This turns that into an error instead.
 */
export async function openForWrite(file: AllocatedFile) {
  await fs.mkdir(path.dirname(file.absolutePath), { recursive: true, mode: 0o700 });
  return createWriteStream(file.absolutePath, { flags: "wx", mode: 0o600 });
}

/**
 * Map an id back to its path, refusing anything that escapes the root.
 *
 * The id is validated as a UUID first, so a traversal string cannot even reach
 * the join. The containment check after it is belt-and-braces: it costs one
 * string comparison and it is what keeps this safe if the id format is ever
 * loosened by someone who has not read this comment.
 */
export function resolveStoredPath(id: string, extension: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  // Membership of the allow-list, not a character class. `.php` matches
  // /^\.[A-Za-z0-9]{1,8}$/ perfectly well — it cannot reach the database today
  // because extensions are assigned from detection, but "cannot happen" is a
  // property of code someone may change, whereas set membership is a property
  // of this line.
  if (!ALLOWED_TYPES.some((t) => t.extension === extension)) return null;

  const candidate = path.resolve(uploadStorage.root, shardOf(id), `${id}${extension}`);
  const rootWithSep = uploadStorage.root.endsWith(path.sep)
    ? uploadStorage.root
    : uploadStorage.root + path.sep;

  // startsWith on the root WITH a separator: without the separator,
  // "/var/lib/nexus/uploads-evil" would pass a prefix test against
  // "/var/lib/nexus/uploads".
  if (!candidate.startsWith(rootWithSep)) {
    logger.error({ id }, "resolved upload path escaped the storage root — refused");
    return null;
  }
  return candidate;
}

/** Best-effort removal. A failure to delete must not fail the request that triggered it. */
export async function removeFile(absolutePath: string): Promise<void> {
  try {
    await fs.unlink(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn({ err, path: absolutePath }, "could not remove upload");
    }
  }
}
