/**
 * Storage PORTS: the ONLY surface the jobs, ingest and API areas see. Every
 * type here is a pure domain type (drawn from `@checkstack/tracestream-common`
 * or defined locally) - there is deliberately NO drizzle import in this file, so
 * a consumer can never reach the ORM. The Postgres adapters under
 * `./postgres/*` implement these interfaces; `createStorage({ db })` (see
 * `./index.ts`) constructs and returns them all.
 *
 * USER DIRECTIVE: all storage is behind these ports; consumers never see the
 * database. Keep it that way - add a method here before reaching into a table.
 */

import type {
  BucketGrain,
  ImportantEvent,
  ImportantEventCursor,
  ListImportantEventsResult,
  RecordImportantEventInput,
  SearchTraces,
  SearchTracesResult,
  StreamForPicker,
  TraceOpBucket,
  TraceOperationInfo,
  TraceServiceInfo,
  TraceSpan,
  TraceStream,
  TraceStreamConfig,
  TraceStreamConfigInput,
  TraceStreamToken,
  TraceSummary,
  TraceTopService,
} from "@checkstack/tracestream-common";
import type { DecisionCandidate } from "./decision";

// ===========================================================================
// SHARED DOMAIN INPUT / ROW TYPES
// ===========================================================================

/** A stream's id paired with its fully-defaulted policy (jobs iterate these). */
export interface StreamPolicy {
  streamId: string;
  config: TraceStreamConfig;
}

/** One raw span to persist, as the ingest sink hands it to {@link SpanStore}. */
export interface InsertSpanInput {
  streamId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: TraceSpan["kind"];
  serviceName: string | null;
  startTs: Date;
  /** Precomputed `endTs - startTs` (the waterfall reads it directly). */
  durationMs: number;
  statusCode: TraceSpan["statusCode"];
  statusMessage: string | null;
  attributes: Record<string, unknown> | null;
  events: NonNullable<TraceSpan["events"]> | null;
  links: NonNullable<TraceSpan["links"]> | null;
  resourceAttributes: Record<string, unknown> | null;
}

/**
 * One trace's contribution from a single flush, folded into its summary row.
 * `startTs` is the MIN span start and `lastSpanAt` the MAX span end seen in this
 * flush; the store maintains `startTs = min`, `lastSpanAt = max` across flushes
 * and derives `durationMs = lastSpanAt - startTs`. `rootServiceName` /
 * `rootSpanName` are non-null only when a PARENTLESS (root) span was seen this
 * flush; the store keeps the first non-null (coalesce).
 */
export interface SummaryFlushInput {
  streamId: string;
  traceId: string;
  startTs: Date;
  lastSpanAt: Date;
  spanCount: number;
  errorSpanCount: number;
  hasError: boolean;
  rootServiceName: string | null;
  rootSpanName: string | null;
}

/**
 * A minute-bucket latency/volume contribution for one `(service, op)`. The
 * store derives `spanCount`/`durSum`/`durMin`/`durMax` AND the p95 t-digest from
 * the raw per-span `durationsMs`, so the caller passes each span's duration
 * rather than pre-aggregating them (the digest needs the individual samples).
 */
export interface OpBucketFoldInput {
  streamId: string;
  serviceName: string;
  spanName: string;
  /** Floored to the minute by the caller. */
  bucketStart: Date;
  /** Each span's duration (ms) in this bucket for this flush. */
  durationsMs: number[];
  /** How many of those spans were errors. */
  errorCount: number;
}

/** A `(service, op)` sighting to fold into the catalog. */
export interface CatalogTouchInput {
  serviceName: string;
  spanName: string;
  kind: TraceSpan["kind"];
  seenAt: Date;
}

/**
 * The identity of a span the store actually inserted. `insertSpans` dedupes
 * (intra-batch and via the unique index) and returns ONLY the keys it newly
 * wrote, so the flush folds summaries / buckets / catalog over the persisted
 * subset - a duplicate re-delivery contributes to no aggregate twice.
 */
export interface InsertedSpanKey {
  traceId: string;
  spanId: string;
}

/** Over-cap drops from a {@link ServiceOpCatalogStore.touch}, for events. */
export interface CatalogDrops {
  droppedServices: number;
  droppedOperations: number;
}

/** A stream's denormalized activity row (overview + silence detection). */
export interface TraceStreamActivity {
  streamId: string;
  lastReceivedAt: Date | null;
  approxSpansPerMinute: number;
  droppedSpansCount: number;
  droppedTracesCount: number;
  /**
   * Spans a SATELLITE dropped in transit (bounded-buffer overflow during a
   * disconnect / slow-consumer episode), attributed to this stream. Cumulative;
   * a distinct failure mode from the pipeline's own `droppedSpansCount`.
   */
  droppedInTransitCount: number;
}

