/**
 * Push-endpoint admission control: the two per-request guardrails that sit in
 * front of the shared sink for the OTLP + native push handlers. Both are
 * layered here (not in the sink) because they are PUSH-request semantics - a
 * scheduled pull scrape is bounded by its own max-series guard instead.
 *
 *   1. Per-request datapoint cap (`maxDatapointsPerRequest`): a single request
 *      may not offer more than this many datapoints; the overflow is rejected.
 *   2. Soft per-stream rate limit (`softDatapointsPerMinute`): a pod-local
 *      fixed-window limiter sheds sustained intake above the configured rate
 *      with a Retry-After.
 *
 * The sink's bounded buffer remains the HARD backpressure (429 when saturated)
 * behind these. Pure orchestration over the injected {@link RateLimiter}.
 */

import type { RateLimiter } from "@checkstack/ingest-utils";
import type {
  MetricStreamConfig,
  NormalizedDatapoint,
} from "@checkstack/metricstream-common";

export interface AdmitResult {
  /** Datapoints to hand to the sink (within cap + rate budget). */
  admitted: NormalizedDatapoint[];
  /** Rejected because the request exceeded `maxDatapointsPerRequest`. */
  rejectedCap: number;
  /** Rejected because the stream's soft per-minute rate was exhausted. */
  rejectedRateLimit: number;
  /** Seconds until the rate window resets (only when rate-limited). */
  retryAfterSeconds: number;
}

/**
 * Apply the per-request datapoint cap then the soft per-stream rate limit to a
 * normalized batch. The cap runs first (a request offering 10x the cap is
 * trimmed before it consumes the rate budget), then the rate limiter admits up
 * to the remaining per-minute budget for the stream.
 */
export function admitDatapoints({
  streamId,
  datapoints,
  config,
  rateLimiter,
  now,
}: {
  streamId: string;
  datapoints: NormalizedDatapoint[];
  config: MetricStreamConfig;
  rateLimiter: RateLimiter;
  now: Date;
}): AdmitResult {
  const capped =
    datapoints.length > config.maxDatapointsPerRequest
      ? datapoints.slice(0, config.maxDatapointsPerRequest)
      : datapoints;
  const rejectedCap = datapoints.length - capped.length;

  const limit = rateLimiter.admit({
    key: streamId,
    count: capped.length,
    limitPerMinute: config.softDatapointsPerMinute,
    now,
  });
  const admitted =
    limit.allowed === capped.length ? capped : capped.slice(0, limit.allowed);

  return {
    admitted,
    rejectedCap,
    rejectedRateLimit: limit.rejected,
    retryAfterSeconds: limit.retryAfterSeconds,
  };
}
