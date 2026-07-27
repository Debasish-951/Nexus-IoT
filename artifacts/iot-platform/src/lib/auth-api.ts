import { useEffect, useState } from "react";

/**
 * Thin fetch helpers for the auth endpoints.
 *
 * These sit outside the generated Orval client on purpose: the activation and
 * reset pages run *before* the user has a session, and must not pull in the
 * query-client/auth plumbing the rest of the app assumes.
 */

const CSRF_COOKIE = "is_csrf";

export function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === CSRF_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The single way this app should talk to /api with a plain fetch.
 *
 * Always sends the session cookie, and attaches the CSRF token on mutating
 * methods. Bare `fetch("/api/…", { method: "POST" })` now fails with 403
 * `csrf_failed`, so anything that mutates must go through here (or through the
 * generated Orval client, which does the same thing in custom-fetch.ts).
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);

  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (UNSAFE_METHODS.has(method) && !headers.has("x-csrf-token")) {
    const csrf = readCsrfCookie();
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  return fetch(path, { ...init, method, credentials: "include", headers });
}

export async function apiGet(path: string): Promise<Response> {
  return apiFetch(path);
}

export async function apiPost(path: string, body?: unknown): Promise<Response> {
  return apiFetch(path, {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export async function apiPut(path: string, body?: unknown): Promise<Response> {
  return apiFetch(path, {
    method: "PUT",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export async function apiDelete(path: string): Promise<Response> {
  return apiFetch(path, { method: "DELETE" });
}

// ── Password policy ──────────────────────────────────────────────────────────

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  blockCommon: boolean;
  blockContextual: boolean;
  description: string[];
}

/** Matches the server default in auth-config.ts — used until the fetch lands. */
export const FALLBACK_POLICY: PasswordPolicy = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
  blockCommon: true,
  blockContextual: true,
  description: [
    "At least 12 characters",
    "One uppercase letter (A–Z)",
    "One lowercase letter (a–z)",
    "One number (0–9)",
    "One symbol (!@#$…)",
    "Not a common or previously breached password",
    "Must not contain your name, username, or email",
  ],
};

/** Fetch the deployed policy so the UI checklist always matches enforcement. */
export function usePasswordPolicy(): PasswordPolicy {
  const [policy, setPolicy] = useState<PasswordPolicy>(FALLBACK_POLICY);
  useEffect(() => {
    let cancelled = false;
    apiGet("/api/auth/password-policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p && !cancelled) setPolicy(p); })
      .catch(() => { /* keep the fallback */ });
    return () => { cancelled = true; };
  }, []);
  return policy;
}

export interface PolicyRule {
  label: string;
  met: boolean;
}

/**
 * Client-side mirror of the server's rules, for live feedback only.
 *
 * The server re-validates everything and is the authority; this deliberately
 * omits the common-password and contextual checks, which need data the browser
 * does not have. A password can therefore satisfy every green tick here and
 * still be rejected — the server's message is then shown as-is.
 */
export function passwordRules(password: string, policy: PasswordPolicy): PolicyRule[] {
  const rules: PolicyRule[] = [
    { label: `At least ${policy.minLength} characters`, met: password.length >= policy.minLength },
  ];
  if (policy.requireUppercase) rules.push({ label: "One uppercase letter", met: /[A-Z]/.test(password) });
  if (policy.requireLowercase) rules.push({ label: "One lowercase letter", met: /[a-z]/.test(password) });
  if (policy.requireDigit) rules.push({ label: "One number", met: /[0-9]/.test(password) });
  if (policy.requireSymbol) rules.push({ label: "One symbol", met: /[^A-Za-z0-9]/.test(password) });
  return rules;
}

export function validatePasswordAgainst(password: string, policy: PasswordPolicy): string[] {
  return passwordRules(password, policy).filter((r) => !r.met).map((r) => `Password needs: ${r.label.toLowerCase()}`);
}

/** 0–4 strength score for the meter. Heuristic, not a security control. */
export function passwordStrength(password: string, policy: PasswordPolicy): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  if (!password) return { score: 0, label: "" };

  const met = passwordRules(password, policy).filter((r) => r.met).length;
  const total = passwordRules(password, policy).length;
  const lengthBonus = password.length >= policy.minLength + 6 ? 1 : 0;
  const varietyBonus = new Set(password).size >= 10 ? 1 : 0;

  const raw = Math.min(4, Math.round((met / total) * 2) + lengthBonus + varietyBonus);
  const score = (met < total ? Math.min(raw, 2) : Math.max(raw, 3)) as 0 | 1 | 2 | 3 | 4;

  return { score, label: ["", "Very weak", "Weak", "Good", "Strong"][score] };
}