/** Per-stream rollup of the streams-list counts (last 24h). */
export interface StreamSummaryCounts {
  streamId: string;
  traces24h: number;
  errorTraces24h: number;
}

/**
 * One MERGED latency/volume aggregate for a `(service, op?)` selection over a
 * whole `[from, to)` window (see {@link OpBucketStore.queryWindowLatency}). The
 * health `operation-latency` collector reads this. `p95Ms` is derived from the
 * t-digest merged across EVERY bucket in the window (never an average of
 * per-bucket p95s, which is statistically wrong). All-zero (`spanCount 0`,
 * null latencies) when the window has no matching buckets.
 */
export interface TraceWindowLatency {
  spanCount: number;
  errorCount: number;
  durSumMs: number;
  durMinMs: number | null;
  durMaxMs: number | null;
  p95Ms: number | null;
}

// ===========================================================================
// PORTS
// ===========================================================================

/** Stream rows + policies. Owns config merge/parse. */
export interface StreamStore {
  /** Every stream's id + defaulted policy (maintenance jobs iterate these). */
  listPolicies(): Promise<StreamPolicy[]>;
  list(): Promise<TraceStream[]>;
  listForPicker(): Promise<StreamForPicker[]>;
  get(args: { id: string }): Promise<TraceStream | null>;
  create(args: {
    name: string;
    description?: string | null;
    config?: TraceStreamConfigInput;
  }): Promise<TraceStream>;
  /** Merge `config` over the stored policy and re-parse; null when not found. */
  update(args: {
    id: string;
    name?: string;
    description?: string | null;
    config?: TraceStreamConfigInput;
  }): Promise<TraceStream | null>;
  /** Delete the stream ROW only (the data cascade is the per-port sweeps). */
  delete(args: { id: string }): Promise<void>;
}

/** Source tokens. Minting/hashing lives in ingest-utils; this only persists. */
export interface TokenStore {
  insert(args: {
    streamId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
  }): Promise<TraceStreamToken>;
  list(args: { streamId: string }): Promise<TraceStreamToken[]>;
  /** Revoke; returns the revoked token's hash (for cache invalidation) or null. */
  revoke(args: {
    streamId: string;
    tokenId: string;
  }): Promise<{ tokenHash: string } | null>;
  touchLastUsed(args: { tokenHash: string; at: Date }): Promise<void>;
  /** Ingest auth: resolve an active token by hash. */
  lookupByHash(args: { tokenHash: string }): Promise<{
    tokenId: string;
    streamId: string;
    revokedAt: Date | null;
  } | null>;
  /** All token hashes of a stream (captured before delete for cache clearing). */
  listHashesForStream(args: { streamId: string }): Promise<string[]>;
  deleteAllForStream(args: { streamId: string }): Promise<void>;
}

/** Raw stored spans of retained (or in-flight) traces. */
export interface SpanStore {
  /**
   * Insert spans idempotently: duplicates within the batch are collapsed
   * (keep-first) and rows already present (same `streamId, traceId, spanId`)
   * are skipped via the unique index. Returns the keys of the spans it actually
   * inserted, so the caller can fold aggregates over exactly the new spans.
   */
  insertSpans(args: { spans: InsertSpanInput[] }): Promise<InsertedSpanKey[]>;
  listSpansForTrace(args: {
    streamId: string;
    traceId: string;
  }): Promise<TraceSpan[]>;
  /** Delete every span of the given trace ids (hot-sweep of unretained traces). */
  deleteSpansOfTraces(args: {
    streamId: string;
    traceIds: string[];
  }): Promise<number>;
  /**
   * Delete spans older than `cutoff` in bounded batches (retained-trace
   * cleanup: by the time this runs, unretained spans were already hot-swept, so
   * a plain start-time delete only touches retained traces). Returns rows deleted.
   */
  deleteSpansBefore(args: {
    streamId: string;
    cutoff: Date;
    limit?: number;
  }): Promise<number>;
  deleteAllForStream(args: { streamId: string }): Promise<void>;
}

