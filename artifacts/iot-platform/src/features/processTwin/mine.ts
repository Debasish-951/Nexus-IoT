import { sanitizeSvg } from "@/features/imageTwin/sanitize";
import { loadImage } from "@/features/imageTwin/background";
import type { MineSym } from "./symbols";

/**
 * "My symbols": the user's own drawings (SVG) or pictures (PNG, JPEG, WebP, GIF)
 * used as symbols. An SVG is cleaned by the same allow-list sanitiser as the 2D
 * twin; a picture is scaled down to at most 256 px. Each one is stored inside
 * the diagram that uses it, and also kept in this browser's library so it can be
 * reused in other diagrams.
 */
const LIB_KEY = "process-twin:my-symbols";
export const MAX_SVG_BYTES = 200_000;
export const MAX_IMAGE_BYTES = 3_000_000;
/** Total size of uploaded symbols in one diagram (the API accepts about 1 MB per twin). */
export const MAX_SCENE_SYMBOLS = 600_000;

const valid = (m: unknown): m is MineSym => {
  const x = m as MineSym;
  return !!x && typeof x.id === "string" && typeof x.name === "string" && typeof x.src === "string" && /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/.test(x.src) && Number.isFinite(x.w) && Number.isFinite(x.h);
};
export function loadLibrary(): MineSym[] {
  try { const v = JSON.parse(localStorage.getItem(LIB_KEY) ?? "[]"); return Array.isArray(v) ? v.filter(valid) : []; } catch { return []; }
}
/** False when the browser refuses (storage full or blocked); the symbol still works in the diagram. */
export function saveLibrary(list: MineSym[]): boolean {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

const fit = (w: number, h: number, max = 120) => { const k = max / Math.max(w, h, 1); return { w: Math.max(10, Math.round(w * k)), h: Math.max(10, Math.round(h * k)) }; };

export type MineError = "type" | "svgSize" | "imageSize" | "bad";
export class MineFileError extends Error { constructor(public code: MineError, msg?: string) { super(msg ?? code); } }

export async function mineFromFile(file: File): Promise<{ src: string; w: number; h: number }> {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (isSvg) {
    if (file.size > MAX_SVG_BYTES) throw new MineFileError("svgSize");
    let r: { svg: string; w: number; h: number };
    try { r = sanitizeSvg(await file.text()); } catch (e: any) { throw new MineFileError("bad", e?.message); }
    const bytes = new TextEncoder().encode(r.svg); let bin = ""; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return { src: `data:image/svg+xml;base64,${btoa(bin)}`, ...fit(r.w || 100, r.h || 100) };
  }
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new MineFileError("type");
  if (file.size > MAX_IMAGE_BYTES) throw new MineFileError("imageSize");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url).catch(() => { throw new MineFileError("bad"); });
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.min(1, 256 / Math.max(w, h, 1));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL("image/png"), ...fit(w, h) };
  } finally { URL.revokeObjectURL(url); }
}
