import "server-only";

/**
 * A small fixed-window limiter for the public endpoints.
 *
 * The agent is unauthenticated, reachable by GET, and spends Anthropic tokens on
 * every call — which makes it trivially crawlable and expensive. This is not a
 * general-purpose limiter: it is per-process and in-memory, so it resets on
 * deploy and would not coordinate across replicas. That is adequate here
 * precisely because the service runs a single instance, and it is far better
 * than the nothing it replaces.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + opts.windowMs });
    // Opportunistic sweep so the map cannot grow without bound.
    if (windows.size > 5000) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    }
    return {
      allowed: true,
      remaining: opts.limit - 1,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= opts.limit;
  return {
    allowed,
    remaining: Math.max(0, opts.limit - existing.count),
    retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client identity behind Railway's proxy.
 *
 * `x-forwarded-for` is client-supplied and therefore spoofable; it is used here
 * to slow down casual crawling and accidental loops, not to defend against a
 * determined attacker, who would need authentication to stop properly.
 */
export function clientKey(headers: Headers, scope: string): string {
  // The LAST entry, not the first.
  //
  // `X-Forwarded-For` grows left-to-right: a caller can send whatever prefix it
  // likes and the edge appends the address it actually saw. Reading entry [0]
  // therefore read a value the caller chose, so an attacker partitioned the
  // limiter into unlimited buckets just by varying a header. The rightmost
  // entry is the one Railway added.
  const chain = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const edge = chain?.[chain.length - 1];
  return `${scope}:${edge || headers.get("x-real-ip") || "unknown"}`;
}

/**
 * A ceiling no header can partition.
 *
 * Per-client limiting is defeated by anything that controls its own identity,
 * so an endpoint that spends money needs a bound on the *total* as well. This
 * is deliberately crude — one counter, one window, whole process.
 */
const globalWindows = new Map<string, { count: number; resetAt: number }>();

export function globalLimit(
  scope: string,
  opts: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const existing = globalWindows.get(scope);
  if (!existing || existing.resetAt <= now) {
    globalWindows.set(scope, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, remaining: opts.limit - 1, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= opts.limit,
    remaining: Math.max(0, opts.limit - existing.count),
    retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
  };
}