/** Lightweight per-trace summaries: the search index + decision surface. */
export interface TraceSummaryStore {
  upsertFromFlush(args: { summaries: SummaryFlushInput[] }): Promise<void>;
  /**
   * Undecided traces (`retained IS NULL`) whose last span landed at/before
   * `olderThan` (settled past the completion grace). Returns the decision
   * projection, oldest first, capped at `limit`.
   */
  listUndecidedReadyForDecision(args: {
    streamId: string;
    olderThan: Date;
    limit: number;
  }): Promise<DecisionCandidate[]>;
  /** Set the tail-sampling verdict for a batch of trace ids in one stream. */
  markDecided(args: {
    streamId: string;
    traceIds: string[];
    retained: boolean;
    decidedAt: Date;
  }): Promise<void>;
  /**
   * Count already-decided-RETAINED traces per start-hour for the given hour
   * starts (seeds the per-hour retention budget across pages/pods). Keyed by
   * the hour start's epoch-ms.
   */
  countRetainedByHour(args: {
    streamId: string;
    hourStarts: Date[];
  }): Promise<Map<number, number>>;
  searchSummaries(args: SearchTraces): Promise<SearchTracesResult>;
  getSummary(args: {
    streamId: string;
    traceId: string;
  }): Promise<TraceSummary | null>;
  /** Cross-stream jump-to-trace: every stream holding this trace id. */
  findByTraceId(args: {
    traceId: string;
  }): Promise<{ streamId: string; summary: TraceSummary }[]>;
  /** Unretained trace ids whose last span is older than `cutoff` (hot sweep). */
  listUnretainedTracesBefore(args: {
    streamId: string;
    cutoff: Date;
    limit: number;
  }): Promise<string[]>;
  /** Overview totals over `[since, now)`. */
  overviewTotals(args: {
    streamId: string;
    since: Date;
  }): Promise<{
    spans: number;
    traces: number;
    errorTraces: number;
    retainedTraces: number;
  }>;
  /** Up to `limit` slowest RETAINED traces since `since` (overview quick links). */
  slowestRetained(args: {
    streamId: string;
    since: Date;
    limit: number;
  }): Promise<TraceSummary[]>;
  /** Per-stream 24h counts for the streams-list page (one set-based batch). */
  countsForStreams(args: {
    streamIds: string[];
    since: Date;
  }): Promise<StreamSummaryCounts[]>;
  deleteSummariesBefore(args: {
    streamId: string;
    cutoff: Date;
    limit?: number;
  }): Promise<number>;
  deleteAllForStream(args: { streamId: string }): Promise<void>;
}

/** Windowed operation aggregates (minute + hourly tiers) for charts. */
export interface OpBucketStore {
  foldSpans(args: { folds: OpBucketFoldInput[] }): Promise<void>;
  /**
   * Roll every minute bucket older than `minuteCutoff` into its hourly bucket
   * and delete the folded minute rows, in bounded per-batch TRANSACTIONS
   * (fold + delete atomic per batch => idempotent on retry). Returns rows folded.
   */
  rollupMinuteToHourly(args: {
    streamId: string;
    minuteCutoff: Date;
    batchSize?: number;
  }): Promise<number>;
  /** Aggregate the tier's buckets for a `(service?, op?)` selection over `[from,to)`. */
  queryBuckets(args: {
    streamId: string;
    serviceName?: string;
    spanName?: string;
    from: Date;
    to: Date;
    grain: BucketGrain;
  }): Promise<TraceOpBucket[]>;
  /**
   * ONE merged aggregate for a `(service, op?)` selection over the WHOLE
   * `[from, to)` window - the health `operation-latency` collector's read. Unlike
   * {@link queryBuckets} (one row per bucket, each with its own p95), this merges
   * the t-digests of every matching bucket into a single digest and derives ONE
   * window p95, which is the only correct way to percentile across buckets. A
   * read REJECTION propagates (transport failure); an empty window is all-zero.
   */
  queryWindowLatency(args: {
    streamId: string;
    serviceName: string;
    spanName?: string;
    from: Date;
    to: Date;
    grain: BucketGrain;
  }): Promise<TraceWindowLatency>;
  /**
   * SUM of span + error counts across a `[from, to)` window at one tier, computed
   * ENTIRELY in SQL (`SUM(...)`). The health window collector and the error-spike
   * detection need only these two integers; going through {@link queryBuckets}
   * would fetch every bucket's t-digest blob and run `mergeTDigestStates` +
   * `percentileFromState` per bucket only to discard all of it - a real hot-path
   * cost on a stream erroring steadily (thousands of digest rows per flush). A
   * read REJECTION propagates (transport failure); an empty window is all-zero.
   */
  sumWindowCounts(args: {
    streamId: string;
    from: Date;
    to: Date;
    grain: BucketGrain;
  }): Promise<{ spanCount: number; errorSpanCount: number }>;
  /** Top services by span volume since `since` (overview). */
  topServices(args: {
    streamId: string;
    since: Date;
    limit: number;
  }): Promise<TraceTopService[]>;
  deleteHourlyBefore(args: {
    streamId: string;
    cutoff: Date;
    limit?: number;
  }): Promise<number>;
  deleteAllForStream(args: { streamId: string }): Promise<void>;
}

