import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AttributeOption { key: string; label: string }

/**
 * Searchable attribute picker.
 *
 * A native <select> is fine for six tags and unusable for sixty — a real payload
 * flattens to dozens of keys, and scrolling an unfiltered list to find
 * `wtd_cum_kwh` is the slow part of building a widget. Typing filters; the list
 * is otherwise the same set of raw payload tags.
 */
export function AttributeSelect({ value, options, onChange, disabled, placeholder, emptyHint, size = "md" }: {
  value: string;
  options: AttributeOption[];
  onChange: (key: string) => void;
  disabled?: boolean;
  placeholder: string;
  /** Shown inside the dropdown when the asset has no attributes at all. */
  emptyHint?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape — the panel it lives in also scrolls, so a
  // dropdown left open would follow the wrong field.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    inputRef.current?.focus();
    // The config panel is a scroll container, so a dropdown opening near its
    // bottom edge would be clipped — pull the field into view first.
    boxRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.key.toLowerCase().includes(q)) : options;
  }, [query, options]);

  const h = size === "sm" ? "h-7" : "h-8";
  const text = size === "sm" ? "text-xs" : "text-sm";

  // The trigger shows the friendly Attribute Name, not the raw tag `value` is
  // stored as — options carry both, keyed by the same tag used for querying.
  const selectedLabel = value ? (options.find((o) => o.key === value)?.label ?? value) : "";

  function choose(key: string) { onChange(key); setOpen(false); }

  return (
    <div ref={boxRef} className="relative min-w-0">
      <button
        type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full rounded-md border border-border bg-background px-2 flex items-center gap-1.5 text-left",
          h, text, disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>{selectedLabel || placeholder}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          <div className="relative border-b border-border">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && filtered[0]) { e.preventDefault(); choose(filtered[0].key); } }}
              placeholder="Search attributes…"
              className="w-full bg-transparent py-1.5 pl-7 pr-2 text-xs outline-none"
            />
          </div>
          <div className="max-h-52 overflow-auto py-1">
            {value && (
              <button type="button" onClick={() => choose("")}
                className="w-full px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60">
                {placeholder}
              </button>
            )}
            {filtered.map((o) => (
              <button key={o.key} type="button" onClick={() => choose(o.key)}
                className={cn("w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-muted/60",
                  o.key === value && "text-primary")}>
                {o.key === value ? <Check className="w-3 h-3 shrink-0" /> : <span className="w-3 shrink-0" />}
                <span className="truncate">{o.label}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {options.length === 0 ? (emptyHint ?? "No attributes on this asset.") : `No attribute matches “${query}”.`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
