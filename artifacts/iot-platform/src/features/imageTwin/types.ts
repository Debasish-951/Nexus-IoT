/**
 * Scene document of a 2D twin (plant_twins.scene with kind "image").
 *
 * The background is either a sanitised SVG drawing or a raster image, both
 * stored as text split into chunks (the API refuses JSON strings over 100 000
 * characters), or an external image URL. `items` are the mapped elements: SVG
 * parts (by element id), drawn regions and point pins. Region coordinates are
 * percentages of the background, so they survive any display size.
 */
export type Behaviour = "value" | "status" | "fill" | "scale" | "rotate" | "blink" | "visible" | "text";
export type ItemKind = "part" | "rect" | "ellipse" | "polygon" | "point";

export interface TextRule { v: number; text: string }

export interface TwinItem {
  id: string;
  kind: ItemKind;
  /** SVG element reference (kind "part"). */
  ref?: string;
  name: string;
  /** rect / ellipse: x, y, w, h in %; polygon: points in %; point: x, y in %. */
  x?: number; y?: number; w?: number; h?: number;
  pts?: [number, number][];
  /** Value label offset from the item centre, in %. */
  lx?: number; ly?: number;
  assetId?: string;
  metric?: string;
  behaviours: Behaviour[];
  unit?: string;
  decimals?: number;
  /** Manual limits; alarm rules on the same asset + metric win when present. */
  warn?: number; crit?: number; low?: number; lowCrit?: number;
  /** Range for fill level and colour scale. */
  min?: number; max?: number;
  /** Show/hide: shown when value > threshold (default 0). */
  threshold?: number;
  /** Rotation speed in degrees per second at `max` (default 360). */
  speed?: number;
  /** Text replace: the last rule with value >= v applies. */
  texts?: TextRule[];
  color?: string;
}

export interface ImageScene {
  version: 2;
  kind: "image";
  demo: boolean;
  /** Background size in its own units (SVG viewBox or image pixels). */
  w: number; h: number;
  svg?: { chunks: string[] };
  image?: { chunks: string[]; type: string };
  url?: string;
  items: TwinItem[];
  /** List SVG elements with auto-generated ids (path123) as parts too. */
  allIds?: boolean;
  parent?: string;
}

export const BEHAVIOURS: { k: Behaviour; label: string; hint: string }[] = [
  { k: "value", label: "Show value", hint: "Value label at the part; drag it to move it." },
  { k: "status", label: "Colour by status", hint: "Green, amber or red by the alarm limits." },
  { k: "fill", label: "Fill level", hint: "Fills the part from the bottom, min to max." },
  { k: "scale", label: "Colour scale", hint: "Blue at min to red at max." },
  { k: "rotate", label: "Rotate", hint: "Turns around its centre; faster with higher value. SVG parts only." },
  { k: "blink", label: "Blink on alarm", hint: "Blinks while the reading is in alarm." },
  { k: "visible", label: "Show / hide", hint: "Shown only while the value is above the threshold." },
  { k: "text", label: "Text replace", hint: "Shows a text for value ranges, e.g. 0 = Stopped, 1 = Running." },
];

export const CHUNK = 90_000;
export const MAX_BYTES = 900_000;
export const chunk = (s: string): string[] => { const out: string[] = []; for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK)); return out; };
export const unchunk = (c?: { chunks?: unknown }): string => (Array.isArray(c?.chunks) ? (c!.chunks as unknown[]).filter((x) => typeof x === "string").join("") : "");

export function emptyScene(): ImageScene { return { version: 2, kind: "image", demo: true, w: 1000, h: 750, items: [] }; }

/** Accepts any stored scene and returns a well-formed one. */
export function normaliseScene(s: any): ImageScene {
  const e = emptyScene();
  if (!s || typeof s !== "object") return e;
  return {
    ...e,
    demo: s.demo !== false,
    w: Number(s.w) > 0 ? Number(s.w) : e.w,
    h: Number(s.h) > 0 ? Number(s.h) : e.h,
    svg: s.svg && Array.isArray(s.svg.chunks) ? { chunks: s.svg.chunks } : undefined,
    image: s.image && Array.isArray(s.image.chunks) ? { chunks: s.image.chunks, type: String(s.image.type ?? "") } : undefined,
    url: typeof s.url === "string" ? s.url : undefined,
    items: Array.isArray(s.items) ? s.items.filter((i: any) => i && typeof i.id === "string").map((i: any) => ({ ...i, behaviours: Array.isArray(i.behaviours) ? i.behaviours : ["value"] })) : [],
    allIds: !!s.allIds,
    parent: typeof s.parent === "string" ? s.parent : undefined,
  };
}

export const newItemId = () => `i-${Math.random().toString(36).slice(2, 10)}`;
