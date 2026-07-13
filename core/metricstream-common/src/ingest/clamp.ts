/**
 * Datapoint timestamp clamping (the logstream lesson, applied to metrics). A
 * client-supplied datapoint timestamp is UNTRUSTED input: a single out-of-range
 * value must never move a stream's activity or bucketing off the real timeline,
 * and an ancient timestamp must never land in a minute bucket that retention
 * would never age out. So every datapoint's `ts` is clamped into a trust window
 * around the platform's receive time BEFORE it is folded into a bucket.
 *
 * This is the ONE authoritative choke point: the sink clamps every datapoint it
 * buffers (push AND pull), so no source parser can bypass it. Pure module.
 */

/**
 * How far in the PAST a datapoint timestamp may lag receive time before it is
 * snapped forward. Wide (24h) so a legitimately delayed batch keeps its real
 * event time, but bounded so retention can always reach the bucket it lands in.
 */
export const MAX_PAST_LAG_MS = 24 * 60 * 60_000;

/**
 * How far in the FUTURE a datapoint timestamp may lead receive time before it is
 * snapped back. Tight (2min) so a single future-dated sample cannot pin a
 * stream's `lastReceivedAt` forward (which would break silence detection) or
 * create buckets invisible to health and never matched by retention.
 */
export const MAX_FUTURE_SKEW_MS = 2 * 60_000;

/**
 * Clamp a datapoint timestamp into `[observedAt - MAX_PAST_LAG_MS, observedAt +
 * MAX_FUTURE_SKEW_MS]`. An invalid / `NaN` timestamp snaps to `observedAt`.
 * Returns the clamped Date (a new Date when snapped, the original otherwise).
 */
export function clampDatapointTs({
  ts,
  observedAt,
}: {
  ts: Date;
  observedAt: Date;
}): Date {
  const obs = observedAt.getTime();
  const t = ts.getTime();
  if (!Number.isFinite(t)) return new Date(obs);
  const min = obs - MAX_PAST_LAG_MS;
  const max = obs + MAX_FUTURE_SKEW_MS;
  if (t < min) return new Date(min);
  if (t > max) return new Date(max);
  return ts;
}
