import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./sitesMap.css";
import { feature } from "topojson-client";
import { STATUS_COLOR, type SiteStatus, type SiteView } from "./useSites";

/**
 * The Leaflet map behind the Live Twin map view and the Sites map widget.
 *
 * Base layer: world country outlines from world-atlas (Natural Earth 1:50m),
 * bundled with the app, so the map works with no internet and under the
 * production CSP (img-src 'self' data: blob:). Optional street tiles come from
 * OpenStreetMap; they need internet and `https://tile.openstreetmap.org` in the
 * CSP's img-src. If they fail to load, the outlines stay and `onStreetFail` fires.
 *
 * Markers are divIcons (HTML, no image files). Markers closer than 32 px at the
 * current zoom are grouped into one numbered circle; clicking it zooms in.
 */
const RANK: Record<SiteStatus, number> = { crit: 0, warn: 1, ok: 2, idle: 3 };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

let worldPromise: Promise<GeoJSON.FeatureCollection> | null = null;
function loadWorld() {
  worldPromise ??= import("world-atlas/countries-50m.json").then((m) => {
    const topo = ((m as any).default ?? m) as any;
    return feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection;
  });
  return worldPromise;
}

export function MapCanvas({ sites, selectedId, onSelect, placing, onPlace, compact, street, fitKey, onStreetFail }: {
  sites: SiteView[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  placing?: boolean;
  onPlace?: (lat: number, lng: number) => void;
  compact?: boolean;
  street?: boolean;
  /** Change to fit the map to all placed sites again. */
  fitKey?: number;
  onStreetFail?: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const cb = useRef({ onSelect, onPlace, placing, onStreetFail });
  cb.current = { onSelect, onPlace, placing, onStreetFail };
  const sitesRef = useRef(sites); sitesRef.current = sites;
  const selRef = useRef(selectedId); selRef.current = selectedId;
  const fitted = useRef(false);

  // Create the map once.
  useEffect(() => {
    const map = L.map(el.current!, {
      center: [20, 10], zoom: 2, minZoom: 1, maxZoom: 18, worldCopyJump: true,
      zoomControl: !compact, attributionControl: true, preferCanvas: false,
    });
    map.attributionControl.setPrefix(false);
    mapRef.current = map;
    markers.current = L.layerGroup().addTo(map);
    let alive = true;
    // Latitude / longitude lines every 30 degrees, so the empty ocean still reads as a world map.
    const lines: [number, number][][] = [];
    for (let lat = -60; lat <= 60; lat += 30) { const row: [number, number][] = []; for (let lng = -180; lng <= 180; lng += 5) row.push([lat, lng]); lines.push(row); }
    for (let lng = -180; lng <= 180; lng += 30) lines.push([[-85, lng], [85, lng]]);
    L.polyline(lines, { interactive: false, className: "sm-graticule" }).addTo(map);
    loadWorld().then((world) => {
      if (!alive) return;
      L.geoJSON(world, {
        style: () => ({ className: "sm-land" }),
        onEachFeature: (feat, layer) => {
          const name = (feat.properties as { name?: string } | null)?.name;
          if (name) layer.bindTooltip(esc(name), { sticky: true, direction: "top", className: "sm-country-tip" });
        },
      }).addTo(map);
      map.attributionControl.addAttribution("Natural Earth");
    }).catch(() => { /* outlines unavailable: markers still show */ });
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (cb.current.placing) cb.current.onPlace?.(e.latlng.lat, ((e.latlng.lng + 540) % 360) - 180);
      else cb.current.onSelect?.(null);
    });
    map.on("zoomend", () => draw());
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current!);
    return () => { alive = false; ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Street tiles on demand.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!street) { tiles.current?.remove(); tiles.current = null; return; }
    let loaded = 0, failed = 0;
    const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
    });
    layer.on("tileload", () => { loaded++; });
    layer.on("tileerror", () => {
      failed++;
      if (failed >= 4 && loaded === 0) { layer.remove(); if (tiles.current === layer) tiles.current = null; cb.current.onStreetFail?.(); }
    });
    layer.addTo(map); tiles.current = layer;
    return () => { layer.remove(); if (tiles.current === layer) tiles.current = null; };
  }, [street]);

  function draw() {
    const map = mapRef.current, group = markers.current;
    if (!map || !group) return;
    group.clearLayers();
    const placed = sitesRef.current.filter((s) => s.placed);
    // Greedy grouping by screen distance, most urgent site first.
    const pts = placed.map((s) => ({ s, p: map.latLngToLayerPoint([s.latitude!, s.longitude!]) }))
      .sort((a, b) => RANK[a.s.status] - RANK[b.s.status]);
    const used = new Set<string>();
    for (const a of pts) {
      if (used.has(a.s.projectId)) continue;
      const near = pts.filter((b) => !used.has(b.s.projectId) && b.p.distanceTo(a.p) < 32);
      near.forEach((b) => used.add(b.s.projectId));
      const colour = STATUS_COLOR[a.s.status];
      if (near.length > 1 && !near.some((b) => b.s.projectId === selRef.current)) {
        const bounds = L.latLngBounds(near.map((b) => [b.s.latitude!, b.s.longitude!] as [number, number]));
        const m = L.marker([a.s.latitude!, a.s.longitude!], {
          icon: L.divIcon({ className: "sm-marker", iconSize: [0, 0], html: `<div class="sm-cluster" style="--sm-c:${colour}" title="${near.length}">${near.length}</div>` }),
          keyboard: true, title: near.map((b) => b.s.name).join(", "),
        });
        m.on("click", () => map.fitBounds(bounds.pad(0.5), { maxZoom: Math.min(map.getZoom() + 4, 16) }));
        group.addLayer(m);
        continue;
      }
      for (const b of near) {
        const s = b.s, sel = s.projectId === selRef.current;
        const m = L.marker([s.latitude!, s.longitude!], {
          icon: L.divIcon({
            className: "sm-marker", iconSize: [0, 0],
            html: `<div class="sm-pin sm-${s.status}${sel ? " sm-sel" : ""}" style="--sm-c:${STATUS_COLOR[s.status]}"><span class="sm-dot"></span><span class="sm-label">${esc(s.name)}</span></div>`,
          }),
          keyboard: true, title: s.name, zIndexOffset: sel ? 1000 : (3 - RANK[s.status]) * 100,
        });
        m.on("click", (e) => { L.DomEvent.stopPropagation(e); cb.current.onSelect?.(s.projectId); });
        group.addLayer(m);
      }
    }
  }

  useEffect(() => { draw(); }, [sites, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit to all placed sites on first data and whenever fitKey changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const placed = sites.filter((s) => s.placed);
    if (!placed.length) return;
    if (fitted.current && fitKey === undefined) return;
    fitted.current = true;
    if (placed.length === 1) map.setView([placed[0].latitude!, placed[0].longitude!], 8);
    else map.fitBounds(L.latLngBounds(placed.map((s) => [s.latitude!, s.longitude!] as [number, number])).pad(0.25), { maxZoom: 10 });
  }, [fitKey, sites.filter((s) => s.placed).length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pan to a newly selected site if it is off screen.
  useEffect(() => {
    const map = mapRef.current, s = sites.find((x) => x.projectId === selectedId);
    if (!map || !s?.placed) return;
    const ll = L.latLng(s.latitude!, s.longitude!);
    if (!map.getBounds().pad(-0.1).contains(ll)) map.panTo(ll);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={`sm-map h-full w-full ${placing ? "sm-placing" : ""} ${compact ? "sm-compact" : ""}`} role="application" aria-label="Sites map" />;
}
