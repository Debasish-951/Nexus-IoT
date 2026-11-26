/**
 * URL checks for attribute and style values of a sanitised SVG (2D twin).
 *
 * Pure string functions with no DOM, so the API's Node test runner can import
 * them (artifacts/api-server/src/tests/twin-fixes.test.ts).
 *
 * The browser resolves CSS escapes before it reads a value, so `u\72l(…)`,
 * `\75 rl(…)` and `url\28…` are all `url(`. Checks therefore run on the decoded
 * text, and anything that can fetch (url(), image-set(), image(), src(),
 * cross-fade(), element(), @import) is refused unless it is a fragment
 * reference to the drawing itself: url(#id), url('#id') or url("#id").
 */

/** Decodes CSS escapes (`\72`, `\000072 `, `\(`) and drops comments, as a CSS tokenizer would see the text. */
export function decodeCssEscapes(v: string): string {
  return v
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])|\\[\n\r\f]/g, (_m, hex: string | undefined, ch: string | undefined) => {
      if (hex) {
        const cp = parseInt(hex, 16);
        return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
      }
      return ch ?? "";
    });
}

/** Functions and at-rules that make the browser fetch something. */
const FETCHING = /@import|image-set\s*\(|(?:^|[^a-z0-9_-])(?:image|src|cross-fade|element)\s*\(/i;
const ANY_URL = /url\s*\(/gi;
/** A reference to an element of the same drawing; nothing else may follow the id. */
const FRAGMENT_URL = /url\(\s*(?:#[^\s'"()\\]*|'#[^'"()\\]*'|"#[^'"()\\]*")\s*\)/gi;

/** True when a value may contain url(…): every url( in it, raw or escaped, is a fragment reference, and nothing else fetches. */
export function cssUrlsOk(v: string): boolean {
  for (const text of [v, decodeCssEscapes(v)]) {
    if (FETCHING.test(text)) return false;
    const all = text.match(ANY_URL)?.length ?? 0;
    const fragments = text.match(FRAGMENT_URL)?.length ?? 0;
    if (all !== fragments) return false;
  }
  return true;
}

