/**
 * SVG sanitiser for the 2D twin.
 *
 * A drawing comes from a user and is inserted into the page as live SVG (so its
 * parts can be coloured, filled and rotated), which makes it script-capable
 * markup. It is therefore cleaned with an ALLOW-list, both when it is imported
 * and every time it is rendered (the stored text is never trusted):
 *
 * - only presentation elements survive; anything else is dropped with its
 *   children (script, foreignObject, iframe, style, animate, set, metadata, …);
 *   <a> is unwrapped (its children kept, the link dropped)
 * - only presentation and geometry attributes survive; every on* handler goes
 * - href / xlink:href only as "#id" (use, textPath, gradients, patterns,
 *   filters) or, on <image>, a data:image/png|jpeg|webp URL
 * - url(…) only as url(#id); values or styles with javascript:, expression(),
 *   @import, behavior or -moz-binding are dropped. Both checks also run on the
 *   value with CSS escapes decoded, and image-set() and the other fetching
 *   functions are refused (cssUrl.ts)
 * - every id is prefixed, and references rewritten, so a drawing cannot clash
 *   with ids of the page or of a second twin on the same page
 *
 * It uses only basic DOM calls (childNodes, attributes, getAttribute, …) so it
 * runs the same in the browser and in a node test with @xmldom/xmldom.
 */
import { cssUrlsOk, decodeCssEscapes } from "./cssUrl";

export interface Part {
  /** Stable reference: the element's own id, or a generated `part-N` for a labelled element without one. */
  ref: string;
  /** Display name: Inkscape label, data-name, or the id. */
  name: string;
  /** Element name, e.g. path, g, rect. */
  tag: string;
}

export interface SanitizeResult { root: Element; parts: Part[]; w: number; h: number }

const SVG_NS = "http://www.w3.org/2000/svg";

const ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textpath",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "symbol", "use", "title", "desc",
  "marker", "image",
  "filter", "fegaussianblur", "feoffset", "feblend", "fecolormatrix", "fecomposite", "feflood", "femerge", "femergenode",
  "fedropshadow", "femorphology", "feturbulence", "fedisplacementmap", "fecomponenttransfer", "fefunca", "fefuncr",
  "fefuncg", "fefuncb", "fetile", "fespecularlighting", "fediffuselighting", "fepointlight", "fedistantlight",
  "fespotlight", "feconvolvematrix",
]);
/** Children of these are definitions, not visible parts. */
const DEFS = new Set(["defs", "lineargradient", "radialgradient", "clippath", "mask", "pattern", "symbol", "marker", "filter", "title", "desc"]);
/** Elements whose href may point inside the drawing. */
const HREF_LOCAL = new Set(["use", "textpath", "lineargradient", "radialgradient", "pattern", "filter"]);

const ATTRS = new Set([
  "id", "class", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points", "transform",
  "viewbox", "preserveaspectratio", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity", "visibility",
  "display", "font-family", "font-size", "font-weight", "font-style", "font-variant", "text-anchor", "dominant-baseline",
  "alignment-baseline", "baseline-shift", "letter-spacing", "word-spacing", "text-decoration", "gradientunits",
  "gradienttransform", "spreadmethod", "offset", "stop-color", "stop-opacity", "fx", "fy", "fr", "clip-path", "clip-rule",
  "clippathunits", "mask", "maskunits", "maskcontentunits", "patternunits", "patterncontentunits", "patterntransform",
  "marker-start", "marker-mid", "marker-end", "markerwidth", "markerheight", "markerunits", "refx", "refy", "orient",
  "style", "dx", "dy", "rotate", "textlength", "lengthadjust", "filter", "filterunits", "primitiveunits", "in", "in2",
  "result", "stddeviation", "mode", "operator", "k1", "k2", "k3", "k4", "values", "type", "flood-color", "flood-opacity",
  "color", "color-interpolation", "color-interpolation-filters", "basefrequency", "numoctaves", "seed", "stitchtiles",
  "scale", "xchannelselector", "ychannelselector", "tablevalues", "slope", "intercept", "amplitude", "exponent", "radius",
  "kernelmatrix", "order", "surfacescale", "specularconstant", "specularexponent", "diffuseconstant", "lighting-color",
  "azimuth", "elevation", "pointsatx", "pointsaty", "pointsatz", "limitingconeangle", "z", "href", "xlink:href",
  "data-name", "vector-effect", "paint-order", "shape-rendering", "text-rendering", "image-rendering", "mix-blend-mode",
  "isolation", "writing-mode", "startoffset", "method", "spacing", "side", "pathlength", "xml:space", "xmlns", "xmlns:xlink",
  "version",
]);
/** Attributes that may carry url(…). */
const URL_ATTRS = new Set(["fill", "stroke", "clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end"]);

