import type { BucketGrain } from "@checkstack/tracestream-common";

/**
 * Above this window width, default a `getOpBuckets` read to the HOUR tier
 * (minute detail is too dense). Tracestream's default `minuteRetentionHours` is
 * 48, so a window up to 48h is served from the minute tier and anything wider
 * falls back to the pre-rolled hourly tier.
 */
export const MINUTE_TIER_MAX_MS = 48 * 3_600_000;

/**
 * Choose the op-bucket read tier: an explicit grain always wins, otherwise pick
 * minute for windows up to {@link MINUTE_TIER_MAX_MS} and hour beyond it. Pure.
 */
export function resolveGrain({
  from,
  to,
  explicit,
}: {
  from: Date;
  to: Date;
  explicit?: BucketGrain;
}): BucketGrain {
  if (explicit) return explicit;
  return to.getTime() - from.getTime() <= MINUTE_TIER_MAX_MS ? "minute" : "hour";
}
