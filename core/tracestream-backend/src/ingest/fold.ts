/**
 * The flush FOLD: turn a drained batch of {@link PreparedSpan}s for ONE stream
 * into the set-based writes the storage ports persist. Pure and multi-pod-safe -
 * per-trace summary extent and per-operation aggregates are folded here and the
 * stores accumulate them across flushes, so no per-pod trace state is required.
 *
 * The fold is split into composable steps so the pipeline can insert first and
 * then fold aggregates over ONLY the spans the store actually persisted:
 *
 * - {@link capStreamSpans} applies the per-flush-batch `maxSpansPerTrace` cap.
 * - {@link buildSpanInserts} turns the kept spans into insert rows.
 * - {@link foldAggregates} folds summaries / op-buckets / catalog sightings from
 *   a given span list.
 * - {@link keepPersistedSpans} narrows the kept spans to the subset the store
 *   reported as newly inserted (idempotent re-deliveries fold into nothing).
 *
 * Two cap policies apply during the fold:
 *
 * - `maxSpansPerTrace`: enforced PER FLUSH-BATCH per trace. When a trace's spans
 *   in THIS batch exceed the cap, the excess is dropped and counted (surfaced as
 *   a `span_cap_exceeded` important event by the pipeline). ROOT (parentless)
 *   spans are kept first so the summary's root service/op is never sacrificed to
 *   a burst of child spans. This is a documented approximation: a trace whose
 *   spans arrive spread across many flushes is not capped globally - the
 *   tail-sampling sweep and the summary's own span count bound the stored volume
 *   across flushes; the per-batch cap only sheds a single hostile burst.
 * - service / operation caps are enforced by {@link ServiceOpCatalogStore.touch}
 *   itself (it returns the drop counts); the fold only produces the sightings.
 */

import type {
  CatalogTouchInput,
  InsertSpanInput,
  InsertedSpanKey,
  OpBucketFoldInput,
  SummaryFlushInput,
} from "../storage";
import type { PreparedSpan } from "./prepare";

/** Everything one stream's flush writes, plus the drop bookkeeping for events. */
export interface FlushPlan {
  streamId: string;
  inserts: InsertSpanInput[];
  summaries: SummaryFlushInput[];
  buckets: OpBucketFoldInput[];
  catalogTouches: CatalogTouchInput[];
  /** Spans dropped by the per-flush-batch `maxSpansPerTrace` cap. */
  spanCapDropped: number;
  /** Spans actually persisted (drives the activity spans delta). */
  persistedSpanCount: number;
}

/** Result of the per-trace-per-batch span cap. */
export interface CappedSpans {
  /** Spans kept after the cap, roots first (their order is otherwise preserved). */
  kept: PreparedSpan[];
  /** Spans dropped by the `maxSpansPerTrace` cap. */
  spanCapDropped: number;
}

/** The aggregate writes folded from a span list (summaries + buckets + catalog). */
export interface FoldedAggregates {
  summaries: SummaryFlushInput[];
  buckets: OpBucketFoldInput[];
  catalogTouches: CatalogTouchInput[];
}

/**
 * Op-bucket accumulator: collects each span's raw duration so the store can
 * derive sum/min/max AND the p95 t-digest (see {@link OpBucketFoldInput}).
 */
interface BucketAccumulator {
  streamId: string;
  serviceName: string;
  spanName: string;
  bucketStart: Date;
  durationsMs: number[];
  errorCount: number;
}

/** Group a stream's spans by trace id, preserving arrival order within a trace. */
function groupByTrace(spans: PreparedSpan[]): Map<string, PreparedSpan[]> {
  const byTrace = new Map<string, PreparedSpan[]>();
  for (const span of spans) {
    const bucket = byTrace.get(span.traceId);
    if (bucket) bucket.push(span);
    else byTrace.set(span.traceId, [span]);
  }
  return byTrace;
}

/**
 * Apply the per-flush-batch `maxSpansPerTrace` cap. Within an over-cap trace the
 * ROOT (parentless) spans are kept first, then non-root spans in arrival order,
 * so a burst of child spans can never evict the root that carries the summary's
 * root service/op. The dropped count is the sum of the per-trace overflow.
 */
export function capStreamSpans({
  spans,
  maxSpansPerTrace,
}: {
  spans: PreparedSpan[];
  maxSpansPerTrace: number;
}): CappedSpans {
  const byTrace = groupByTrace(spans);
  const kept: PreparedSpan[] = [];
  let spanCapDropped = 0;

  for (const traceSpans of byTrace.values()) {
    if (traceSpans.length <= maxSpansPerTrace) {
      kept.push(...traceSpans);
      continue;
    }
    // Root-priority: parentless spans first, then the rest in arrival order.
    const roots = traceSpans.filter((s) => s.isRoot);
    const nonRoots = traceSpans.filter((s) => !s.isRoot);
    const prioritized = [...roots, ...nonRoots].slice(0, maxSpansPerTrace);
    kept.push(...prioritized);
    spanCapDropped += traceSpans.length - prioritized.length;
  }

  return { kept, spanCapDropped };
}

