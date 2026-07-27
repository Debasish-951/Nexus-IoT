import { useEffect, useRef, useState } from "react";
import { Pipette } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ── Color math (HSV ⇄ HEX) ──
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function normHex(v?: string): string {
  if (!v) return "#2563EB";
  let h = v.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toLowerCase()}` : "#2563EB";
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const h = normHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = hue * 60; if (hue < 0) hue += 360;
  }
  return { h: hue, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(hh: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; } else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; } else if (hh < 300) { r = x; b = c; } else { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function ColorPickerPanel({ value, onChange, presets }: { value: string; onChange: (hex: string) => void; presets?: string[] }) {
  const color = normHex(value);
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexText, setHexText] = useState(color);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Re-sync from the prop when it changes externally (preset click, reset) —
  // but skip if it already matches our HSV so dragging to black doesn't lose hue.
  useEffect(() => {
    if (hsvToHex(hsv.h, hsv.s, hsv.v).toLowerCase() !== color.toLowerCase()) {
      setHsv(hexToHsv(color));
      setHexText(color);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  function emit(next: { h: number; s: number; v: number }) {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    setHexText(hex);
    onChange(hex);
  }

  function startDrag(e: React.PointerEvent, handler: (ev: PointerEvent | React.PointerEvent) => void) {
    e.preventDefault();
    handler(e);
    const move = (ev: PointerEvent) => handler(ev);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const onSv = (ev: PointerEvent | React.PointerEvent) => {
    const rect = svRef.current!.getBoundingClientRect();
    const x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
    emit({ h: hsv.h, s: x, v: 1 - y });
  };
  const onHue = (ev: PointerEvent | React.PointerEvent) => {
    const rect = hueRef.current!.getBoundingClientRect();
    emit({ ...hsv, h: clamp((ev.clientX - rect.left) / rect.width, 0, 1) * 360 });
  };

  function applyHex(text: string) {
    setHexText(text);
    if (/^#?[0-9a-fA-F]{6}$/.test(text) || /^#?[0-9a-fA-F]{3}$/.test(text)) {
      const hx = normHex(text);
      setHsv(hexToHsv(hx));
      onChange(hx);
    }
  }

  async function pickEyeDropper() {
    const ED = (window as any).EyeDropper;
    if (!ED) return;
    try { const res = await new ED().open(); if (res?.sRGBHex) applyHex(res.sRGBHex); } catch { /* cancelled */ }
  }

  const hueColor = `hsl(${hsv.h}, 100%, 50%)`;
  const supportsEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

  return (
    <div className="space-y-2.5 select-none">
      {/* Saturation / Value area */}
      <div
        ref={svRef}
        onPointerDown={(e) => startDrag(e, onSv)}
        className="relative w-full h-32 rounded-md cursor-crosshair"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueColor}` }}
      >
        <div
          className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow ring-1 ring-black/30 pointer-events-none"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv.h, hsv.s, hsv.v) }}
        />
      </div>

      <div className="flex items-center gap-2">
        {supportsEyeDropper && (
          <button onClick={pickEyeDropper} title="Pick from screen" className="shrink-0 p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground">
            <Pipette className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Hue slider */}
        <div
          ref={hueRef}
          onPointerDown={(e) => startDrag(e, onHue)}
          className="relative flex-1 h-3 rounded-full cursor-pointer"
          style={{ background: "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)" }}
        >
          <div className="absolute top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30 pointer-events-none"
            style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }} />
        </div>
      </div>

      {/* HEX input */}
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md border border-border shrink-0" style={{ background: color }} />
        <Input value={hexText} onChange={(e) => applyHex(e.target.value)} className="h-8 text-sm font-mono uppercase" placeholder="#RRGGBB" />
      </div>

      {/* Quick presets */}
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
          {presets.map((p) => (
            <button key={p} onClick={() => applyHex(p)} className={cn("w-5 h-5 rounded-full border-2", color.toLowerCase() === normHex(p).toLowerCase() ? "border-foreground" : "border-transparent")} style={{ background: p }} />
          ))}
        </div>
      )}
    </div>
  );
}

// Trigger + popover wrapper — a swatch showing the current color + its hex,
// opening the full gradient/hue/hex picker (matching a native color-picker UX).
export function ColorField({ value, onChange, presets }: { value?: string; onChange: (hex: string) => void; presets?: string[] }) {
  const color = normHex(value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 w-full h-8 px-2 rounded-md border border-border bg-background text-sm hover:border-primary">
          <span className="w-4 h-4 rounded-full border border-border shrink-0" style={{ background: color }} />
          <span className="font-mono uppercase text-muted-foreground">{color}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <ColorPickerPanel value={color} onChange={onChange} presets={presets} />
      </PopoverContent>
    </Popover>
  );
}
