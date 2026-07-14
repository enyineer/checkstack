/**
 * Error-spike important event. When a flush commits error spans, we check
 * POST-COMMIT (own reads, outside the write transaction) whether the affected
 * minute's error-span count exceeds a trailing-average threshold, and if so
 * record ONE `error_spike` important event - deduped to one per stream per 10
 * minutes via the shared important-events table (cluster-wide). Mirrors
 * logstream's `detectSpike`, adapted to trace error spans.
 *
 * The evaluated minute is the FRESHEST affected error minute of the flush -
 * derived from the flushed spans' `bucketStart` (clamped span-start time), NOT
 * the wall clock. Under normal OTLP export lag a burst folds into a minute
 * bucket seconds-to-minutes behind `now`; evaluating `floorToMinute(now)` would
 * read the fresh, still-empty minute and miss the spike. Mirrors logstream's
 * `Math.max(...affectedErrorMinutes)`.
 *
 * Reads only the PRE-AGGREGATED op-bucket minute tier via SQL `SUM(...)` (never
 * raw `trace_spans`, never the per-bucket digests), so the SELECTs are cheap and
 * never lengthen the write's lock hold. Op-bucket error counts are the
 * SERVICE-LABELED error spans (the operation-metric population); an unlabeled
 * error span is stored + summarized but not counted here - the same
 * approximation the health window collector carries.
 */

import type { RecordImportantEventInput } from "@checkstack/tracestream-common";
import type { Storage } from "../storage";

/** At most one error-spike per stream per 10 minutes (cluster-wide). */
export const SPIKE_DEDUPE_MS = 10 * 60_000;
/** Trailing window the average error rate is computed over. */
export const SPIKE_TRAILING_MS = 30 * 60_000;
/** Whole minutes in the trailing window (the rate denominator). */
export const SPIKE_TRAILING_MINUTES = 30;
/** A minute must have at least this many error spans to ever be a spike. */
export const SPIKE_MIN_ABSOLUTE = 10;
/** ...and exceed this multiple of the trailing per-minute average. */
export const SPIKE_MULTIPLIER = 4;

/** The `error_spike` event type (from TRACE_IMPORTANT_EVENT_TYPES). */
const ERROR_SPIKE_TYPE = "error_spike" as const;

/**
 * Outcome of a spike detection pass. `event` is the important event to record
 * (or null); `suppressedUntilMs` is the epoch-ms horizon until which a spike for
 * this stream is DURABLY deduped (the last spike's `ts + SPIKE_DEDUPE_MS`), or
 * null when no prior spike exists. The stateful detector uses it to skip the
 * dedupe SELECT while suppressed.
 */
export interface SpikeOutcome {
  event: RecordImportantEventInput | null;
  suppressedUntilMs: number | null;
}

/**
 * Pure spike decision from already-read counts. Returns the event to record, or
 * null. Deduped: a spike within {@link SPIKE_DEDUPE_MS} of the last one is
 * suppressed. Fires when the affected minute's error spans meet BOTH the
 * absolute floor and the trailing-multiple threshold.
 */
export function evaluateErrorSpike({
  streamId,
  currentMinuteErrorSpans,
  trailingErrorSpans,
  lastSpikeAt,
  now,
  minuteStart,
}: {
  streamId: string;
  currentMinuteErrorSpans: number;
  trailingErrorSpans: number;
  lastSpikeAt: Date | null;
  now: Date;
  minuteStart: Date;
}): RecordImportantEventInput | null {
  if (lastSpikeAt && now.getTime() - lastSpikeAt.getTime() < SPIKE_DEDUPE_MS) {
    return null;
  }
  const trailingAvg = trailingErrorSpans / SPIKE_TRAILING_MINUTES;
  const threshold = Math.max(SPIKE_MIN_ABSOLUTE, SPIKE_MULTIPLIER * trailingAvg);
  if (currentMinuteErrorSpans < threshold) return null;

  return {
    streamId,
    ts: minuteStart,
    type: ERROR_SPIKE_TYPE,
    title: `Error spike: ${currentMinuteErrorSpans} error spans in one minute`,
    detail: {
      errorSpanCount: currentMinuteErrorSpans,
      threshold: Math.round(threshold),
      trailingAvgPerMinute: Math.round(trailingAvg * 100) / 100,
      minuteStart: minuteStart.toISOString(),
    },
  };
}

