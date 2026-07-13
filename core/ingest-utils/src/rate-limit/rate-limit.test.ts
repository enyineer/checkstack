import { describe, it, expect } from "bun:test";
import { RateLimiter, PreAuthRateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("admits up to the per-minute limit then rejects with Retry-After", () => {
    const limiter = new RateLimiter();
    const now = new Date("2026-07-12T10:00:30.000Z");
    const first = limiter.admit({ key: "s", count: 8, limitPerMinute: 10, now });
    expect(first).toEqual({ allowed: 8, rejected: 0, retryAfterSeconds: 0 });

    const second = limiter.admit({ key: "s", count: 5, limitPerMinute: 10, now });
    expect(second.allowed).toBe(2);
    expect(second.rejected).toBe(3);
    // 30s left in the minute window.
    expect(second.retryAfterSeconds).toBe(30);
  });

  it("resets the window on a new minute", () => {
    const limiter = new RateLimiter();
    limiter.admit({
      key: "s",
      count: 10,
      limitPerMinute: 10,
      now: new Date("2026-07-12T10:00:00Z"),
    });
    const next = limiter.admit({
      key: "s",
      count: 5,
      limitPerMinute: 10,
      now: new Date("2026-07-12T10:01:00Z"),
    });
    expect(next.allowed).toBe(5);
  });

  it("isolates keys and disables limiting at limit 0", () => {
    const limiter = new RateLimiter();
    const now = new Date("2026-07-12T10:00:00Z");
    limiter.admit({ key: "a", count: 10, limitPerMinute: 10, now });
    const other = limiter.admit({ key: "b", count: 10, limitPerMinute: 10, now });
    expect(other.allowed).toBe(10);
    const unlimited = limiter.admit({ key: "a", count: 999, limitPerMinute: 0, now });
    expect(unlimited.allowed).toBe(999);
  });

  it("resets EVERY key's window on a new minute (not just the queried one)", () => {
    // Regression guard: the minute roll must clear the whole map. If it were
    // changed to a per-key delete keyed on the current call, a key that was
    // saturated last minute and not touched this call would stay exhausted.
    const limiter = new RateLimiter();
    const m1 = new Date("2026-07-12T10:00:00Z");
    limiter.admit({ key: "a", count: 10, limitPerMinute: 10, now: m1 });
    limiter.admit({ key: "b", count: 10, limitPerMinute: 10, now: m1 });

    // New minute: a call for "a" alone must also have reset "b"'s window.
    const m2 = new Date("2026-07-12T10:01:00Z");
    limiter.admit({ key: "a", count: 1, limitPerMinute: 10, now: m2 });
    const b = limiter.admit({ key: "b", count: 10, limitPerMinute: 10, now: m2 });
    expect(b.allowed).toBe(10);
  });

  it("floors Retry-After at 1s at the very end of the window", () => {
    const limiter = new RateLimiter();
    // 1ms before the minute boundary: raw seconds-remaining rounds toward 0, so
    // the Math.max(1, ...) floor must keep Retry-After a positive integer.
    const now = new Date("2026-07-12T10:00:59.999Z");
    limiter.admit({ key: "s", count: 10, limitPerMinute: 10, now });
    const rejected = limiter.admit({ key: "s", count: 5, limitPerMinute: 10, now });
    expect(rejected.rejected).toBe(5);
    expect(rejected.retryAfterSeconds).toBe(1);
  });
});

describe("PreAuthRateLimiter", () => {
  it("blocks an IP once it exceeds its failure budget, then recovers next minute", () => {
    const limiter = new PreAuthRateLimiter(3); // 3 failures/min/IP
    const ip = "203.0.113.7";
    const now = new Date("2026-07-12T10:00:10Z");

    // First three failures are permitted (not yet over budget).
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check({ ip, now }).blocked).toBe(false);
      limiter.recordFailure({ ip, now });
    }
    // Budget now exhausted: further requests short-circuit.
    const verdict = limiter.check({ ip, now });
    expect(verdict.blocked).toBe(true);
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0);

    // A different IP is unaffected.
    expect(limiter.check({ ip: "198.51.100.1", now }).blocked).toBe(false);

    // Next minute the window resets and the IP recovers.
    const next = new Date("2026-07-12T10:01:00Z");
    expect(limiter.check({ ip, now: next }).blocked).toBe(false);
  });

  it("bounds the number of tracked IPs (spoofed X-Forwarded-For cannot OOM)", () => {
    const limiter = new PreAuthRateLimiter(1, 100); // cap 100 distinct IPs
    const now = new Date("2026-07-12T10:00:00Z");
    for (let i = 0; i < 500; i += 1) {
      limiter.recordFailure({ ip: `10.0.0.${i}`, now });
    }
    expect(limiter.trackedIps).toBeLessThanOrEqual(100);
  });
});
