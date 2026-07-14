/**
 * Span timestamp clamping (the logstream/metricstream lesson, applied to spans).
 * A client-supplied span start/end is UNTRUSTED input: a single out-of-range
 * value must never move a stream's activity or bucketing off the real timeline,
 * and an ancient start must never land in a minute bucket that retention would
 * never age out. So every span's start is clamped into a trust window around the
 * platform's receive time BEFORE it is folded, and its duration is derived
 * defensively.
 *
 * The backend ingest pipeline is the ONE authoritative choke point: it clamps
 * every span it buffers (OTLP push, native push AND the telemetry sink), so no
 * source parser can bypass it. Pure module: no IO, no node builtins - browser
 * safe so the satellite trace receiver can import it alongside the core path.
 */

/**
 * How far in the PAST a span start may lag receive time before it is snapped
 * forward. Wide (24h) so a legitimately delayed export keeps its real event
 * time, but bounded so retention can always reach the bucket it lands in.
 */
export const MAX_PAST_LAG_MS = 24 * 60 * 60_000;

/**
 * How far in the FUTURE a span start may lead receive time before it is snapped
 * back. Tight (2min) so a single future-dated span cannot pin a stream's
 * `lastReceivedAt` forward (which would break silence detection) or create
 * buckets invisible to the overview and never matched by retention.
 */
export const MAX_FUTURE_SKEW_MS = 2 * 60_000;

/**
 * Hard ceiling on a single span's derived duration (7 days). Guards an absurd
 * `end - start` (a garbage end timestamp) from producing a duration that would
 * dominate every latency chart.
 */
export const MAX_SPAN_DURATION_MS = 7 * 24 * 60 * 60_000;

export interface ClampedSpanTimes {
  /** Start snapped into the trust window (drives bucketing + the waterfall). */
  startTs: Date;
  /** `end - clampedStart`, floored to 0 and capped at {@link MAX_SPAN_DURATION_MS}. */
  durationMs: number;
  /** True when start or duration was snapped to a bound. */
  clamped: boolean;
}

/**
 * Clamp a span's start into `[observedAt - MAX_PAST_LAG_MS, observedAt +
 * MAX_FUTURE_SKEW_MS]` and derive a sane duration from its end.
 *
 * DROP-OR-CLAMP decision (documented): a NEGATIVE duration (end < start, from a
 * clock glitch) is CLAMPED to 0 and the span is KEPT, never dropped - dropping a
 * span for a clock skew tears a hole in the trace tree, which is worse than a
 * zero-width span in the waterfall. An invalid/`NaN` start snaps to `observedAt`;
 * an invalid/`NaN` end yields a 0 duration.
 */
export function clampSpanTimes({
  startTs,
  endTs,
  observedAt,
}: {
  startTs: Date;
  endTs: Date;
  observedAt: Date;
}): ClampedSpanTimes {
  const obs = observedAt.getTime();
  const min = obs - MAX_PAST_LAG_MS;
  const max = obs + MAX_FUTURE_SKEW_MS;

  const rawStart = startTs.getTime();
  let clamped = false;
  let start: number;
  if (!Number.isFinite(rawStart)) {
    start = obs;
    clamped = true;
  } else if (rawStart < min) {
    start = min;
    clamped = true;
  } else if (rawStart > max) {
    start = max;
    clamped = true;
  } else {
    start = rawStart;
  }

  const rawEnd = endTs.getTime();
  let durationMs: number;
  if (Number.isFinite(rawEnd)) {
    durationMs = rawEnd - start;
    if (durationMs < 0) {
      durationMs = 0;
      clamped = true;
    } else if (durationMs > MAX_SPAN_DURATION_MS) {
      durationMs = MAX_SPAN_DURATION_MS;
      clamped = true;
    }
  } else {
    durationMs = 0;
    clamped = true;
  }

  return { startTs: new Date(start), durationMs, clamped };
}
