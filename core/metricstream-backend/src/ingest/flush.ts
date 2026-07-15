/**
 * The flush FOLD: turn a drained batch of buffered datapoints for ONE stream
 * into the set-based writes the storage helpers persist, inside ONE
 * transaction. Stateless and multi-pod-safe - a series' cumulative total lives
 * in its minute buckets' `last`, never in per-pod memory, so rate/increase are
 * derived at READ time (see the collector) rather than tracked here.
 *
 * The fold has two pure stages plus a transaction body:
 *   1. {@link foldDatapoints} - group datapoints into per-series identity, per
 *      (series, minute) bucket deltas, and per-name registry info. Yields the
 *      event loop every {@link FOLD_YIELD_EVERY} datapoints as cheap insurance
 *      so a huge flush never monopolizes the loop.
 *   2. {@link writeFlushPlan} - inside the flush transaction: cardinality-cap
 *      the NEW series (existing series always keep updating), insert admitted
 *      series, advance existing `lastSeenAt`, upsert the metric-name registry,
 *      fold the minute buckets, and touch the activity row with the drop counts.
 */

import type { ScopedQueryRunner } from "@checkstack/backend-api";
import {
  withScopedTransaction,
  type SafeDatabase,
  type Logger,
} from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import {
  METRICSTREAM_ACTIVITY,
  type CounterKind,
  type MetricStreamConfig,
  type MetricType,
  type NormalizedDatapoint,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import type { StoredExemplar } from "../schema";
import {
  computeSeriesId,
  floorToMinute,
  mergeExemplars,
  partitionNewSeries,
  toStoredExemplar,
  type MinuteBucketDelta,
  type SeriesExemplarUpdate,
  type Storage,
} from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import type { BufferedDatapoint } from "./sink";
import type { StreamConfigResolver } from "./stream-config";

type Runner = ScopedQueryRunner<typeof schema>;

/** Datapoints processed between event-loop yields during the fold. */
export const FOLD_YIELD_EVERY = 2000;
/** Activity signal debounce (per stream) - never broadcast more than this often. */
export const ACTIVITY_DEBOUNCE_MS = 2000;
/** At most one `series_cap` event per stream per this window (dedup). */
export const SERIES_CAP_EVENT_DEDUP_MS = 10 * 60_000;

/** One series' identity + how many datapoints in this flush belong to it. */
export interface SeriesFoldEntry {
  seriesId: string;
  name: string;
  labels: Record<string, string>;
  type: MetricType;
  counterKind: CounterKind | null;
  unit: string | null;
  /** Datapoints in THIS flush for this series (drives dropped-datapoint math). */
  datapointCount: number;
  /**
   * Newest exemplars folded for this series in THIS flush (deduped by trace id,
   * capped), or empty when none arrived. Persisted only for surviving series.
   */
  exemplars: StoredExemplar[];
}

/** Latest observed registry info for one metric name in this flush. */
export interface NameFoldEntry {
  name: string;
  type: MetricType;
  counterKind: CounterKind | null;
  unit: string | null;
}

/** The pure fold result for one stream's drained batch. */
export interface SeriesFold {
  /** seriesId -> identity. */
  series: Map<string, SeriesFoldEntry>;
  /** `${seriesId}|${bucketStartMs}` -> the folded minute-bucket delta. */
  buckets: Map<string, MinuteBucketDelta>;
  /** metric name -> latest registry info. */
  names: Map<string, NameFoldEntry>;
  /** Total datapoints folded (== the drained batch size). */
  total: number;
}

/** A macrotask yield so a long fold hands the event loop back periodically. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Group a drained batch (already all for ONE stream) into series identities,
 * per-(series, minute) bucket deltas and per-name registry info. Pure aside from
 * the periodic event-loop yield. Bucket `last`/`lastTs` follow latest-lastTs-wins
 * (`>=` so a later-arriving equal-ts sample still refreshes); `deltaSum`
 * accumulates only delta-counter increments.
 */
export async function foldDatapoints({
  streamId,
  items,
  yieldEvery = FOLD_YIELD_EVERY,
}: {
  streamId: string;
  items: BufferedDatapoint[];
  yieldEvery?: number;
}): Promise<SeriesFold> {
  const series = new Map<string, SeriesFoldEntry>();
  const buckets = new Map<string, MinuteBucketDelta>();
  const names = new Map<string, NameFoldEntry>();

  let processed = 0;
  for (const { datapoint } of items) {
    const dp: NormalizedDatapoint = datapoint;
    const counterKind = dp.counterKind ?? null;
    const unit = dp.unit ?? null;
    const seriesId = computeSeriesId({
      streamId,
      name: dp.name,
      labels: dp.labels,
    });

    const incomingExemplars =
      dp.exemplars?.map((e) => toStoredExemplar(e)) ?? [];
    const existing = series.get(seriesId);
    if (existing) {
      existing.datapointCount += 1;
      existing.type = dp.type;
      existing.counterKind = counterKind;
      existing.unit = unit;
      if (incomingExemplars.length > 0) {
        existing.exemplars = mergeExemplars({
          parts: [...existing.exemplars, ...incomingExemplars],
        });
      }
    } else {
      series.set(seriesId, {
        seriesId,
        name: dp.name,
        labels: dp.labels,
        type: dp.type,
        counterKind,
        unit,
        datapointCount: 1,
        exemplars: mergeExemplars({ parts: incomingExemplars }),
      });
    }

    // Latest registry info per name wins.
    names.set(dp.name, { name: dp.name, type: dp.type, counterKind, unit });

    const bucketStart = floorToMinute(dp.ts);
    const key = `${seriesId}|${bucketStart.getTime()}`;
    const deltaContribution = counterKind === "delta" ? dp.value : 0;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.sum += dp.value;
      if (dp.value < bucket.min) bucket.min = dp.value;
      if (dp.value > bucket.max) bucket.max = dp.value;
      bucket.deltaSum += deltaContribution;
      if (dp.ts.getTime() >= bucket.lastTs.getTime()) {
        bucket.last = dp.value;
        bucket.lastTs = dp.ts;
      }
    } else {
      buckets.set(key, {
        seriesId,
        bucketStart,
        count: 1,
        sum: dp.value,
        min: dp.value,
        max: dp.value,
        last: dp.value,
        lastTs: dp.ts,
        deltaSum: deltaContribution,
      });
    }

    processed += 1;
    if (processed % yieldEvery === 0) await yieldToEventLoop();
  }

  return { series, buckets, names, total: items.length };
}

