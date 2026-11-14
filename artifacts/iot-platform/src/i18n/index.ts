import { useCallback, useSyncExternalStore } from "react";
import { ja } from "./ja";
import { hi } from "./hi";
import { te } from "./te";

/**
 * Interface language.
 *
 * English is the source language: the English text itself is the key
 * (`t("Save")`), so a string that has no translation yet simply shows in
 * English. Each other language is one flat file (ja.ts, hi.ts, te.ts) mapping
 * the English text to its translation, so reviewers can correct a language in
 * one place.
 *
 * Only interface text goes through `t()`. Data never does: project names, asset
 * and attribute names, values, units from telemetry and anything a user typed
 * stay exactly as stored.
 *
 * Translation is being rolled out screen by screen; see docs/features/languages.md
 * for which screens are done. The translations were machine-written and are
 * waiting for review by native speakers.
 */
export type Lang = "en" | "ja" | "hi" | "te";

export const LANGS: { code: Lang; label: string; english: string }[] = [
  { code: "en", label: "English", english: "English" },
  { code: "ja", label: "日本語", english: "Japanese" },
  { code: "hi", label: "हिन्दी", english: "Hindi" },
  { code: "te", label: "తెలుగు", english: "Telugu" },
];

const DICTS: Record<Exclude<Lang, "en">, Record<string, string>> = { ja, hi, te };
const KEY = "ui:lang";

function readLang(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === "ja" || v === "hi" || v === "te" || v === "en") return v; } catch { /* per browser only */ }
  return "en";
}

let current: Lang = readLang();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLang(): Lang { return current; }

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* remembered per browser only */ }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Translates English interface text; `{name}` placeholders are filled from `vars`. */
export function translate(text: string, vars?: Record<string, string | number>, lang: Lang = current): string {
  let out = lang === "en" ? text : DICTS[lang][text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** The current language; re-renders the component when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** `const t = useT(); t("Save")` — re-renders when the language changes. */
export function useT() {
  const lang = useLang();
  return useCallback((text: string, vars?: Record<string, string | number>) => translate(text, vars, lang), [lang]);
}