/** Service/operation catalog (autocomplete), cap-enforced. */
export interface ServiceOpCatalogStore {
  /**
   * Fold sightings into the catalog, enforcing `serviceCap` /
   * `operationCapPerService`: a sighting that would introduce a NEW service (or
   * a new operation for a service) past its cap is dropped. Returns the drop
   * counts so the caller can record cap-exceeded important events.
   */
  touch(args: {
    streamId: string;
    entries: CatalogTouchInput[];
    serviceCap: number;
    operationCapPerService: number;
  }): Promise<CatalogDrops>;
  listServices(args: { streamId: string }): Promise<TraceServiceInfo[]>;
  listOperations(args: {
    streamId: string;
    serviceName: string;
  }): Promise<TraceOperationInfo[]>;
  /** Per-stream distinct service counts for the streams-list page. */
  serviceCountsForStreams(args: {
    streamIds: string[];
  }): Promise<Map<string, number>>;
  /** Drop catalog entries not seen since `cutoff` (Phase 3 adds ref-protection). */
  deleteStale(args: {
    streamId: string;
    cutoff: Date;
    limit?: number;
  }): Promise<number>;
  deleteAllForStream(args: { streamId: string }): Promise<void>;
}

/** Denormalized per-stream activity (one row, one update per flush). */
export interface ActivityStore {
  touch(args: {
    streamId: string;
    receivedAt: Date;
    rateEstimate: number;
    droppedSpans?: number;
    droppedTraces?: number;
  }): Promise<void>;
  /**
   * Add a satellite's in-transit drop count to a stream's running total (upsert-
   * increment). Called by the satellite telemetry handler once per stream from a
   * forwarded batch's per-group `droppedByGroup`. No-op for a non-positive count.
   * Independent of `touch` so it never advances `lastReceivedAt` / the rate.
   */
  addInTransitDrops(args: { streamId: string; dropped: number }): Promise<void>;
  read(args: { streamId: string }): Promise<TraceStreamActivity | null>;
  /** Every stream's `(streamId, lastReceivedAt)` (silence detection scan). */
  listActivity(): Promise<{ streamId: string; lastReceivedAt: Date | null }[]>;
  lastReceivedForStreams(args: {
    streamIds: string[];
  }): Promise<Map<string, Date | null>>;
  deleteAllForStream(args: { streamId: string }): Promise<void>;
}

/** Viewer-timeline important events. */
export interface ImportantEventStore {
  /** Persist one event (the recorder wraps this to also broadcast the signal). */
  insert(
    input: RecordImportantEventInput,
    options?: { createdAt?: Date },
  ): Promise<ImportantEvent>;
  list(args: {
    streamId: string;
    cursor?: ImportantEventCursor;
    limit: number;
  }): Promise<ListImportantEventsResult>;
  /** Latest marker event type per stream, restricted to `types` (silence dedup). */
  lastMarkerByStream(args: {
    types: string[];
  }): Promise<Map<string, string>>;
  /**
   * Timestamp (`ts`) of the most recent event of `type` for a stream, or null
   * when none. Cluster-wide (reads the shared table), so the error-spike
   * detection dedupes one spike per stream per window across every pod.
   */
  lastEventAt(args: { streamId: string; type: string }): Promise<Date | null>;
  deleteBefore(args: { streamId: string; cutoff: Date }): Promise<void>;
  deleteAllForStream(args: { streamId: string }): Promise<void>;
}

/**
 * The write ports a single flush composes, each bound to ONE shared
 * transaction (see {@link Storage.withFlushTransaction}). Only the methods a
 * flush issues are exposed - the transaction boundary stays hidden behind the
 * port surface (no drizzle runner leaks to the caller).
 */
export interface FlushPorts {
  spans: Pick<SpanStore, "insertSpans">;
  summaries: Pick<TraceSummaryStore, "upsertFromFlush">;
  opBuckets: Pick<OpBucketStore, "foldSpans">;
  serviceOps: Pick<ServiceOpCatalogStore, "touch">;
  activity: Pick<ActivityStore, "touch">;
}

/** The full port set returned by `createStorage`. */
export interface Storage {
  streams: StreamStore;
  tokens: TokenStore;
  spans: SpanStore;
  summaries: TraceSummaryStore;
  opBuckets: OpBucketStore;
  serviceOps: ServiceOpCatalogStore;
  activity: ActivityStore;
  importantEvents: ImportantEventStore;
  /** Cascade every stream-scoped table's `deleteAllForStream` (data only). */
  deleteStreamData(args: { streamId: string }): Promise<void>;
  /**
   * Run a flush's writes in ONE transaction: `fn` receives write ports bound to
   * the transaction, so either every write commits or none do. The caller never
   * sees the transaction runner (drizzle stays behind the ports). The returned
   * `ServiceOpCatalogStore.touch` drop counts are only valid AFTER the
   * transaction commits, so read them from `fn`'s captured result post-return.
   */
  withFlushTransaction(fn: (ports: FlushPorts) => Promise<void>): Promise<void>;
}
