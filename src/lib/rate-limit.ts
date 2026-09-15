// Rate limiting for the one public, unauthenticated route — owned by
// `limitkit`, the fleet's shared limiter (see fleet/SHARED.md).
//
// `POST /api/analyze` costs a real article fetch and a real LLM completion on
// every call, from anybody, with no sign-in. Without a limit the failure mode
// is not an outage — it is a bill, and a drained free-tier budget that takes
// the feature down for everyone else while looking like a vendor problem.
//
// This file is a SHIM and should stay one: the route's signature and result
// shape live here, the window arithmetic and the client-IP parsing live in the
// package. HOW MANY calls an hour the route allows is app semantics and stays
// at the call site.
//
// Still in-process: limitkit's default store keeps counts in memory, bounded by
// eviction rather than the timer-free lazy sweep this file used to do. This app
// runs as a single service, so module state is shared by every request; if it
// is ever scaled horizontally the limit becomes per-instance, which is worth
// knowing but still far better than none (implement limitkit's two-method
// `Store` over something shared at that point, and change nothing else).

import { slidingWindow, clientIp, MemoryStore, type Limiter } from "limitkit";

export interface RateLimitResult {
  ok: boolean;
  /** Calls left in the current window. */
  remaining: number;
  /** Seconds until the window resets — the value for a Retry-After header. */
  retryAfter: number;
}

let store = new MemoryStore();

/** One limiter per distinct rule; there is exactly one rule today. */
const limiters = new Map<string, Limiter>();

function limiterFor(limit: number, windowMs: number): Limiter {
  const ruleKey = `${limit}/${windowMs}`;
  let limiter = limiters.get(ruleKey);
  if (!limiter) {
    limiter = slidingWindow({ limit, windowMs }, store);
    limiters.set(ruleKey, limiter);
  }
  return limiter;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const result = limiterFor(limit, windowMs).check(key);
  return { ok: result.allowed, remaining: result.remaining, retryAfter: result.retryAfterSeconds };
}

/** Test seam — the counts are module state, so they outlive a single test. */
export function resetRateLimits(): void {
  store = new MemoryStore();
  limiters.clear();
}

/**
 * Who is calling, as far as we can tell.
 *
 * Behind Caddy the socket address is always the proxy, so the caller's address
 * arrives in `x-forwarded-for` — and because a proxy APPENDS, the entry Caddy
 * wrote is the LAST one. That is the only entry a caller cannot forge, which is
 * the whole point: keying on the first entry (what this used to do) let anyone
 * send a random `x-forwarded-for` per request and land in a fresh bucket every
 * time, so no bucket ever filled.
 */
export function clientKey(headers: Headers): string {
  return clientIp(headers);
}
