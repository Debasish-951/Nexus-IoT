import { useEffect, useState } from "react";
import { useAppearance } from "@/lib/appearance";

/**
 * Tracks whether the app is in dark mode.
 *
 * The theme is a `dark` class on <html> (see components/ThemeToggle.tsx), which
 * Tailwind's `dark:` variants pick up automatically. Anything drawn with inline
 * `style={{ color: "#0f172a" }}` cannot — inline styles have no notion of a
 * variant — so a page built from a hardcoded hex palette stays light while the
 * rest of the app goes dark.
 *
 * A MutationObserver rather than a React context: the class is owned by the DOM
 * and can be set before React hydrates (or by anything else on the page), so
 * observing the source of truth is more reliable than mirroring it in state.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

/**
 * Palette for surfaces that must be drawn with inline styles (canvas, dynamic
 * chart colours, computed backgrounds) and therefore cannot use Tailwind
 * `dark:` variants.
 *
 * Values mirror the CSS custom properties in index.css so an inline-styled
 * panel sits flush against a Tailwind-styled one in either theme. Prefer the
 * Tailwind tokens (`bg-card`, `text-foreground`, …) wherever a className will
 * do — this exists for the cases where it will not.
 */
export interface ThemePalette {
  bg: string; card: string; border: string; soft: string;
  text: string; muted: string; dim: string; faint: string;
  cyan: string; green: string; amber: string; red: string; violet: string; blue: string;
}

// Surfaces track the "Electric Blue" tokens in index.css exactly — if you change
// one, change the other, or an inline-styled panel will sit a shade off from the
// Tailwind-styled panel beside it.
const LIGHT: ThemePalette = {
  bg: "#f6f8fb", card: "#ffffff", border: "#e2e8f0", soft: "#f1f5f9",
  text: "#0f172a", muted: "#52607a", dim: "#64748b", faint: "#94a3b8",
  cyan: "#0891b2", green: "#059669", amber: "#d97706",
  red: "#dc2626", violet: "#7c3aed", blue: "#1d4ed8",
};

const DARK: ThemePalette = {
  bg: "#0a0c11", card: "#13161d", border: "#232833", soft: "#171b23",
  text: "#edf1f7", muted: "#c7d0dd", dim: "#9ea9ba", faint: "#6c778a",
  // Accents stay lighter than their light-mode counterparts so they keep ~4.5:1
  // against the dark surfaces above — these are used as TEXT and icon colours,
  // which is a stricter job than a chart mark and needs a lighter step than the
  // validated series palette in registry.tsx.
  cyan: "#22d3ee", green: "#34d399", amber: "#fbbf24",
  red: "#f87171", violet: "#a78bfa", blue: "#60a5fa",
};

/* ── Slate skin ───────────────────────────────────────────────────────────────
   Mirrors styles/slate.css the same way LIGHT/DARK mirror index.css. Without
   these, an inline-styled surface would keep its Electric Blue values while
   every Tailwind-styled panel beside it turned Slate — a visible seam on the
   one page that draws with inline styles (pages/LiveFeed.tsx).

   `blue` is the accent slot, not a literal colour: in Slate it carries the teal
   accent. Renaming the field would touch every consumer for no gain, so the
   slot keeps its name and the value follows the skin.

   Status hues (green/amber/red) step differently per skin because they sit on
   different grounds — the light values are darkened for contrast on near-white,
   the dark values lightened for contrast on near-black. */
const SLATE_LIGHT: ThemePalette = {
  bg: "#fafafa", card: "#ffffff", border: "#e7e7e6", soft: "#f5f5f4",
  text: "#0c0c0d", muted: "#57575c", dim: "#6b6b70", faint: "#8b8b91",
  cyan: "#0e7490", green: "#15803d", amber: "#a35b06",
  red: "#b3261e", violet: "#6d28d9", blue: "#0f6f68",
};

const SLATE_DARK: ThemePalette = {
  bg: "#0c0c0d", card: "#131315", border: "#26262a", soft: "#191919",
  text: "#f2f2f1", muted: "#c4c4c6", dim: "#a5a5a8", faint: "#75757a",
  cyan: "#22d3ee", green: "#4ade80", amber: "#e0a83e",
  red: "#f47066", violet: "#a78bfa", blue: "#2fb3a6",
};

export function useThemePalette(): ThemePalette {
  const { skin, theme } = useAppearance();
  const dark = theme === "dark";
  if (skin === "slate") return dark ? SLATE_DARK : SLATE_LIGHT;
  return dark ? DARK : LIGHT;
}
