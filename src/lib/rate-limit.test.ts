/**
 * `POST /api/analyze` is unauthenticated by design — anyone can paste a link —
 * and every call costs an article fetch plus a real LLM completion. Without a
 * limit the failure mode is not an outage but a bill, and a drained daily
 * budget that takes the feature down for everyone while looking like a vendor
 * problem.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { checkRateLimit, clientKey, resetRateLimits } from "./rate-limit";

beforeEach(() => {
  resetRateLimits();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows up to the limit, then refuses", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("a", 3, 60_000).ok, `call ${i + 1}`).toBe(true);
    }
    expect(checkRateLimit("a", 3, 60_000).ok).toBe(false);
  });

  it("counts each caller separately", () => {
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(true);
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(false);
    // One noisy caller must not lock everybody else out.
    expect(checkRateLimit("b", 1, 60_000).ok).toBe(true);
  });

  it("lets a caller back in once the window passes", () => {
    vi.useFakeTimers();
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(true);
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(true);
  });

  it("reports a retryAfter the caller can act on", () => {
    vi.useFakeTimers();
    checkRateLimit("a", 1, 60_000);
    const refused = checkRateLimit("a", 1, 60_000);

    expect(refused.ok).toBe(false);
    // A 429 with no idea when to come back invites an immediate retry loop,
    // which is the traffic the limit exists to stop.
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(refused.retryAfter).toBeLessThanOrEqual(60);
  });

  it("keeps counting while refusing, so a hammering caller stays out", () => {
    checkRateLimit("a", 1, 60_000);
    for (let i = 0; i < 5; i++) checkRateLimit("a", 1, 60_000);
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(false);
  });
});

describe("clientKey", () => {
  it("takes the FIRST x-forwarded-for entry — the original client", () => {
    // Later entries are proxies. Keying on the last one would bucket everyone
    // behind Caddy together and rate-limit the whole internet as one caller.
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    // No usable header: one shared bucket is a blunt limit, and still better
    // than none — but it is why this is a courtesy limit, not access control.
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
