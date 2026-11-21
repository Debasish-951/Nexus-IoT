import type * as THREE from "three";
import type { TagDef } from "./kit";

export type Status = "ok" | "warn" | "crit" | "off" | "nolink";

/** Per-frame animation of one machine, driven by its current readings. */
export type Updater = (dt: number, t: number, it: Item) => void;

export interface ParamDef { l: string; v: any; min?: number; max?: number; step?: number; opts?: string[] }

export interface ModelDef {
  fam: string;
  name: string;
  /** Prefix for generated names, e.g. "P" → P-101. */
  pre: string;
  hidden?: boolean;
  params: Record<string, ParamDef>;
  tags: (p: any, it?: any) => TagDef[];
  /** Which reading the floating label shows. Defaults to the first. */
  main?: (p: any) => string;
  /** [part, behaviour, reading key]; a key ending in "*" means a numbered set (zones). */
  binds: (p: any, it?: any) => string[][];
  /** Demo values per plant-wide scenario this model reacts to: scenario → reading key → value. */
  scen?: (p: any) => Partial<Record<string, Record<string, number>>>;
  build: (p: any, g: THREE.Group, it: any) => Updater | void;
}

/** One machine on the floor, as saved in the scene. */
export interface ItemSpec {
  id: string;
  type: string;
  name: string;
  x: number;
  z: number;
  rot: number;
  params: Record<string, any>;
  area: string;
  sub: string;
  /** Asset whose telemetry drives this machine. */
  assetId?: string | null;
  /** Reading key → metric on that asset. */
  bind?: Record<string, string>;
  /** Demo mode only. */
  running?: boolean;
  fault?: boolean;
  /** Uploaded .glb model: id in the upload store (GET /api/uploads/:id/content). */
  glbId?: string;
  /** Uploaded .glb model: which part moves with which reading. */
  gb?: { mesh: string; beh: string; k: string }[];
  /** Uploaded .glb model: readings pinned onto parts of the model. */
  gp?: { mesh: string; k: string }[];
}

/** A machine at runtime: the saved spec plus its 3D objects and current values. */
export interface Item extends ItemSpec {
  running: boolean;
  fault: boolean;
  bind: Record<string, string>;
  r: Record<string, number>;
  /** Reading keys that have a live value right now. */
  live: Set<string>;
  tags: TagDef[];
  mainKey: string;
  status: Status;
  update: Updater | null;
  root: THREE.Group;
  inner: THREE.Group;
  ringM: THREE.MeshBasicMaterial;
  selRing: THREE.Mesh;
  beaconM: THREE.MeshStandardMaterial;
  pin: HTMLDivElement;
  cx: number; cz: number; top: number; w: number; d: number; rad: number;
  feeds?: string[];
  feedMed?: string;
  /** Uploaded .glb models: the parsed model, its scale to about 3 m, and its part names. */
  glbObj?: THREE.Object3D;
  glbK?: number;
  glbNames?: string[];
}

export interface AreaState {
  id: string;
  name: string;
  out: string;
  med: string;
  util: boolean;
  color: number;
  enabled: boolean;
  subs: { name: string; enabled: boolean }[];
  rect?: { x0: number; x1: number; z0: number; z1: number; cx: number; cz: number; w: number; d: number } | null;
}

export interface ConnSpec { id: string; a: string; b: string; medium: string }

/** What is stored in plant_twins.scene. */
export interface SceneDoc {
  version: 1;
  pack: string;
  demo: boolean;
  areas: { id: string; name: string; out: string; med: string; util: boolean; enabled: boolean; subs: { name: string; enabled: boolean }[] }[];
  flows: [string, string, string][];
  items: ItemSpec[];
  conns: { a: string; b: string; medium: string }[];
}
