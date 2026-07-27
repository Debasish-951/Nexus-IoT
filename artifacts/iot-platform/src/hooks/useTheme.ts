import { useEffect, useState } from "react";

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

const LIGHT: ThemePalette = {
  bg: "#f7f8fa", card: "#ffffff", border: "#e2e8f0", soft: "#f1f5f9",
  text: "#0f172a", muted: "#475569", dim: "#64748b", faint: "#94a3b8",
  cyan: "#0891b2", green: "#059669", amber: "#d97706",
  red: "#dc2626", violet: "#7c3aed", blue: "#2563eb",
};

const DARK: ThemePalette = {
  bg: "#0b1120", card: "#111827", border: "#1f2937", soft: "#161f2f",
  text: "#f1f5f9", muted: "#cbd5e1", dim: "#94a3b8", faint: "#64748b",
  // Accents lightened so they keep ~4.5:1 contrast on the dark surfaces above;
  // the light-mode values are too dark to read against #111827.
  cyan: "#22d3ee", green: "#34d399", amber: "#fbbf24",
  red: "#f87171", violet: "#a78bfa", blue: "#60a5fa",
};

export function useThemePalette(): ThemePalette {
  return useIsDark() ? DARK : LIGHT;
}