const BAD_VALUE = /javascript:|vbscript:|expression\s*\(|@import|behavior\s*:|-moz-binding|data:text\/html/i;
const RASTER_DATA = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i;
/** Ids editors give every element (path123, g45, layer1, …): not parts unless asked. */
const AUTO_ID = /^(path|rect|circle|ellipse|line|polyline|polygon|g|text|tspan|layer|svg|defs|use|image|stop|lineargradient|radialgradient|clippath|mask|pattern|filter|metadata|namedview|group|shape|object|vector|surface)[-_]?\d+(-\d+)?$/i;

const rewriteUrls = (v: string, p: string) => v.replace(/url\(\s*(['"]?)#([^)'"]*)\1\s*\)/gi, (_s, _q, id) => `url(#${p}${id})`);

function num(v: string | null): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 && !/%$/.test(v.trim()) ? n : null;
}

export interface SanitizeOptions {
  /** Prefix for every id; defaults to "s-". */
  prefix?: string;
  /** Also list elements whose ids look auto-generated (path123, g45). */
  allIds?: boolean;
  /** A DOMParser; the browser's by default (pass @xmldom/xmldom's in node). */
  parser?: { parseFromString(text: string, type: string): Document };
}

/**
 * Parse and clean SVG text. Returns the cleaned root element (owned by a
 * separate document: import it before inserting), the mappable parts and the
 * drawing size. Throws with a readable message when the text is not SVG.
 */
export function sanitizeSvgDocument(text: string, opts: SanitizeOptions = {}): SanitizeResult {
  const prefix = opts.prefix ?? "s-";
  const parser = opts.parser ?? new DOMParser();
  // DOCTYPE / entity declarations are refused outright (entity expansion).
  if (/<!DOCTYPE[^>]*\[|<!ENTITY/i.test(text)) throw new Error("The SVG declares entities, which are not accepted.");
  const doc = parser.parseFromString(text.replace(/<!DOCTYPE[^>]*>/gi, ""), "image/svg+xml");
  const root = doc.documentElement as Element | null;
  if (!root || lname(root) !== "svg" || doc.getElementsByTagName("parsererror").length) throw new Error("This file is not a valid SVG drawing.");

  const parts: Part[] = [];
  const usedRefs = new Set<string>();
  let gen = 0;

  const clean = (el: Element, inDefs: boolean) => {
    const name = lname(el);
    // attributes
    const label = el.getAttribute("inkscape:label") || el.getAttribute("data-name") || el.getAttribute("data-label") || "";
    const attrs: { name: string; value: string }[] = [];
    for (let i = 0; i < el.attributes.length; i++) { const a = el.attributes[i]; attrs.push({ name: a.name, value: a.value }); }
    for (const a of attrs) {
      const n = a.name.toLowerCase();
      let keep = ATTRS.has(n) && !n.startsWith("on") && !BAD_VALUE.test(a.value) && !BAD_VALUE.test(decodeCssEscapes(a.value));
      if (keep && (n === "href" || n === "xlink:href")) {
        const v = a.value.trim();
        keep = (HREF_LOCAL.has(name) && v.startsWith("#")) || (name === "image" && RASTER_DATA.test(v));
        if (keep && v.startsWith("#")) { el.setAttribute(a.name, `#${prefix}${v.slice(1)}`); continue; }
      }
      // Every value that CSS reads is checked, not only those with a literal "url(":
      // escapes (u\72l) and image-set() do not contain one.
      if (keep && (URL_ATTRS.has(n) || n === "style")) {
        keep = cssUrlsOk(a.value);
        if (keep && /url\(/i.test(a.value)) { el.setAttribute(a.name, rewriteUrls(a.value, prefix)); continue; }
      }
      if (!keep) el.removeAttribute(a.name);
    }
    if (name === "image" && !el.getAttribute("href") && !el.getAttribute("xlink:href")) { el.parentNode?.removeChild(el); return; }

    // part?
    const id = el.getAttribute("id");
    if (el !== root && !inDefs && (label || (id && (opts.allIds || !AUTO_ID.test(id))))) {
      let ref = id || "";
      if (!ref) { do ref = `part-${++gen}`; while (usedRefs.has(ref)); }
      if (!usedRefs.has(ref)) {
        usedRefs.add(ref);
        parts.push({ ref, name: (label || id || ref).trim().slice(0, 120), tag: name });
        el.setAttribute("data-part", ref);
      }
      if (!id) el.setAttribute("id", ref);
    }
    if (label) el.setAttribute("data-name", label.slice(0, 120));
    const finalId = el.getAttribute("id");
    if (finalId) el.setAttribute("id", prefix + finalId);

    // children
    const kids: Node[] = [];
    for (let i = 0; i < el.childNodes.length; i++) kids.push(el.childNodes[i]);
    for (const k of kids) {
      if (k.nodeType === 3) continue;                       // text
      if (k.nodeType !== 1) { el.removeChild(k); continue; } // comments, PIs, CDATA
      const c = k as Element;
      const cn = lname(c);
      if (cn === "a") {                                     // unwrap links
        const g = doc.createElementNS(SVG_NS, "g");
        while (c.firstChild) g.appendChild(c.firstChild);
        el.replaceChild(g, c);
        clean(g, inDefs);
        continue;
      }
      if (!ELEMENTS.has(cn) || (c.namespaceURI && c.namespaceURI !== SVG_NS)) { el.removeChild(c); continue; }
      clean(c, inDefs || DEFS.has(cn));
    }
  };
  clean(root, false);

  // Size: viewBox first, then width/height, then a default.
  let w = 0, h = 0;
  const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
  else {
    w = num(root.getAttribute("width")) ?? 1000; h = num(root.getAttribute("height")) ?? 750;
    root.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  root.setAttribute("width", String(w)); root.setAttribute("height", String(h));
  root.setAttribute("x", "0"); root.setAttribute("y", "0");
  return { root, parts, w, h };
}

/** Cleaned SVG as text, its parts and size (what is stored with the twin). */
export function sanitizeSvg(text: string, opts: SanitizeOptions & { serializer?: { serializeToString(n: Node): string } } = {}): { svg: string; parts: Part[]; w: number; h: number } {
  const r = sanitizeSvgDocument(text, { ...opts, prefix: "" });
  const ser = opts.serializer ?? new XMLSerializer();
  return { svg: ser.serializeToString(r.root), parts: r.parts, w: r.w, h: r.h };
}

function lname(el: Element): string { return (el.localName || el.nodeName || "").replace(/^.*:/, "").toLowerCase(); }
