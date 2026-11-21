import * as THREE from "three";
import { useEffect, useState } from "react";
import { MODELS } from "./models";

/**
 * Library thumbnails: each machine model rendered once, off screen, to a small
 * PNG for the tile grid of the Add twin library. One shared renderer draws one
 * model per animation frame (so opening the library never freezes the page), and
 * results are kept in memory for the rest of the session.
 */
const W = 160, H = 112;
const cache = new Map<string, string>();
const waiting = new Map<string, Set<(url: string) => void>>();
const queue: string[] = [];
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let busy = false;
let broken = false;

function setup() {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(2);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x334155, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(6, 10, 8); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fb7ff, 0.45); fill.position.set(-8, 4, -6); scene.add(fill);
  camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 2000);
}

function defaults(type: string) {
  return Object.fromEntries(Object.entries(MODELS[type].params).map(([k, d]) => [k, (d as { v: unknown }).v]));
}

function renderOne(type: string): string {
  if (!renderer) setup();
  const md = MODELS[type];
  const g = new THREE.Group();
  const params = defaults(type);
  const it: any = { id: `thumb-${type}`, type, name: md.pre ?? "", params, bind: {}, vals: {}, x: 0, z: 0, rot: 0 };
  let update: any = null;
  try { update = md.build(params, g, it); } catch { /* drawn with whatever was built */ }
  try { if (typeof update === "function") update(0.016, 1, it); } catch { /* resting pose */ }
  scene!.add(g);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3();
  g.traverse((o: any) => { if (o.isMesh && !o.userData?.fx && o.geometry) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 0.3);
  const dist = r / Math.sin((camera!.fov * Math.PI) / 360) * 0.95;
  const dir = new THREE.Vector3(1, 0.75, 1.15).normalize();
  camera!.position.copy(c).addScaledVector(dir, dist);
  camera!.near = dist / 100; camera!.far = dist * 10; camera!.updateProjectionMatrix();
  camera!.lookAt(c);
  renderer!.render(scene!, camera!);
  const url = renderer!.domElement.toDataURL("image/png");
  scene!.remove(g);
  g.traverse((o: any) => { o.geometry?.dispose?.(); });
  return url;
}

function pump() {
  if (busy) return;
  busy = true;
  requestAnimationFrame(() => {
    const type = queue.shift();
    if (type && !cache.has(type)) {
      let url = "";
      try { url = broken ? "" : renderOne(type); } catch { broken = true; }
      cache.set(type, url);
      waiting.get(type)?.forEach((f) => f(url));
      waiting.delete(type);
    }
    busy = false;
    if (queue.length) pump();
  });
}

function request(type: string, done: (url: string) => void) {
  const hit = cache.get(type);
  if (hit !== undefined) { done(hit); return () => {}; }
  let set = waiting.get(type);
  if (!set) { set = new Set(); waiting.set(type, set); queue.push(type); }
  set.add(done);
  pump();
  return () => { set!.delete(done); };
}

/** Thumbnail data URL for a model, or "" while rendering / when WebGL is not available. */
export function useModelThumb(type: string): string {
  const [url, setUrl] = useState(() => cache.get(type) ?? "");
  useEffect(() => {
    if (!MODELS[type]) return;
    return request(type, setUrl);
  }, [type]);
  return url;
}