/** Turn kept spans into their insert rows (one row per span, order preserved). */
export function buildSpanInserts({
  streamId,
  spans,
}: {
  streamId: string;
  spans: PreparedSpan[];
}): InsertSpanInput[] {
  return spans.map((span) => ({
    streamId,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: span.kind,
    serviceName: span.serviceName,
    startTs: span.startTs,
    durationMs: span.durationMs,
    statusCode: span.statusCode,
    statusMessage: span.statusMessage,
    attributes: span.attributes,
    events: span.events,
    links: span.links,
    resourceAttributes: span.resourceAttributes,
  }));
}

/**
 * Narrow a span list to the subset the store reported as newly INSERTED. An
 * at-least-once re-delivery yields no inserted keys for its already-stored spans,
 * so those spans fold into no aggregate a second time.
 */
export function keepPersistedSpans({
  spans,
  insertedKeys,
}: {
  spans: PreparedSpan[];
  insertedKeys: InsertedSpanKey[];
}): PreparedSpan[] {
  const persisted = new Set(insertedKeys.map((k) => `${k.traceId} ${k.spanId}`));
  return spans.filter((s) => persisted.has(`${s.traceId} ${s.spanId}`));
}

/**
 * Fold a span list into its summary / op-bucket / catalog writes. Callers pass
 * ONLY the spans that were actually persisted so a duplicate span never inflates
 * a trace's span count or an operation's latency aggregate.
 */
export function foldAggregates({
  streamId,
  spans,
}: {
  streamId: string;
  spans: PreparedSpan[];
}): FoldedAggregates {
  const summaries: SummaryFlushInput[] = [];
  const bucketAcc = new Map<string, BucketAccumulator>();
  // Catalog sightings deduped to the latest (service, span): keep the newest
  // seenAt and the last-seen kind so `touch` folds one row per operation.
  const catalog = new Map<string, CatalogTouchInput>();

  for (const [traceId, traceSpans] of groupByTrace(spans)) {
    let minStart = traceSpans[0]!.startTs;
    let maxEnd = traceSpans[0]!.endTs;
    let errorSpanCount = 0;
    let rootServiceName: string | null = null;
    let rootSpanName: string | null = null;

    for (const span of traceSpans) {
      if (span.startTs < minStart) minStart = span.startTs;
      if (span.endTs > maxEnd) maxEnd = span.endTs;
      if (span.isError) errorSpanCount += 1;
      // First root span seen wins (the store coalesces the first non-null).
      if (span.isRoot && rootServiceName === null && rootSpanName === null) {
        rootServiceName = span.serviceName;
        rootSpanName = span.name;
      }

      // Operation aggregates + catalog only for spans that carry a service - an
      // unlabeled span has no service dimension to chart or catalog. It is still
      // stored + summarized above.
      if (span.serviceName !== null) {
        foldBucket({ acc: bucketAcc, streamId, serviceName: span.serviceName, span });
        foldCatalog({ catalog, serviceName: span.serviceName, span });
      }
    }

    summaries.push({
      streamId,
      traceId,
      startTs: minStart,
      lastSpanAt: maxEnd,
      spanCount: traceSpans.length,
      errorSpanCount,
      hasError: errorSpanCount > 0,
      rootServiceName,
      rootSpanName,
    });
  }

  return {
    summaries,
    buckets: [...bucketAcc.values()],
    catalogTouches: [...catalog.values()],
  };
}

/**
 * Fold one stream's prepared spans into the full flush plan (cap + build inserts
 * + fold aggregates over the kept spans). This composed form assumes every kept
 * span is persisted; the pipeline uses the individual steps above to fold only
 * over the store's actually-inserted subset.
 */
export function foldStreamSpans({
  streamId,
  spans,
  maxSpansPerTrace,
}: {
  streamId: string;
  spans: PreparedSpan[];
  maxSpansPerTrace: number;
}): FlushPlan {
  const { kept, spanCapDropped } = capStreamSpans({ spans, maxSpansPerTrace });
  const inserts = buildSpanInserts({ streamId, spans: kept });
  const { summaries, buckets, catalogTouches } = foldAggregates({ streamId, spans: kept });

  return {
    streamId,
    inserts,
    summaries,
    buckets,
    catalogTouches,
    spanCapDropped,
    persistedSpanCount: inserts.length,
  };
}

function foldBucket({
  acc,
  streamId,
  serviceName,
  span,
}: {
  acc: Map<string, BucketAccumulator>;
  streamId: string;
  serviceName: string;
  span: PreparedSpan;
}): void {
  const key = `${serviceName} ${span.name} ${span.bucketStart.getTime()}`;
  const existing = acc.get(key);
  if (existing) {
    existing.durationsMs.push(span.durationMs);
    if (span.isError) existing.errorCount += 1;
    return;
  }
  acc.set(key, {
    streamId,
    serviceName,
    spanName: span.name,
    bucketStart: span.bucketStart,
    durationsMs: [span.durationMs],
    errorCount: span.isError ? 1 : 0,
  });
}

function foldCatalog({
  catalog,
  serviceName,
  span,
}: {
  catalog: Map<string, CatalogTouchInput>;
  serviceName: string;
  span: PreparedSpan;
}): void {
  const key = `${serviceName} ${span.name}`;
  const existing = catalog.get(key);
  if (!existing || span.endTs > existing.seenAt) {
    catalog.set(key, {
      serviceName,
      spanName: span.name,
      kind: span.kind,
      seenAt: existing && existing.seenAt > span.endTs ? existing.seenAt : span.endTs,
    });
  }
}
