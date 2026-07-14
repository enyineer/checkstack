/**
 * Flush computation and write (plan §5). A flush is split so a failed write can
 * be retried WITHOUT re-running the non-idempotent parts:
 *
 * - {@link prepareFlush} (once): classify every line through the Drain engine,
 *   fold severity + pattern minute-bucket deltas, run the raw sampler, and drain
 *   the engine's pending pattern upserts. It mutates the engine, so it runs
 *   exactly once per flush.
 * - {@link writeFlush} (retryable): ONE `withScopedTransaction` doing the
 *   pattern upserts, bucket upserts, raw insert and activity touch. Because the
 *   whole write is one transaction, a failed attempt rolls back cleanly and
 *   re-applying the same plan is safe.
 * - {@link detectSpike} (post-commit): the spike-detection reads (last spike,
 *   trailing average, the affected minute's totals) run AFTER the write commits,
 *   in their own read transaction. Keeping these SELECTs out of the write
 *   transaction is important during error bursts - they must not lengthen the
 *   write's lock hold. The spike event is recorded post-commit anyway.
 *
 * Important events (`new_pattern`, `spike`) are returned/produced, not recorded
 * here, so the caller records + broadcasts them only AFTER the write commits.
 */

import { and, eq, desc } from "drizzle-orm";
import {
  SEVERITY_BAND_RANK,
  SEVERITY_NUMBER_FOR_BAND,
  worstBand as worseOf,
  type IngestedLine,
  type LogStreamConfig,
  type RecordImportantEventInput,
  type SeverityBand,
} from "@checkstack/logstream-common";
import type { ScopedTransaction } from "@checkstack/backend-api";
import * as schema from "../schema";
import { logImportantEvents } from "../schema";
import {
  floorToMinute,
  type Storage,
  type NewLogEvent,
  type SeverityBucketDelta,
  type PatternBucketDelta,
  type PatternUpsert,
  type VariableBucketDelta,
} from "../storage";
import type { DrainEngine } from "../drain/engine";
import { RawSampler, type SamplerInput } from "./sampler";

type Tx = ScopedTransaction<typeof schema>;

const ERROR_RANK = SEVERITY_BAND_RANK.error;
const WARN_RANK = SEVERITY_BAND_RANK.warn;

/**
 * Await a macrotask yield every this-many classified lines inside
 * {@link prepareFlush}. The overload regime flushes a full buffer (up to
 * `bufferCap`, default 20k lines) in one synchronous classify loop; chunking the
 * loop with a periodic yield hands the event loop back so ingest cannot starve
 * the rest of the process under a shed-level burst (see the load-guard test).
 * 500 keeps per-chunk work small while adding at most ~40 yields to a full
 * buffer - negligible overhead in the common, small-flush case.
 */
const YIELD_EVERY_LINES = 500;

/** A plain, finite decimal/float literal (no hex, `Infinity`, `NaN`, units). */
const PLAIN_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const SPIKE_DEDUPE_MS = 10 * 60_000;
const SPIKE_TRAILING_MS = 30 * 60_000;
const SPIKE_TRAILING_MINUTES = 30;
const SPIKE_MIN_ABSOLUTE = 10;
const SPIKE_MULTIPLIER = 4;

export interface FlushPlan {
  streamId: string;
  patternUpserts: PatternUpsert[];
  severityDeltas: SeverityBucketDelta[];
  patternDeltas: PatternBucketDelta[];
  variableDeltas: VariableBucketDelta[];
  eventRows: NewLogEvent[];
  droppedByCap: number;
  worstBand: SeverityBand;
  errorDelta: number;
  linesClassified: number;
  newPatternEvents: RecordImportantEventInput[];
  /** Epoch-minutes where an error/fatal line landed (spike candidates). */
  affectedErrorMinutes: number[];
  receivedAt: Date;
  rateEstimate: number;
}