/** Storage surface the flush transaction body needs (a subset of {@link Storage}). */
export type FlushStorage = Pick<
  Storage,
  | "selectExistingSeriesIds"
  | "countStreamSeries"
  | "insertNewSeries"
  | "touchSeriesLastSeen"
  | "upsertMetricNames"
  | "upsertMinuteBuckets"
  | "touchStreamActivity"
  | "updateSeriesExemplars"
>;

/** What one flush transaction admitted / dropped (post-commit effects read this). */
export interface FlushOutcome {
  admittedNewSeries: number;
  droppedSeries: number;
  droppedDatapoints: number;
  /** Datapoints actually folded into buckets (total minus dropped-series ones). */
  persistedDatapoints: number;
}

/**
 * The flush transaction body: apply a {@link SeriesFold} to storage inside the
 * caller's `runner`. Enforces the cardinality cap by RE-checking the live series
 * count against the fold's NEW candidates (existing series are never capped),
 * inserting only the admitted new series and folding buckets for admitted +
 * existing series - dropped-series datapoints are counted, not persisted.
 */
export async function writeFlushPlan({
  runner,
  storage,
  streamId,
  fold,
  config,
  flushAt,
  rateEstimate,
}: {
  runner: Runner;
  storage: FlushStorage;
  streamId: string;
  fold: SeriesFold;
  config: MetricStreamConfig;
  flushAt: Date;
  rateEstimate: number;
}): Promise<FlushOutcome> {
  const allSeriesIds = [...fold.series.keys()];
  const existing = await storage.selectExistingSeriesIds({
    runner,
    seriesIds: allSeriesIds,
  });
  const newCandidates = allSeriesIds.filter((id) => !existing.has(id));

  const existingCount = await storage.countStreamSeries({ runner, streamId });
  const { admitted, dropped } = partitionNewSeries({
    existingCount,
    cap: config.seriesCap,
    candidates: newCandidates,
  });
  const droppedSet = new Set(dropped);

  // Insert admitted NEW series; advance existing series' lastSeenAt.
  const newRows = admitted.map((id) => {
    const s = fold.series.get(id)!;
    return {
      id,
      streamId,
      name: s.name,
      labels: s.labels,
      counterKind: s.counterKind,
      firstSeenAt: flushAt,
      lastSeenAt: flushAt,
      // Seed exemplars on the admitting insert so a brand-new series' first
      // jump-off is not lost until the next flush.
      ...(s.exemplars.length > 0 ? { lastExemplars: s.exemplars } : {}),
    };
  });
  // `insertedIds` are the series ACTUALLY inserted here - excluding any that a
  // concurrent pod inserted first (DO NOTHING). Their datapoints STILL fold into
  // buckets below (the series exists either way); only the metric-name count must
  // reflect the truly-new rows, or a cross-pod duplicate over-counts seriesCount
  // and permanently blocks that name's cleanup.
  const insertedIds = await storage.insertNewSeries({ runner, rows: newRows });
  const existingIds = allSeriesIds.filter((id) => existing.has(id));
  await storage.touchSeriesLastSeen({
    runner,
    seriesIds: existingIds,
    lastSeenAt: flushAt,
  });

  // Overwrite `last_exemplars` for EXISTING series that carried new exemplars
  // this flush (admitted-new series already got theirs in the insert). Skip
  // series with none so a quiet flush keeps the last known jump-off.
  const exemplarUpdates: SeriesExemplarUpdate[] = [];
  for (const id of existingIds) {
    const s = fold.series.get(id)!;
    if (s.exemplars.length > 0) {
      exemplarUpdates.push({ seriesId: id, exemplars: s.exemplars });
    }
  }
  await storage.updateSeriesExemplars({ runner, updates: exemplarUpdates });

  // Metric-name registry: seriesCountDelta = ACTUALLY-inserted new series per
  // name; only upsert names that have at least one SURVIVING series (a name whose
  // every series was capped must not appear in autocomplete with a phantom count).
  const nameDelta = new Map<string, number>();
  for (const id of insertedIds) {
    const name = fold.series.get(id)!.name;
    nameDelta.set(name, (nameDelta.get(name) ?? 0) + 1);
  }
  const survivingNames = new Set<string>();
  for (const id of allSeriesIds) {
    if (!droppedSet.has(id)) survivingNames.add(fold.series.get(id)!.name);
  }
  const nameUpserts = [...fold.names.values()]
    .filter((n) => survivingNames.has(n.name))
    .map((n) => ({
      streamId,
      name: n.name,
      type: n.type,
      counterKind: n.counterKind,
      unit: n.unit,
      help: null,
      seriesCountDelta: nameDelta.get(n.name) ?? 0,
      lastSeenAt: flushAt,
    }));
  await storage.upsertMetricNames({ runner, upserts: nameUpserts });

  // Buckets: everything except dropped-series datapoints.
  const bucketDeltas = [...fold.buckets.values()].filter(
    (b) => !droppedSet.has(b.seriesId),
  );
  await storage.upsertMinuteBuckets({ runner, deltas: bucketDeltas });

  let droppedDatapoints = 0;
  for (const id of dropped) droppedDatapoints += fold.series.get(id)!.datapointCount;
  const persistedDatapoints = fold.total - droppedDatapoints;

  await storage.touchStreamActivity({
    runner,
    streamId,
    receivedAt: flushAt,
    rateEstimate,
    droppedSeries: dropped.length,
    droppedDatapoints,
  });

  return {
    admittedNewSeries: admitted.length,
    droppedSeries: dropped.length,
    droppedDatapoints,
    persistedDatapoints,
  };
}

