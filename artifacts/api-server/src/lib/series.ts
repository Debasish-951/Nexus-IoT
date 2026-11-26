/**
 * Run async steps one after another and return their results in order, like
 * `Promise.all` but holding at most one pool connection at a time.
 *
 * Data Management pages used to fire 7 to 12 queries at once per request on a
 * 10-connection pool (audit L-25); two open tabs could starve ingest. These
 * queries are each fast, so running them in series costs little.
 */
export async function series<T extends readonly (() => unknown)[]>(
  ...steps: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const step of steps) out.push(await step());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
