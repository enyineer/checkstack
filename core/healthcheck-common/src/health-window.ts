/**
 * Shared window math for reader-only OBSERVABILITY health strategies
 * (logstream, metricstream, tracestream). Every stream plugin evaluates its
 * windowed metrics over minute-grain buckets with the SAME complete-minute
 * semantics; the math lives here so the subtle boundary rules cannot drift
 * between plugins. Pure module: no IO.
 */

/** Smallest evaluation window (one whole minute). */
export const MIN_WINDOW_SECONDS = 60;

export interface WindowBounds {
  /** Inclusive start of the window (minute-aligned). */
  from: Date;
  /**
   * Exclusive end of the COMPLETE-minute window: the start of the minute
   * containing `now`, i.e. the boundary AFTER the last COMPLETE minute. Used
   * as the rate DENOMINATOR boundary (`windowMinutes` whole minutes) and for
   * any semantics where a partial minute would mislead.
   */
  to: Date;
  /**
   * Exclusive end for the COUNT reads: the end of the in-progress minute
   * (`to + 1 minute`). Reading `[from, readTo)` additively includes the
   * current partial minute bucket so a burst seconds into the minute is
   * visible to a fast-path evaluation that same second - without waiting for
   * the minute to complete. Bucket counts are monotonic within a minute, so
   * including partial data can only make error assertions fire EARLIER,
   * never report a false low. (Rates divide by `windowMinutes`, so during
   * the partial minute a rate may momentarily read slightly high - i.e.
   * undercount the true elapsed denominator - which likewise only surfaces a
   * problem sooner.)
   */
  readTo: Date;
  /** Whole COMPLETE minutes spanned by `[from, to)` (>= 1). */
  windowMinutes: number;
}

/**
 * Resolve the evaluation window. `windowSeconds` defaults to the check's
 * interval, is floored to a whole number of minutes, and is clamped to at
 * least one minute. The complete-minute window ends at the last COMPLETE
 * minute (`to`); the COUNT reads additionally include the in-progress minute
 * (`readTo`) so a just-arrived burst is visible immediately (see
 * {@link WindowBounds}).
 */
export function computeWindowBounds({
  now,
  windowSeconds,
  intervalSeconds,
}: {
  now: Date;
  windowSeconds: number | undefined;
  intervalSeconds: number;
}): WindowBounds {
  const requested = windowSeconds ?? intervalSeconds;
  const safeRequested =
    Number.isFinite(requested) && requested > 0
      ? requested
      : MIN_WINDOW_SECONDS;
  const effectiveSeconds = Math.max(MIN_WINDOW_SECONDS, safeRequested);
  // Floor to whole minutes (complete-minute denominator).
  const windowMinutes = Math.max(1, Math.floor(effectiveSeconds / 60));
  const to = floorToMinute(now);
  const from = new Date(to.getTime() - windowMinutes * 60_000);
  const readTo = new Date(to.getTime() + 60_000);
  return { from, to, readTo, windowMinutes };
}

/**
 * Seconds since the stream last received data, for absence assertions.
 * Falls back to the stream's creation time when nothing was ever received
 * (a brand-new stream is not "silent since 1970"), and clamps clock skew to
 * zero.
 */
export function computeSecondsSinceLast({
  now,
  lastAt,
  streamCreatedAt,
}: {
  now: Date;
  lastAt: Date | null;
  streamCreatedAt: Date;
}): number {
  const reference = lastAt ?? streamCreatedAt;
  return Math.max(0, Math.floor((now.getTime() - reference.getTime()) / 1000));
}

/** Floor a timestamp to the start of its minute (UTC-safe; operates on epoch). */
function floorToMinute(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}
