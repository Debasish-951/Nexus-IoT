import net from "node:net";
import { logger } from "../logger";

/**
 * Malware scanning via ClamAV's clamd daemon.
 *
 * ── Why the protocol directly rather than a wrapper package ──────────────────
 *
 * clamd's INSTREAM command is a handful of lines: send `zINSTREAM\0`, then
 * length-prefixed chunks, then a zero-length chunk, then read one line back.
 * The npm wrappers add a dependency, an install-script in some cases, and a
 * layer between this code and a security control — for something the standard
 * library does in forty lines. Fewer moving parts in the path that decides
 * whether a file is safe.
 *
 * ── Fail-closed ──────────────────────────────────────────────────────────────
 *
 * The important decision here is what happens when the scanner is unreachable.
 * A scanner that silently passes everything when its daemon is down is worse
 * than no scanner, because the deployment believes it is protected. So:
 *
 *   UPLOAD_SCAN_MODE=required   scanner unreachable → upload REJECTED
 *   UPLOAD_SCAN_MODE=optional   scanner unreachable → stored, flagged "skipped",
 *                               and logged as a warning
 *   UPLOAD_SCAN_MODE=off        no scanning at all (default — no ClamAV here yet)
 *
 * The default is `off` rather than `required` deliberately: shipping a default
 * that makes every upload fail on a machine with no ClamAV would get the whole
 * feature disabled rather than configured. It logs loudly at boot instead.
 */

export type ScanMode = "off" | "optional" | "required";
export type ScanStatus = "clean" | "infected" | "skipped" | "error";

export interface ScanResult {
  status: ScanStatus;
  signature?: string;
}

function readMode(): ScanMode {
  const raw = (process.env.UPLOAD_SCAN_MODE ?? "off").trim().toLowerCase();
  return raw === "required" || raw === "optional" ? raw : "off";
}

export const scanConfig = {
  mode: readMode(),
  host: process.env.CLAMAV_HOST ?? "127.0.0.1",
  port: Number(process.env.CLAMAV_PORT ?? 3310),
  /** clamd's own StreamMaxLength must be at least this; mismatches truncate silently. */
  timeoutMs: Number(process.env.CLAMAV_TIMEOUT_MS ?? 30_000),
};

/**
 * Send bytes to clamd and interpret the verdict.
 *
 * The buffer is already in memory because the upload was written to a temporary
 * file and read back — streaming it straight from disk avoids holding two copies
 * for a large PDF, which is why the caller passes a stream where it can.
 */
export async function scanBuffer(data: Buffer): Promise<ScanResult> {
  if (scanConfig.mode === "off") return { status: "skipped" };

  try {
    const reply = await instream(data);
    const verdict = parseClamdReply(reply);
    if (verdict.status === "infected") {
      logger.error({ signature: verdict.signature }, "upload rejected: malware detected");
    } else if (verdict.status === "error") {
      logger.error({ reply: cleanClamdReply(reply) }, "clamd returned an unrecognised reply");
    }
    return verdict;
  } catch (err) {
    // Unreachable, timed out, refused. The MODE decides what that means.
    logger.error(
      { err, host: scanConfig.host, port: scanConfig.port, mode: scanConfig.mode },
      "virus scan failed",
    );
    return { status: "error" };
  }
}

/**
 * clamd ends every reply to a `z`-prefixed command with a NUL byte, which
 * String.prototype.trim() keeps. Left in place it defeated the `OK$` match, so a
 * clean file read as an unrecognised reply: rejected in `required` mode and
 * flagged `error` in `optional` mode.
 */
export function cleanClamdReply(reply: string): string {
  return reply.replace(/\0/g, "").trim();
}

/** Interpret one clamd INSTREAM reply: "stream: OK", "stream: <Sig> FOUND" or "... ERROR". */
export function parseClamdReply(raw: string): ScanResult {
  const reply = cleanClamdReply(raw);
  if (/\bOK$/.test(reply)) return { status: "clean" };
  const found = /:\s*(.+?)\s+FOUND$/.exec(reply);
  if (found) return { status: "infected", signature: found[1] };
  return { status: "error" };
}

function instream(data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: scanConfig.host, port: scanConfig.port });
    let reply = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(scanConfig.timeoutMs);
    socket.on("timeout", () => finish(() => reject(new Error("clamd timed out"))));
    socket.on("error", (err) => finish(() => reject(err)));
    socket.on("data", (chunk) => { reply += chunk.toString("utf8"); });
    socket.on("end", () => finish(() => resolve(cleanClamdReply(reply))));

    socket.on("connect", () => {
      socket.write("zINSTREAM\0");

      // Length-prefixed chunks. 64 KiB is clamd's documented sweet spot; larger
      // frames are accepted but give no benefit and risk hitting StreamMaxLength
      // handling differences between versions.
      const CHUNK = 65536;
      for (let offset = 0; offset < data.length; offset += CHUNK) {
        const slice = data.subarray(offset, offset + CHUNK);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(slice.length, 0);
        socket.write(header);
        socket.write(slice);
      }
      // Zero-length chunk terminates the stream.
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
  });
}

/**
 * Whether a verdict permits storing the file.
 *
 * `infected` never passes. `error` passes only when scanning is optional — that
 * is the entire difference between the two modes, and it is deliberately the
 * only place the distinction is made.
 */
export function verdictAllowsStorage(result: ScanResult): boolean {
  if (result.status === "clean" || result.status === "skipped") return true;
  if (result.status === "infected") return false;
  return scanConfig.mode !== "required";
}

/**
 * Whether a stored file may be downloaded, given its recorded scan status.
 *
 * `infected` is never served, in any mode. In `required` mode only `clean` is
 * served: a file stored as `skipped` or `error` (uploaded while scanning was
 * off or optional, or before this check existed) was never shown to be safe,
 * and `required` is the operator saying that matters. `optional` and `off` keep
 * serving them, as they always have.
 */
export function verdictAllowsDownload(status: string | null | undefined, mode: ScanMode = scanConfig.mode): boolean {
  if (status === "infected") return false;
  if (mode === "required") return status === "clean";
  return true;
}

/** Reports the scanner's state at boot, so a misconfiguration is visible then. */
export async function reportScannerStatus(): Promise<void> {
  if (scanConfig.mode === "off") {
    logger.warn(
      "UPLOAD_SCAN_MODE=off — uploaded files are NOT scanned for malware. " +
      "Set it to 'required' with a reachable clamd before accepting uploads from untrusted users.",
    );
    return;
  }
  try {
    const reply = await ping();
    logger.info({ mode: scanConfig.mode, host: scanConfig.host, port: scanConfig.port, reply }, "virus scanner ready");
  } catch (err) {
    const message =
      `clamd is not reachable at ${scanConfig.host}:${scanConfig.port} and UPLOAD_SCAN_MODE=${scanConfig.mode}. ` +
      (scanConfig.mode === "required"
        ? "Every upload will be REJECTED until it is available."
        : "Uploads will be stored WITHOUT scanning.");
    logger.error({ err }, message);
  }
}

function ping(): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: scanConfig.host, port: scanConfig.port });
    let reply = "";
    let settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; socket.destroy(); fn(); };
    socket.setTimeout(5000);
    socket.on("timeout", () => finish(() => reject(new Error("timeout"))));
    socket.on("error", (err) => finish(() => reject(err)));
    socket.on("data", (c) => { reply += c.toString("utf8"); });
    socket.on("end", () => finish(() => resolve(cleanClamdReply(reply))));
    socket.on("connect", () => socket.write("zPING\0"));
  });
}
