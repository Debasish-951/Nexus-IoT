/**
 * Opaque address-bar tokens for the app's routes.
 *
 * `/p/<projectId>/alarm-rules` is shown as `/p/<projectId>/r7k2m4qd`. The app
 * itself never sees these: translation happens in the wouter location hook, so
 * every page, <Link>, and route pattern keeps using the readable path it always
 * used. Only what the browser displays changes.
 *
 * WHAT THIS IS AND IS NOT
 *
 * This is display obfuscation, requested so that section names are not legible
 * to someone reading the address bar over a shoulder or in a screen share. It
 * is NOT an access control and must never be treated as one. Every token below
 * ships inside the JS bundle, so anyone with devtools can recover the whole
 * table in seconds. What actually stops a request is the API's deny-by-default
 * authorisation (api-server middleware/authorize.ts) — a guessed URL earns a
 * 401 or 403 there, with or without this file.
 *
 * TOKENS ARE PERMANENT
 *
 * A token is part of every bookmark and shared link that has ever been copied
 * out of the app. Changing one silently breaks those links — it does not 404,
 * it lands on whatever now holds that token. Add new entries freely; never edit
 * or reuse an existing one. They are deliberately hand-written rather than
 * generated, so a rebuild cannot shuffle them.
 *
 * Readable URLs keep working: an unknown segment passes through untranslated,
 * so an old `/p/<id>/alarms` bookmark still resolves. It is rewritten to its
 * token form on arrival.
 */

/** Canonical path → address-bar token. Keys are the STATIC part of a route. */
const SLUGS: Record<string, string> = {
  "/asset-management":    "k3f8w2xa",
  "/hierarchy-generator": "q7d4n1vb",
  "/assets":              "m9x2c6te",
  "/asset-templates":     "h5b8j3rp",
  "/media-library":       "t2w7q9ld",
  "/alarms":              "z4n6v8ky",
  "/alarm-history":       "c8j1m5wq",
  "/alarm-rules":         "r7k2m4qd",
  "/notification-groups": "v3p9x7bn",
  "/users":               "y6t4h2sc",
  "/security":            "b1q5z8jm",
  "/brokers":             "n8w3r6fk",
  "/destinations":        "j2v7y1dp",
  "/integrations":        "w5c9k4tz",
  "/integration-guide":   "f3m8b2qh",
  "/simulator":           "d6r1x9nv",
  "/api-clients":         "p4z7t3cy",
  "/data-explorer":       "s9h2w6jb",
  "/ai-copilot":          "g1k8n5rt",
  "/activity-log":        "x7q3d9mf",
  "/data-management":     "l5y2v8pw",
  "/reports":             "a3n6c1zk",
  "/visualization":       "u8j4t7bq",
  "/live-twin":           "e2w9m3xh",
  "/dashboard-templates": "o6b5r8vn",
  "/live":                "i4t1p7dc",
  "/settings":            "k9v6z2ws",
  "/ai-reports":          "q2f7k9wd",
};

const TOKEN_TO_PATH: Record<string, string> = Object.fromEntries(
  Object.entries(SLUGS).map(([path, token]) => [token, path]),
);

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Split a full in-app path into the part that must stay verbatim and the page
 * path that gets translated.
 *
 * The untouched prefix is the deployment base plus, when present, the
 * `/p/<projectId>` project scope — that UUID is already opaque and is what the
 * router matches on before any of this applies.
 */
function split(fullPath: string): { prefix: string; page: string } {
  let rest = fullPath;
  let prefix = "";

  if (APP_BASE && rest.startsWith(APP_BASE)) {
    prefix = APP_BASE;
    rest = rest.slice(APP_BASE.length);
  }

  const project = /^\/p\/([^/]+)/.exec(rest);
  if (project) {
    prefix += project[0];
    rest = rest.slice(project[0].length);
  }

  return { prefix, page: rest || "/" };
}

/**
 * Replace the leading static segment of `page` using `table`.
 *
 * Matching is on a segment boundary, never a bare string prefix: `/assets` must
 * not swallow the start of `/asset-templates`. Anything after the matched part
 * (a record id, say) is carried through untouched, which is what keeps
 * `/assets/<uuid>` working with a single entry per route.
 */
function translate(page: string, table: [string, string][]): string {
  for (const [from, to] of table) {
    if (page === from) return to.startsWith("/") ? to : `/${to}`;
    if (page.startsWith(`${from}/`)) {
      const tail = page.slice(from.length);
      return `${to.startsWith("/") ? to : `/${to}`}${tail}`;
    }
  }
  return page;
}

/**
 * Longest key first, so a route that is a segment-prefix of another can never
 * shadow it. Nothing in the table needs this today; it is here so that adding
 * (say) `/reports` alongside `/reports-archive` later cannot introduce a subtle
 * mistranslation that only shows up as the wrong page loading.
 */
const byLongestKey = (table: Record<string, string>): [string, string][] =>
  Object.entries(table).sort((a, b) => b[0].length - a[0].length);

const ENCODE_TABLE = byLongestKey(SLUGS);
const DECODE_TABLE = byLongestKey(
  Object.fromEntries(Object.entries(TOKEN_TO_PATH).map(([token, path]) => [`/${token}`, path])),
);

/**
 * A project root is written as `/p/<id>` with no trailing page, so re-joining
 * must not leave a bare "/" behind it. Without a prefix the path is the page.
 */
function join(prefix: string, page: string): string {
  if (page === "/") return prefix || "/";
  return prefix + page;
}

/**
 * Peel off any query string or fragment before translating.
 *
 * Navigation targets are not always bare paths — the AI Advisor nav items are
 * `/ai-copilot?action=health` and friends. Without this the whole string is
 * compared against the route table, nothing matches, and those links quietly
 * skip translation while every other link is rewritten.
 */
function splitSuffix(path: string): [string, string] {
  const at = path.search(/[?#]/);
  return at === -1 ? [path, ""] : [path.slice(0, at), path.slice(at)];
}

function convert(fullPath: string, table: [string, string][]): string {
  const [path, suffix] = splitSuffix(fullPath);
  const { prefix, page } = split(path);
  return join(prefix, translate(page, table)) + suffix;
}

/** Readable → opaque. Used when writing to the address bar. */
export function encodePath(fullPath: string): string {
  return convert(fullPath, ENCODE_TABLE);
}

/** Opaque → readable. Used before the router matches anything. */
export function decodePath(fullPath: string): string {
  return convert(fullPath, DECODE_TABLE);
}
