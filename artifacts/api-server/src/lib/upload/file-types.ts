/**
 * Content-based file type detection and the allow-list.
 *
 * ── The one decision this file exists to make ────────────────────────────────
 *
 * The stored extension is derived from the BYTES, never from what the client
 * sent. That single rule removes most of the classic upload attacks at once,
 * because none of the attacker-controlled strings reach a filesystem or a
 * response header:
 *
 *   evil.php.png        the double extension is irrelevant — the name is
 *                       discarded and the file is stored as <uuid>.png
 *   ../../etc/passwd    a filename is never part of a path (see storage.ts)
 *   shell.php + image/png in Content-Type
 *                       the declared type is ignored; the bytes are not a PNG,
 *                       so it is rejected
 *
 * A deny-list of "dangerous extensions" is the usual approach and it is the
 * wrong one: it has to enumerate .php, .phtml, .php5, .phar, .jsp, .jspx, .asp,
 * .aspx, .cgi, .pl, .py, .sh, .exe, .dll, .bat, .cmd, .ps1, .jar, .svg, .html,
 * .htm, .xhtml, .shtml … and be wrong the day the server gains a new handler.
 * An allow-list of types we can positively identify is finite and fails closed.
 */

export interface DetectedType {
  /** Canonical MIME type, determined from content. */
  mime: string;
  /** Extension the server will use. Includes the dot. */
  extension: string;
  /** Whether this is an image whose pixel dimensions should also be checked. */
  isImage: boolean;
  label: string;
}

interface Signature {
  type: DetectedType;
  /** Byte pattern at `offset`. `null` in the pattern matches any byte. */
  offset: number;
  bytes: (number | null)[];
  /** Extra confirmation beyond the leading magic, for containers like WebP. */
  verify?: (buf: Buffer) => boolean;
}

const T = {
  png:  { mime: "image/png",  extension: ".png",  isImage: true,  label: "PNG image" },
  jpeg: { mime: "image/jpeg", extension: ".jpg",  isImage: true,  label: "JPEG image" },
  gif:  { mime: "image/gif",  extension: ".gif",  isImage: true,  label: "GIF image" },
  webp: { mime: "image/webp", extension: ".webp", isImage: true,  label: "WebP image" },
  pdf:  { mime: "application/pdf", extension: ".pdf", isImage: false, label: "PDF document" },
  csv:  { mime: "text/csv",   extension: ".csv",  isImage: false, label: "CSV file" },
} as const satisfies Record<string, DetectedType>;

/** Every type this application will accept. Anything not here is refused. */
export const ALLOWED_TYPES: readonly DetectedType[] = [T.png, T.jpeg, T.gif, T.webp, T.pdf, T.csv];

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const SIGNATURES: Signature[] = [
  { type: T.png,  offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // JPEG: SOI marker. The third byte varies by encoder, so it is left open.
  { type: T.jpeg, offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: T.gif,  offset: 0, bytes: ascii("GIF87a") },
  { type: T.gif,  offset: 0, bytes: ascii("GIF89a") },
  // WebP is a RIFF container: "RIFF" .... "WEBP". The size field between them
  // is skipped with nulls, and the second tag is what actually identifies it —
  // without checking it, any RIFF file (a .wav, an .avi) would pass as an image.
  {
    type: T.webp, offset: 0,
    bytes: [...ascii("RIFF"), null, null, null, null, ...ascii("WEBP")],
  },
  { type: T.pdf,  offset: 0, bytes: ascii("%PDF-") },
];

function matches(buf: Buffer, sig: Signature): boolean {
  if (buf.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    const expected = sig.bytes[i];
    if (expected === null) continue;
    if (buf[sig.offset + i] !== expected) return false;
  }
  return sig.verify ? sig.verify(buf) : true;
}

/**
 * Types that have no magic number and can only be recognised by shape.
 *
 * CSV is the awkward one: it is just text, so "is this a CSV" cannot be answered
 * with certainty. It is accepted only when the content is printable ASCII/UTF-8
 * with no NUL bytes AND the client asked for CSV — the declared type is used
 * here as a *narrowing* hint, never as proof, and the content check still has to
 * pass. A file that fails the text test is rejected whatever it claims to be.
 */
function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return false;   // NUL: binary, not text
  let suspicious = 0;
  for (const b of sample) {
    // Allow tab, LF, CR and printable range; count anything else.
    const ok = b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e) || b >= 0x80;
    if (!ok) suspicious++;
  }
  return suspicious / Math.max(sample.length, 1) < 0.01;
}

/**
 * Byte patterns that must never be stored, whatever else the file appears to be.
 *
 * This is a second line behind the allow-list, aimed at POLYGLOTS: a file whose
 * leading bytes are a valid GIF header and whose body is a PHP script or an HTML
 * page. The allow-list alone would accept it as a GIF, and it would be inert as
 * an image — but if it is ever served with the wrong content type, or processed
 * by something that scans the whole file, the payload is right there.
 *
 * Checked against the head of the file only, which is where a polyglot has to
 * put its payload for the second parser to find it.
 */
const POLYGLOT_MARKERS: { pattern: Buffer; label: string }[] = [
  { pattern: Buffer.from("<?php", "ascii"), label: "PHP code" },
  { pattern: Buffer.from("<?=", "ascii"), label: "PHP short tag" },
  { pattern: Buffer.from("<script", "ascii"), label: "inline script" },
  { pattern: Buffer.from("<!DOCTYPE html", "ascii"), label: "HTML document" },
  { pattern: Buffer.from("<html", "ascii"), label: "HTML document" },
  { pattern: Buffer.from("<svg", "ascii"), label: "SVG markup" },
  { pattern: Buffer.from("#!/", "ascii"), label: "shell shebang" },
  { pattern: Buffer.from("MZ", "ascii"), label: "Windows executable" },
  { pattern: Buffer.from([0x7f, 0x45, 0x4c, 0x46]), label: "ELF executable" },
];

export interface DetectionResult {
  ok: boolean;
  type?: DetectedType;
  /** User-safe reason. Never echoes file content. */
  reason?: string;
}

/**
 * Identify a file from its content.
 *
 * `declaredMime` is accepted only to narrow the text case and is never trusted
 * to establish a type on its own.
 */
export function detectType(head: Buffer, declaredMime?: string): DetectionResult {
  // Polyglot check first: a file that carries executable markup is refused even
  // if its header would otherwise identify it as an allowed image.
  const scanWindow = head.subarray(0, Math.min(head.length, 4096));
  const lower = Buffer.from(scanWindow.toString("latin1").toLowerCase(), "latin1");
  for (const marker of POLYGLOT_MARKERS) {
    const needle = Buffer.from(marker.pattern.toString("latin1").toLowerCase(), "latin1");
    if (lower.includes(needle)) {
      return { ok: false, reason: `The file contains ${marker.label} and cannot be accepted.` };
    }
  }

  for (const sig of SIGNATURES) {
    if (matches(head, sig)) return { ok: true, type: sig.type };
  }

  // Text-shaped, and the client asked for CSV.
  const declared = (declaredMime ?? "").split(";")[0].trim().toLowerCase();
  if ((declared === "text/csv" || declared === "application/vnd.ms-excel" || declared === "text/plain") && looksLikeText(head)) {
    return { ok: true, type: T.csv };
  }

  return {
    ok: false,
    reason: "That file type is not supported. Allowed: PNG, JPEG, GIF, WebP, PDF and CSV.",
  };
}

/** How many leading bytes detection needs. Enough for the polyglot window. */
export const DETECTION_HEAD_BYTES = 4096;
