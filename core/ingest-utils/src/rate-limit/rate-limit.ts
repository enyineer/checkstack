/**
 * Pod-local fixed-window rate limiters for ingest endpoints.
 *
 * {@link RateLimiter} is a per-key (per-stream) soft admission limit; {@link
 * PreAuthRateLimiter} is a per-IP PRE-authentication abuse limiter.
 *
 * STATE & SCALE: both windows are pod-local (v1). With N pods behind a load
 * balancer the effective limit is roughly N x the configured value; this is an
 * accepted approximation - the limiters exist to shed load, not to bill
 * precisely, and a distributed limiter can replace either without touching
 * callers. Pure module: no IO. `now` is injectable for deterministic tests.
 */

export interface RateLimitResult {
  /** Items admitted this call (counted against the window). */
  allowed: number;
  /** Items refused because the window is exhausted. */
  rejected: number;
  /** Seconds until the window resets (only when something was rejected). */
  retryAfterSeconds: number;
}

const MINUTE_MS = 60_000;

/**
 * Per-key soft ingest rate limit. A fixed one-minute window counts admitted
 * items per key; intake beyond `limitPerMinute` is refused so the endpoint can
 * answer 429 + Retry-After.
 */
export class RateLimiter {
  private readonly windows = new Map<string, number>();
  private currentMinute = 0;

  /**
   * Admit up to `limitPerMinute` items per key per minute. A limit of 0 disables
   * limiting (admit everything).
   */
  admit({
    key,
    count,
    limitPerMinute,
    now,
  }: {
    key: string;
    count: number;
    limitPerMinute: number;
    now: Date;
  }): RateLimitResult {
    if (limitPerMinute <= 0 || count <= 0) {
      return { allowed: count, rejected: 0, retryAfterSeconds: 0 };
    }

    const minute = Math.floor(now.getTime() / MINUTE_MS);
    if (minute !== this.currentMinute) {
      this.windows.clear();
      this.currentMinute = minute;
    }

    const used = this.windows.get(key) ?? 0;
    const remaining = Math.max(0, limitPerMinute - used);
    const allowed = Math.min(count, remaining);
    this.windows.set(key, used + allowed);

    const rejected = count - allowed;
    const retryAfterSeconds =
      rejected > 0
        ? Math.max(1, Math.ceil(((minute + 1) * MINUTE_MS - now.getTime()) / 1000))
        : 0;

    return { allowed, rejected, retryAfterSeconds };
  }
}

/** Default authentication-failure budget per client IP per minute. */
export const DEFAULT_PRE_AUTH_MAX_FAILURES_PER_MINUTE = 120;

/**
 * Hard cap on the number of distinct client IPs tracked in one window. An
 * attacker can spoof `X-Forwarded-For` to mint arbitrary IP keys, so the map is
 * size-bounded by construction: once full, further NEW ips are not tracked (they
 * fail open on limiting) but memory can never grow without bound. The whole map
 * is cleared each minute anyway, so this only bounds a single-minute burst.
 */
export const PRE_AUTH_MAX_TRACKED_IPS = 50_000;

export interface PreAuthLimitVerdict {
  /** True when this IP has already exhausted its failure budget this window. */
  blocked: boolean;
  /** Seconds until the window resets (only meaningful when `blocked`). */
  retryAfterSeconds: number;
}

/**
 * Cheap per-IP, in-memory fixed-window limiter for PRE-authentication abuse: it
 * counts auth FAILURES per client IP and, once an IP exceeds its budget in the
 * current minute, short-circuits further requests from that IP to 429 BEFORE
 * they can reach the DB token lookup. A successful auth never increments, so a
 * legitimate client is unaffected.
 */
export class PreAuthRateLimiter {
  private readonly failures = new Map<string, number>();
  private currentMinute = 0;

  constructor(
    private readonly maxFailuresPerMinute: number = DEFAULT_PRE_AUTH_MAX_FAILURES_PER_MINUTE,
    private readonly maxTrackedIps: number = PRE_AUTH_MAX_TRACKED_IPS,
  ) {}

  private roll(now: Date): number {
    const minute = Math.floor(now.getTime() / MINUTE_MS);
    if (minute !== this.currentMinute) {
      this.failures.clear();
      this.currentMinute = minute;
    }
    return minute;
  }

  /**
   * Check whether the IP is over its failure budget for the current window.
   * Read-only: does NOT record a failure (call {@link recordFailure} for that).
   */
  check({ ip, now }: { ip: string; now: Date }): PreAuthLimitVerdict {
    const minute = this.roll(now);
    const used = this.failures.get(ip) ?? 0;
    const blocked = used >= this.maxFailuresPerMinute;
    const retryAfterSeconds = blocked
      ? Math.max(1, Math.ceil(((minute + 1) * MINUTE_MS - now.getTime()) / 1000))
      : 0;
    return { blocked, retryAfterSeconds };
  }

  /** Record one auth failure for the IP (bounded; see {@link PRE_AUTH_MAX_TRACKED_IPS}). */
  recordFailure({ ip, now }: { ip: string; now: Date }): void {
    this.roll(now);
    const used = this.failures.get(ip);
    if (used === undefined && this.failures.size >= this.maxTrackedIps) {
      // Map full: do not add a new IP key (bound memory). Already-tracked IPs
      // keep incrementing so an in-progress flood still trips its own budget.
      return;
    }
    this.failures.set(ip, (used ?? 0) + 1);
  }

  /** Number of distinct IPs currently tracked (for tests / introspection). */
  get trackedIps(): number {
    return this.failures.size;
  }
}
