/**
 * PNG snapshots of a twin. 3D views pass their WebGL canvas (the renderer must
 * draw a frame right before, or use preserveDrawingBuffer); 2D views pass their
 * SVG or a container with an <img> and an overlay SVG.
 */
function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url; a.download = `${name.replace(/[^\w.-]+/g, "_") || "twin"}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

export function snapshotCanvas(canvas: HTMLCanvasElement, name: string) {
  download(canvas.toDataURL("image/png"), `${name}-${stamp()}`);
}

/** Draws an SVG element (with computed size) onto a canvas, over an optional background image. */
export async function snapshotSvg(svg: SVGSVGElement, name: string, opts: { background?: string; bg?: string } = {}) {
  const box = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width)), h = Math.max(1, Math.round(box.height));
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = w * scale; canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = opts.bg ?? getComputedStyle(document.body).backgroundColor ?? "#0b0f17";
  ctx.fillRect(0, 0, w, h);
  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  if (opts.background) { try { ctx.drawImage(await load(opts.background), 0, 0, w, h); } catch { /* background skipped */ } }
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w)); clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Inline the computed text colour so currentColor survives outside the page.
  clone.style.color = getComputedStyle(svg).color;
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try { ctx.drawImage(await load(url), 0, 0, w, h); } finally { URL.revokeObjectURL(url); }
  download(canvas.toDataURL("image/png"), `${name}-${stamp()}`);
}