/**
 * Classify + fold + sample a stream's buffered lines. Mutates the engine once.
 *
 * Async so the per-line classify loop can yield the event loop every
 * {@link YIELD_EVERY_LINES} lines: an overload flush classifies a full buffer in
 * one loop, and without the yield that synchronous burst starves the process.
 * `severityRules.patternOverrides` re-band a line by its classified pattern id
 * BEFORE bucketing/sampling/spike/worst-band/stored-band, and each numeric
 * `<*>` wildcard value is folded into the pattern-variable minute buckets.
 */
export async function prepareFlush({
  streamId,
  lines,
  drain,
  sampler,
  config,
  now,
  flushIntervalMs,
}: {
  streamId: string;
  lines: IngestedLine[];
  drain: DrainEngine;
  sampler: RawSampler;
  config: LogStreamConfig;
  now: Date;
  flushIntervalMs: number;
}): Promise<FlushPlan> {
  const severityMap = new Map<string, SeverityBucketDelta>();
  const patternMap = new Map<string, PatternBucketDelta>();
  const variableMap = new Map<string, VariableBucketDelta>();
  const samplerInputs: SamplerInput[] = [];
  const newPatternEvents: RecordImportantEventInput[] = [];
  const seenNewPatterns = new Set<string>();
  const affectedErrorMinutes = new Set<number>();

  // Per-pattern band overrides (applied post-classification, before any fold).
  const overrideBands = new Map<string, SeverityBand>();
  for (const override of config.severityRules?.patternOverrides ?? []) {
    overrideBands.set(override.patternId, override.band);
  }

  let worst: SeverityBand = "trace";
  let errorDelta = 0;
  let maxObservedMs = 0;
  let processed = 0;

  for (const line of lines) {
    const classification = drain.classify({
      streamId,
      body: line.body,
      severityNumber: line.severityNumber,
      at: line.ts,
    });
    const bucketStart = floorToMinute(line.ts);
    const minuteEpoch = Math.floor(bucketStart.getTime() / 60_000);

    // A pattern override re-bands the line for EVERY downstream decision (bucket
    // counts, sampling class, spike/new-pattern events, worst band, stored raw
    // line band); the source-derived `line.band` is the fallback.
    const band = overrideBands.get(classification.patternId) ?? line.band;

    accumulateSeverity(severityMap, { streamId, bucketStart, band });
    accumulatePattern(patternMap, {
      streamId,
      bucketStart,
      patternId: classification.patternId,
    });
    accumulateVariables(variableMap, {
      streamId,
      bucketStart,
      patternId: classification.patternId,
      wildcardValues: classification.wildcardValues,
    });

    // A hidden pattern's lines never reach the raw store (that is what hiding
    // means operationally) - but every aggregate above already counted them,
    // so stream volume, pattern buckets and health checks stay honest.
    if (!classification.hidden) {
      samplerInputs.push({
        line,
        patternId: classification.patternId,
        band,
        minuteEpoch,
      });
    }

    worst = worseOf({ a: worst, b: band });
    const rank = SEVERITY_BAND_RANK[band];
    if (rank >= ERROR_RANK) {
      errorDelta += 1;
      affectedErrorMinutes.add(minuteEpoch);
    }

    if (
      classification.isNew &&
      rank >= WARN_RANK &&
      !seenNewPatterns.has(classification.patternId)
    ) {
      seenNewPatterns.add(classification.patternId);
      newPatternEvents.push({
        streamId,
        ts: line.ts,
        type: "new_pattern",
        severityNumber: line.severityNumber,
        patternId: classification.patternId,
        title: `New ${band} pattern`,
        detail: { template: classification.template, sample: line.body },
      });
    }

    // `receivedAt` MUST derive from SERVER time, never the client `line.ts`:
    // `touchStreamActivity` advances `lastReceivedAt` with `greatest()`, so a
    // single future-dated client line would pin it forever and permanently kill
    // silence/absence detection. `observedAt` is when this pod received the line.
    const observedMs = line.observedAt.getTime();
    if (observedMs > maxObservedMs) maxObservedMs = observedMs;

    processed += 1;
    if (processed % YIELD_EVERY_LINES === 0) await yieldToEventLoop();
  }

  const patternUpserts = drain.pendingPatternUpserts();
  const { kept, droppedByCap } = sampler.select({
    streamId,
    lines: samplerInputs,
    config,
    now,
  });
  const eventRows = kept.map((item) =>
    toEventRow(streamId, item.line, item.patternId, item.band),
  );

  return {
    streamId,
    patternUpserts,
    severityDeltas: [...severityMap.values()],
    patternDeltas: [...patternMap.values()],
    variableDeltas: [...variableMap.values()],
    eventRows,
    droppedByCap,
    worstBand: worst,
    errorDelta,
    linesClassified: lines.length,
    newPatternEvents,
    affectedErrorMinutes: [...affectedErrorMinutes],
    receivedAt: maxObservedMs > 0 ? new Date(maxObservedMs) : now,
    rateEstimate: Math.round(lines.length * (60_000 / flushIntervalMs)),
  };
}

