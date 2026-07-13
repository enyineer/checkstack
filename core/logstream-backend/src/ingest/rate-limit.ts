/**
 * Pod-local ingest rate limiters, re-exported from `@checkstack/ingest-utils`.
 * {@link RateLimiter} is the per-stream soft admission limit (its window is
 * keyed on the stream id); {@link PreAuthRateLimiter} is the per-IP
 * pre-authentication abuse limiter. See the shared module for the STATE & SCALE
 * rationale (both windows are pod-local by design).
 */

export {
  RateLimiter,
  PreAuthRateLimiter,
  DEFAULT_PRE_AUTH_MAX_FAILURES_PER_MINUTE,
  PRE_AUTH_MAX_TRACKED_IPS,
  type RateLimitResult,
  type PreAuthLimitVerdict,
} from "@checkstack/ingest-utils";
