import { sanitizeSvg, type Part } from "./sanitize";
import { chunk, MAX_BYTES, type ImageScene } from "./types";

/**
 * Turns a file or URL into the background of a 2D twin.
 *
 * - SVG: sanitised (see sanitize.ts) and stored as text.
 * - Any other image the browser can decode (PNG, JPEG, GIF, WebP, BMP, AVIF,
 *   ICO, …): drawn onto a canvas, scaled to at most 2400 px on the long side and
 *   re-encoded as WebP (JPEG where WebP encoding is unavailable). Animated GIFs
 *   keep their first frame.
 * - URL: stored as is; the image is loaded only to learn its size. An external
 *   URL may be blocked by the server's Content-Security-Policy.
 */
export type Background = Pick<ImageScene, "w" | "h" | "svg" | "image" | "url"> & { parts?: Part[] };

const isSvgFile = (f: File) => f.type === "image/svg+xml" || /\.svgz?$/i.test(f.name);

export async function backgroundFromFile(file: File): Promise<Background> {
  if (isSvgFile(file)) {
    if (/\.svgz$/i.test(file.name)) throw new Error("Compressed SVG (.svgz) is not supported. Save the drawing as plain .svg.");
    const text = await file.text();
    if (text.length > MAX_BYTES * 2) throw new Error("This SVG is larger than 1.8 MB. Simplify the drawing or export it without embedded images.");
    const r = sanitizeSvg(text);
    if (r.svg.length > MAX_BYTES) throw new Error(`After cleaning, the drawing is ${Math.round(r.svg.length / 1024)} KB; the limit is ${Math.round(MAX_BYTES / 1024)} KB. Remove embedded images or simplify paths.`);
    return { w: r.w, h: r.h, svg: { chunks: chunk(r.svg) }, image: undefined, url: undefined, parts: r.parts };
  }
  const head = await file.slice(0, 512).text().catch(() => "");
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return backgroundFromFile(new File([file], file.name.replace(/\.[^.]*$/, "") + ".svg", { type: "image/svg+xml" }));
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url).catch(() => { throw new Error("This browser cannot open that file as an image. Use SVG, PNG, JPEG, GIF, WebP, BMP or AVIF."); });
    return encodeRaster(img);
  } finally { URL.revokeObjectURL(url); }
}

export async function backgroundFromUrl(raw: string): Promise<Background> {
  const url = raw.trim();
  if (!/^(https?:\/\/|\/|data:image\/(png|jpe?g|gif|webp|bmp|avif);)/i.test(url)) throw new Error("Use an http(s) address, a path on this server, or a data:image URL.");
  if (/^data:/i.test(url)) {
    const img = await loadImage(url).catch(() => { throw new Error("That data URL is not an image the browser can open."); });
    return encodeRaster(img);
  }
  const img = await loadImage(url).catch(() => { throw new Error("The image could not be loaded from that address (it may not exist, or this server's security policy blocks it)."); });
  return { w: img.naturalWidth || 1000, h: img.naturalHeight || 750, url, svg: undefined, image: undefined };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = () => rej(new Error("load")); i.src = src; });
}

function encodeRaster(img: HTMLImageElement): Background {
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("The image has no size.");
  const attempts: [number, number][] = [[2400, 0.86], [2400, 0.72], [1800, 0.72], [1400, 0.65]];
  for (const [max, q] of attempts) {
    const s = Math.min(1, max / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    c.getContext("2d")!.drawImage(img, 0, 0, cw, ch);
    let data = c.toDataURL("image/webp", q);
    let type = "image/webp";
    if (!data.startsWith("data:image/webp")) { data = c.toDataURL("image/jpeg", q); type = "image/jpeg"; }
    if (data.length <= MAX_BYTES) return { w: cw, h: ch, image: { chunks: chunk(data), type }, svg: undefined, url: undefined };
  }
  throw new Error(`The image is still larger than ${Math.round(MAX_BYTES / 1024)} KB after compression. Crop it or use a simpler drawing.`);
}