/** Hand the event loop a macrotask so a large flush cannot monopolize it. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Persist a prepared flush in one transaction. Safe to retry: the whole write is
 * one transaction, so a failed attempt leaves no partial state. Spike detection
 * is NOT done here - it reads post-commit via {@link detectSpike} so its SELECTs
 * never lengthen the write's lock hold during an error burst.
 */
export async function writeFlush({
  tx,
  plan,
  storage,
  now,
}: {
  tx: Tx;
  plan: FlushPlan;
  storage: Storage;
  now: Date;
}): Promise<void> {
  await storage.upsertPatterns({ runner: tx, patterns: plan.patternUpserts });
  await storage.upsertSeverityBuckets({ runner: tx, deltas: plan.severityDeltas });
  await storage.upsertPatternBuckets({ runner: tx, deltas: plan.patternDeltas });
  await storage.upsertVariableBuckets({ runner: tx, deltas: plan.variableDeltas });
  await storage.insertLogEventsBatch({ runner: tx, rows: plan.eventRows });
  await storage.touchStreamActivity({
    runner: tx,
    streamId: plan.streamId,
    receivedAt: plan.receivedAt,
    flushAt: now,
    rateEstimate: plan.rateEstimate,
  });
}

/**
 * Detect an error spike for a committed flush and return the spike event to
 * record, or null. Reads only (last spike, trailing average, affected minute
 * totals), so it runs AFTER {@link writeFlush} commits, in its own read
 * transaction - keeping these SELECTs out of the write transaction. The caller
 * skips this entirely when the flush produced no error/fatal lines.
 */