/** Per-stream activity debounce + series-cap event dedup bookkeeping (pod-local). */
interface StreamFlushState {
  lastActivityBroadcastMs: number;
  pendingDatapointsDelta: number;
  lastSeriesCapEventMs: number;
  lastFlushMs: number;
}

/** The stream flusher: drives one flush cycle across every stream in a drained batch. */
export interface MetricFlusher {
  /** Fold + persist every stream in a drained batch, then run post-commit effects. */
  flushDrained(drained: Map<string, BufferedDatapoint[]>): Promise<void>;
}

/**
 * Build the stream flusher. Owns the per-stream debounce/dedup state; the flush
 * loop's `runCycle` drains the buffer and calls {@link MetricFlusher.flushDrained}.
 */
export function createMetricFlusher({
  db,
  storage,
  recorder,
  signalService,
  configResolver,
  logger,
  flushIntervalMs,
  now = () => new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  storage: FlushStorage;
  recorder: ImportantEventRecorder;
  signalService: SignalService;
  configResolver: StreamConfigResolver;
  logger: Logger;
  /** Timer period, used to seed the first flush's rate estimate. */
  flushIntervalMs: number;
  now?: () => Date;
}): MetricFlusher {
  const state = new Map<string, StreamFlushState>();

  function stateFor(streamId: string): StreamFlushState {
    let s = state.get(streamId);
    if (!s) {
      s = {
        lastActivityBroadcastMs: 0,
        pendingDatapointsDelta: 0,
        lastSeriesCapEventMs: 0,
        lastFlushMs: 0,
      };
      state.set(streamId, s);
    }
    return s;
  }

  async function flushStream(
    streamId: string,
    items: BufferedDatapoint[],
  ): Promise<void> {
    if (items.length === 0) return;
    const flushAt = now();
    const s = stateFor(streamId);

    // Instantaneous per-flush rate estimate for the denormalized activity row.
    const elapsedMs =
      s.lastFlushMs > 0
        ? Math.max(1, flushAt.getTime() - s.lastFlushMs)
        : flushIntervalMs;
    s.lastFlushMs = flushAt.getTime();
    const rateEstimate = (items.length / elapsedMs) * 60_000;

    const config = await configResolver.resolve(streamId);
    const fold = await foldDatapoints({ streamId, items });

    let outcome: FlushOutcome;
    try {
      outcome = await withScopedTransaction(db, (tx) =>
        writeFlushPlan({
          runner: tx,
          storage,
          streamId,
          fold,
          config,
          flushAt,
          rateEstimate,
        }),
      );
    } catch (error) {
      logger.error(
        `metricstream: flush write failed for ${streamId}, dropping ${items.length} datapoints: ${String(error)}`,
      );
      return;
    }

    // Post-commit: series-cap event (deduped) + debounced activity signal.
    if (outcome.droppedSeries > 0) {
      await maybeRecordSeriesCap({ streamId, s, flushAt, outcome, config });
    }
    maybeBroadcastActivity({
      streamId,
      s,
      flushAt,
      delta: outcome.persistedDatapoints,
    });
  }

  async function maybeRecordSeriesCap({
    streamId,
    s,
    flushAt,
    outcome,
    config,
  }: {
    streamId: string;
    s: StreamFlushState;
    flushAt: Date;
    outcome: FlushOutcome;
    config: MetricStreamConfig;
  }): Promise<void> {
    const nowMs = flushAt.getTime();
    if (nowMs - s.lastSeriesCapEventMs < SERIES_CAP_EVENT_DEDUP_MS) return;
    s.lastSeriesCapEventMs = nowMs;
    try {
      await recorder.record({
        streamId,
        ts: flushAt,
        type: "series_cap",
        title: `Series cap reached (${config.seriesCap})`,
        detail: {
          seriesCap: config.seriesCap,
          droppedSeries: outcome.droppedSeries,
          droppedDatapoints: outcome.droppedDatapoints,
        },
      });
    } catch (error) {
      logger.warn(
        `metricstream: failed to record series_cap event for ${streamId}: ${String(error)}`,
      );
    }
  }

  function maybeBroadcastActivity({
    streamId,
    s,
    flushAt,
    delta,
  }: {
    streamId: string;
    s: StreamFlushState;
    flushAt: Date;
    delta: number;
  }): void {
    s.pendingDatapointsDelta += delta;
    const nowMs = flushAt.getTime();
    if (nowMs - s.lastActivityBroadcastMs < ACTIVITY_DEBOUNCE_MS) return;
    const datapointsDelta = s.pendingDatapointsDelta;
    s.lastActivityBroadcastMs = nowMs;
    s.pendingDatapointsDelta = 0;
    void signalService
      .broadcast(METRICSTREAM_ACTIVITY, { streamId, datapointsDelta })
      .catch((error: unknown) =>
        logger.warn(
          `metricstream: activity broadcast failed for ${streamId}: ${String(error)}`,
        ),
      );
  }

  return {
    async flushDrained(drained) {
      for (const [streamId, items] of drained) {
        await flushStream(streamId, items);
      }
    },
  };
}
