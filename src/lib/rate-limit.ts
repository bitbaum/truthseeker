// A small fixed-window limiter for the one public, unauthenticated route.
//
// `POST /api/analyze` costs a real article fetch and a real LLM completion on
// every call, from anybody, with no sign-in. Without a limit the failure mode
// is not an outage — it is a bill, and a drained free-tier budget that takes
// the feature down for everyone else while looking like a vendor problem.
//
// Deliberately in-process and dependency-free. This app runs as a single
// service, so module state is shared by every request, and a shared store
// (Redis) would be a new piece of infrastructure guarding one endpoint. If it
// is ever scaled horizontally the limit becomes per-instance, which is worth
// knowing but still far better than none.

interface Window {
  count: number;
  /** Epoch ms at which this window ends. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * Keys are evicted lazily, on the next call after they expire. A busy endpoint
 * cleans itself; a quiet one holds a handful of dead entries, which is cheaper
 * than a timer that keeps the process awake.
 */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Calls left in the current window. */
  remaining: number;
  /** Seconds until the window resets — the value for a Retry-After header. */
  retryAfter: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (windows.size > 500) sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfter };
  }
  return { ok: true, remaining: limit - existing.count, retryAfter };
}

/** Test seam — the window map is module state, so it outlives a single test. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * Who is calling, as far as we can tell.
 *
 * Behind Caddy the socket address is always the proxy, so the client address
 * arrives in `x-forwarded-for`. The FIRST entry is the original client; later
 * ones are proxies. A caller can forge the header, so this is a courtesy limit
 * on honest traffic and a speed bump on the rest — not an access control.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