/**
 * Detect an error spike for a committed flush. Reads (last spike ts for dedup,
 * trailing error spans, the affected minute's error spans) run AFTER the write
 * commits, so their SELECTs stay out of the write transaction. `minuteStart` is
 * the freshest affected error minute of the flush (a span `bucketStart`), read
 * from the durable op buckets - NOT the wall clock.
 */
export async function detectErrorSpike({
  storage,
  streamId,
  now,
  minuteStart,
}: {
  storage: Storage;
  streamId: string;
  now: Date;
  minuteStart: Date;
}): Promise<SpikeOutcome> {
  // Dedup gate first, so a still-suppressed stream skips the trailing reads.
  const lastSpikeAt = await storage.importantEvents.lastEventAt({
    streamId,
    type: ERROR_SPIKE_TYPE,
  });
  const suppressedUntilMs = lastSpikeAt
    ? lastSpikeAt.getTime() + SPIKE_DEDUPE_MS
    : null;
  if (lastSpikeAt && now.getTime() - lastSpikeAt.getTime() < SPIKE_DEDUPE_MS) {
    return { event: null, suppressedUntilMs };
  }

  const trailing = await storage.opBuckets.sumWindowCounts({
    streamId,
    from: new Date(now.getTime() - SPIKE_TRAILING_MS),
    to: now,
    grain: "minute",
  });
  const current = await storage.opBuckets.sumWindowCounts({
    streamId,
    from: minuteStart,
    to: new Date(minuteStart.getTime() + 60_000),
    grain: "minute",
  });

  const event = evaluateErrorSpike({
    streamId,
    currentMinuteErrorSpans: current.errorSpanCount,
    trailingErrorSpans: trailing.errorSpanCount,
    lastSpikeAt,
    now,
    minuteStart,
  });
  return { event, suppressedUntilMs };
}

/** A stateful, pod-local error-spike detector (the pipeline builds one). */
export interface ErrorSpikeDetector {
  detect(args: {
    streamId: string;
    now: Date;
    minuteStart: Date;
  }): Promise<RecordImportantEventInput | null>;
}

/**
 * Build a pod-local error-spike detector. It wraps {@link detectErrorSpike} with
 * a per-stream "next check" horizon so the dedupe SELECT (and the trailing
 * reads) run AT MOST once per dedupe window per stream WHILE a spike is
 * suppressed: once a pass learns a still-active spike, further error flushes on
 * this pod skip the read entirely until the durable dedupe would expire.
 *
 * This is POD-LOCAL bookkeeping, never a source of truth: the DURABLE dedupe is
 * always the shared important-events table (a `lastEventAt` read backs every
 * horizon we cache, and every other pod enforces the same durable dedupe). A
 * missed cache entry (e.g. after a restart) costs at most one extra SELECT.
 */
export function createErrorSpikeDetector({
  storage,
}: {
  storage: Storage;
}): ErrorSpikeDetector {
  const nextCheckAt = new Map<string, number>();

  return {
    async detect({ streamId, now, minuteStart }) {
      const gate = nextCheckAt.get(streamId);
      if (gate !== undefined && now.getTime() < gate) return null;

      const outcome = await detectErrorSpike({
        storage,
        streamId,
        now,
        minuteStart,
      });
      if (outcome.suppressedUntilMs === null) {
        nextCheckAt.delete(streamId);
      } else {
        nextCheckAt.set(streamId, outcome.suppressedUntilMs);
      }
      return outcome.event;
    },
  };
}
