import { useEffect, useState } from "react";

/**
 * Appearance = a skin (which design language) × a theme (light or dark).
 *
 * The two are deliberately independent. "Slate" and "Classic" are different
 * design languages that each ship a light AND a dark palette, so switching skin
 * never silently changes whether the app is light or dark, and switching theme
 * never drops you back to the other skin.
 *
 * Both live as attributes on <html>:
 *   skin  → `data-skin`, one of SKINS            (see styles/slate.css, palettes.css)
 *   theme → `class="dark"` or its absence     (Tailwind's `dark:` variant)
 *
 * Attributes on the document rather than React context because they must be set
 * before first paint — see main.tsx — and because anything drawn with inline
 * styles needs to read the current values without being inside a provider.
 */

const SKINS = [
  "slate", "classic", "navy", "cool-grey", "soft-white", "pale-blue",
] as const;
export type Skin = (typeof SKINS)[number];
export type Theme = "light" | "dark";

const SKIN_KEY = "skin";
const THEME_KEY = "theme";

/**
 * Skin used when the user has never chosen one.
 *
 * Slate is the default. To hand the whole deployment back to the original
 * design language — the "revoke" path — build with:
 *
 *   VITE_DEFAULT_SKIN=classic pnpm --filter @workspace/iot-platform build
 *
 * That changes the default only. A user who has already picked a skin keeps
 * their choice, because an explicit preference always outranks a default.
 */
export const DEFAULT_SKIN: Skin =
  import.meta.env.VITE_DEFAULT_SKIN === "classic" ? "classic" : "slate";

/** Light unless told otherwise: Slate is a light-first design language. */
export const DEFAULT_THEME: Theme = "light";

function isSkin(value: unknown): value is Skin {
  return SKINS.includes(value as Skin);
}

/** Skins designed for one theme only. These ignore the Light and Dark setting. */
const FIXED_THEME: Partial<Record<Skin, Theme>> = {
  "cool-grey": "light",
  "soft-white": "light",
  "pale-blue": "light",
};

export function readSkin(): Skin {
  try {
    const stored = localStorage.getItem(SKIN_KEY);
    if (isSkin(stored)) return stored;
  } catch {
    /* storage unavailable (private mode, disabled cookies) — fall through */
  }
  return DEFAULT_SKIN;
}

export function readTheme(): Theme {
  try {
    if (localStorage.getItem(THEME_KEY) === "dark") return "dark";
    if (localStorage.getItem(THEME_KEY) === "light") return "light";
  } catch {
    /* storage unavailable — fall through */
  }
  return DEFAULT_THEME;
}

/**
 * Write both to the document. Safe to call before React mounts, which is
 * exactly what main.tsx does to avoid a flash of the wrong appearance.
 */
export function applyAppearance(skin: Skin, theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute("data-skin", skin);
  root.classList.toggle("dark", (FIXED_THEME[skin] ?? theme) === "dark");
}

export function persistSkin(skin: Skin): void {
  try {
    localStorage.setItem(SKIN_KEY, skin);
  } catch {
    /* ignore storage errors — the attribute is still applied for this session */
  }
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Read the live appearance and re-render when it changes.
 *
 * Observes the DOM rather than mirroring state, for the same reason useIsDark
 * does: the attributes are the source of truth and can be set outside React
 * (pre-paint in main.tsx, or by hand in devtools when checking a palette).
 */
export function useAppearance(): {
  skin: Skin;
  theme: Theme;
  setSkin: (skin: Skin) => void;
  setTheme: (theme: Theme) => void;
} {
  const [skin, setSkinState] = useState<Skin>(() => {
    if (typeof document === "undefined") return DEFAULT_SKIN;
    const attr = document.documentElement.getAttribute("data-skin");
    return isSkin(attr) ? attr : DEFAULT_SKIN;
  });
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const attr = root.getAttribute("data-skin");
      setSkinState(isSkin(attr) ? attr : DEFAULT_SKIN);
      setThemeState(root.classList.contains("dark") ? "dark" : "light");
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "data-skin"] });
    return () => observer.disconnect();
  }, []);

  return {
    skin,
    theme,
    setSkin: (next: Skin) => {
      persistSkin(next);
      // The saved theme, not the live one: leaving a fixed-theme skin must return the
      // user to the theme they chose.
      applyAppearance(next, readTheme());
    },
    setTheme: (next: Theme) => {
      persistTheme(next);
      applyAppearance(skin, next);
    },
  };
}