export async function detectSpike({
  runner,
  plan,
  storage,
  now,
}: {
  runner: Tx;
  plan: FlushPlan;
  storage: Storage;
  now: Date;
}): Promise<RecordImportantEventInput | null> {
  // Dedupe: at most one spike per stream per 10 minutes (cluster-wide via the
  // shared important-events table).
  const [last] = await runner
    .select({ ts: logImportantEvents.ts })
    .from(logImportantEvents)
    .where(
      and(
        eq(logImportantEvents.streamId, plan.streamId),
        eq(logImportantEvents.type, "spike"),
      ),
    )
    .orderBy(desc(logImportantEvents.ts))
    .limit(1);
  if (last && now.getTime() - last.ts.getTime() < SPIKE_DEDUPE_MS) return null;

  const trailing = await storage.sumSeverityBands({
    runner,
    streamId: plan.streamId,
    from: new Date(now.getTime() - SPIKE_TRAILING_MS),
    to: now,
    grain: "minute",
  });
  const trailingAvg =
    (trailing.error + trailing.fatal) / SPIKE_TRAILING_MINUTES;
  const threshold = Math.max(SPIKE_MIN_ABSOLUTE, SPIKE_MULTIPLIER * trailingAvg);

  // Evaluate the most recent affected minute (the freshest burst).
  const minuteEpoch = Math.max(...plan.affectedErrorMinutes);
  const minuteStart = new Date(minuteEpoch * 60_000);
  const minuteTotals = await storage.sumSeverityBands({
    runner,
    streamId: plan.streamId,
    from: minuteStart,
    to: new Date(minuteEpoch * 60_000 + 60_000),
    grain: "minute",
  });
  const errorFatal = minuteTotals.error + minuteTotals.fatal;
  if (errorFatal < threshold) return null;

  return {
    streamId: plan.streamId,
    ts: minuteStart,
    type: "spike",
    severityNumber: SEVERITY_NUMBER_FOR_BAND.error,
    title: `Error spike: ${errorFatal} error+ lines in one minute`,
    detail: {
      errorFatalCount: errorFatal,
      threshold: Math.round(threshold),
      trailingAvgPerMinute: Math.round(trailingAvg * 100) / 100,
      minuteStart: minuteStart.toISOString(),
    },
  };
}

function accumulateSeverity(
  map: Map<string, SeverityBucketDelta>,
  key: { streamId: string; bucketStart: Date; band: SeverityBand },
): void {
  const mapKey = `${key.bucketStart.getTime()}|${key.band}`;
  const existing = map.get(mapKey);
  if (existing) existing.count += 1;
  else map.set(mapKey, { ...key, count: 1 });
}

function accumulatePattern(
  map: Map<string, PatternBucketDelta>,
  key: { streamId: string; bucketStart: Date; patternId: string },
): void {
  const mapKey = `${key.bucketStart.getTime()}|${key.patternId}`;
  const existing = map.get(mapKey);
  if (existing) existing.count += 1;
  else map.set(mapKey, { ...key, count: 1 });
}

/**
 * Fold a line's numeric `<*>` wildcard values into per-(pattern, varIndex,
 * minute) count/sum/min/max deltas. Only PLAIN FINITE NUMBERS are folded; every
 * other masked value (identifiers, words, timestamps, empty) is skipped, so a
 * non-numeric position simply contributes no delta.
 */
function accumulateVariables(
  map: Map<string, VariableBucketDelta>,
  {
    streamId,
    bucketStart,
    patternId,
    wildcardValues,
  }: {
    streamId: string;
    bucketStart: Date;
    patternId: string;
    wildcardValues: string[];
  },
): void {
  for (const [varIndex, raw] of wildcardValues.entries()) {
    const value = parsePlainFiniteNumber(raw);
    if (value === null) continue;
    const mapKey = `${bucketStart.getTime()}|${patternId}|${varIndex}`;
    const existing = map.get(mapKey);
    if (existing) {
      existing.count += 1;
      existing.sum += value;
      if (value < existing.min) existing.min = value;
      if (value > existing.max) existing.max = value;
    } else {
      map.set(mapKey, {
        streamId,
        patternId,
        varIndex,
        bucketStart,
        count: 1,
        sum: value,
        min: value,
        max: value,
      });
    }
  }
}

/** Parse a string as a float iff it is a plain finite decimal literal, else null. */
function parsePlainFiniteNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!PLAIN_NUMBER_RE.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toEventRow(
  streamId: string,
  line: IngestedLine,
  patternId: string,
  band: SeverityBand,
): NewLogEvent {
  return {
    streamId,
    ts: line.ts,
    observedAt: line.observedAt,
    severityNumber: line.severityNumber,
    severityText: line.severityText ?? null,
    band,
    body: line.body,
    attributes: line.attributes ?? null,
    resource: line.resource ?? null,
    patternId,
    traceId: line.traceId ?? null,
    spanId: line.spanId ?? null,
  };
}
