/**
 * Image header parsing, for validating content before anything processes it.
 *
 * ── Why parse rather than decode ─────────────────────────────────────────────
 *
 * "Validate image content" is usually done by decoding the image with a library
 * and treating "it decoded" as proof it is safe. That gets the order wrong: the
 * decoder is the most complex, most memory-hungry, most historically vulnerable
 * component in the chain, and handing it an unvalidated file is the thing we
 * are trying to avoid. Image libraries are where the image CVEs are.
 *
 * So the dimensions are read straight from the header — a few dozen bytes,
 * fixed-offset integer reads, no allocation proportional to the image — and the
 * file is rejected before a decoder ever sees it.
 *
 * ── The attack this stops ────────────────────────────────────────────────────
 *
 * A decompression bomb. A PNG of 64,000 × 64,000 pixels compresses to a few
 * hundred kilobytes because it is a single flat colour, so every size limit
 * passes. Decoded at 4 bytes per pixel it needs roughly 16 GB of RAM, and the
 * process dies. The file is not malformed and no scanner flags it — the only
 * defence is refusing to decode something whose declared dimensions are absurd.
 *
 * Dimensions are also what the UI needs for layout, so this is not extra work.
 */

export interface ImageInfo {
  width: number;
  height: number;
}

export interface ImageCheckResult {
  ok: boolean;
  info?: ImageInfo;
  reason?: string;
}

/** Ceilings. Generous for a photograph, far below anything that threatens memory. */
export const MAX_IMAGE_DIMENSION = 12_000;
/** ~40 MP. A 12000×12000 square would be 144 MP, so this binds first on extreme aspect ratios. */
export const MAX_IMAGE_PIXELS = 40_000_000;

/** PNG: IHDR is always the first chunk, width/height as big-endian u32 at 16/20. */
function pngSize(buf: Buffer): ImageInfo | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(12) !== 0x49484452) return null; // "IHDR"
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** GIF: logical screen descriptor, little-endian u16 at 6/8. */
function gifSize(buf: Buffer): ImageInfo | null {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/**
 * JPEG: walk the marker segments to the start-of-frame.
 *
 * Bounded by the buffer length and by an explicit iteration cap — a malformed
 * file with a zero-length segment would otherwise spin forever, which is its own
 * denial of service.
 */
function jpegSize(buf: Buffer): ImageInfo | null {
  let offset = 2; // skip SOI
  let guard = 0;
  while (offset + 9 < buf.length && guard++ < 1000) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];

    // SOF0..SOF15, excluding the non-frame markers DHT(c4), JPG(c8), DAC(cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null; // malformed; refuse rather than loop
    offset += 2 + segmentLength;
  }
  return null;
}

/** WebP: VP8 / VP8L / VP8X, each storing dimensions differently. */
function webpSize(buf: Buffer): ImageInfo | null {
  if (buf.length < 30) return null;
  const fourcc = buf.toString("ascii", 12, 16);
  if (fourcc === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
    const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

/**
 * Read and bound-check an image's dimensions.
 *
 * A header we cannot parse is a REJECTION, not a pass. An image whose dimensions
 * are unreadable is either corrupt or crafted, and neither should be stored for
 * something downstream to decode.
 */
export function checkImage(mime: string, head: Buffer): ImageCheckResult {
  let info: ImageInfo | null = null;
  switch (mime) {
    case "image/png":  info = pngSize(head);  break;
    case "image/jpeg": info = jpegSize(head); break;
    case "image/gif":  info = gifSize(head);  break;
    case "image/webp": info = webpSize(head); break;
    default: return { ok: true }; // not an image; nothing to check here
  }

  if (!info || !Number.isFinite(info.width) || !Number.isFinite(info.height)) {
    return { ok: false, reason: "The image could not be read. It may be corrupt." };
  }
  if (info.width <= 0 || info.height <= 0) {
    return { ok: false, reason: "The image reports invalid dimensions." };
  }
  if (info.width > MAX_IMAGE_DIMENSION || info.height > MAX_IMAGE_DIMENSION) {
    return {
      ok: false,
      reason: `The image is too large: ${info.width}×${info.height}. The maximum is ${MAX_IMAGE_DIMENSION} pixels on a side.`,
    };
  }
  if (info.width * info.height > MAX_IMAGE_PIXELS) {
    return {
      ok: false,
      reason: `The image has too many pixels (${(info.width * info.height / 1e6).toFixed(1)} MP). The maximum is ${MAX_IMAGE_PIXELS / 1e6} MP.`,
    };
  }
  return { ok: true, info };
}
