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

  it("keeps a hammering caller out for the rest of the window", () => {
    vi.useFakeTimers();
    checkRateLimit("a", 1, 60_000);
    for (let i = 0; i < 5; i++) checkRateLimit("a", 1, 60_000);
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(false);

    // Refused calls count nothing, so hammering does not extend the punishment
    // past the window: a legitimate caller behind the same NAT gets back in on
    // schedule instead of staying locked out for as long as somebody else keeps
    // trying.
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("takes the LAST x-forwarded-for entry — the hop Caddy itself wrote", () => {
    // A proxy APPENDS, so every entry left of the last is whatever the caller
    // chose to send. Keying on the first one let anyone send a random value per
    // request and land in a fresh bucket each time, which is a limiter that
    // cannot be tripped.
    const headers = new Headers({ "x-forwarded-for": "10.0.0.1, 10.0.0.2, 203.0.113.7" });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    // No usable header: one shared bucket is a blunt limit, and still better
    // than none — but it is why this is a courtesy limit, not access control.
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
