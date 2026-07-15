import {
  pgTable,
  text,
  bigint,
  integer,
  doublePrecision,
  jsonb,
  timestamp,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  TraceStreamConfig,
  TraceSpan,
  ImportantEventType,
} from "@checkstack/tracestream-common";

/**
 * Plugin database schema (schema-scoped: the runtime routes every query to the
 * plugin's isolated Postgres schema via `search_path`, so tables are defined
 * schema-agnostically and carry NO cross-schema FKs). Cleanup on stream delete
 * is explicit, per-table, in the storage layer's `deleteAllForStream` ports -
 * matching metricstream/logstream, which also avoid FKs so drizzle-kit never
 * emits a `public`-qualified FK target that would break the scoped migration.
 */

/**
 * Trace stream definition. The only team-scopable resource here (RLAC keys
 * grants on `tracestream.stream`); spans / summaries / buckets / events
 * are all scoped by their owning `streamId`. `config` carries the tiered
 * retention + tail-sampling + cap policy (see `TraceStreamConfigSchema`).
 */
export const traceStreams = pgTable("trace_streams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  config: jsonb("config").$type<TraceStreamConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Raw stored spans of RETAINED (or still-in-flight) traces. `id` is a bigint
 * identity (cheap, monotonic) serialized to a string in the DTO because a JS
 * number cannot hold a 64-bit id. `durationMs` is precomputed (`endTs -
 * startTs`) so the waterfall needs no per-row math; `endTs` is derived on read
 * from `startTs + durationMs`. `serviceName` is broken out of
 * `resourceAttributes` because it is the primary grouping dimension. Kept only
 * for `hotRetentionHours` while a trace is unretained, then for
 * `retainedTraceRetentionDays` once retained.
 */
export const traceSpans = pgTable(
  "trace_spans",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    streamId: text("stream_id").notNull(),
    traceId: text("trace_id").notNull(),
    spanId: text("span_id").notNull(),
    parentSpanId: text("parent_span_id"),
    name: text("name").notNull(),
    kind: text("kind").$type<TraceSpan["kind"]>().notNull(),
    serviceName: text("service_name"),
    startTs: timestamp("start_ts", { withTimezone: true }).notNull(),
    durationMs: doublePrecision("duration_ms").notNull(),
    statusCode: text("status_code").$type<TraceSpan["statusCode"]>().notNull(),
    statusMessage: text("status_message"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    events: jsonb("events").$type<NonNullable<TraceSpan["events"]>>(),
    links: jsonb("links").$type<NonNullable<TraceSpan["links"]>>(),
    resourceAttributes:
      jsonb("resource_attributes").$type<Record<string, unknown>>(),
  },
  (t) => [
    // At-least-once OTLP delivery means the same (traceId, spanId) can arrive
    // more than once; this unique index makes span inserts idempotent
    // (ON CONFLICT DO NOTHING) and also serves the (streamId, traceId) lookups
    // by its leading prefix, so the old non-unique (streamId, traceId) index is
    // redundant and dropped.
    uniqueIndex("trace_spans_stream_trace_span_uq").on(
      t.streamId,
      t.traceId,
      t.spanId,
    ),
    index("trace_spans_stream_start_idx").on(t.streamId, t.startTs.desc()),
  ],
);

/**
 * A lightweight per-trace summary row. Written for EVERY trace (retained or
 * not) and drives search + overview; it outlives the raw spans as the
 * searchable index (spans age out at `hotRetentionHours`, summaries at
 * `summaryRetentionDays`). `retained` is tri-state: NULL while the trace is
 * still assembling (tail-sampling not yet decided), then `true`/`false` once
 * the decision job lands. `durationMs` is maintained as
 * `max(endTs) - min(startTs)` across flushes.
 */
export const traceSummaries = pgTable(
  "trace_summaries",
  {
    streamId: text("stream_id").notNull(),
    traceId: text("trace_id").notNull(),
    rootServiceName: text("root_service_name"),
    rootSpanName: text("root_span_name"),
    startTs: timestamp("start_ts", { withTimezone: true }).notNull(),
    durationMs: doublePrecision("duration_ms").notNull(),
    spanCount: integer("span_count").notNull().default(0),
    errorSpanCount: integer("error_span_count").notNull().default(0),
    hasError: boolean("has_error").notNull().default(false),
    /** NULL = tail-sampling undecided (trace still assembling). */
    retained: boolean("retained"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    lastSpanAt: timestamp("last_span_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.streamId, t.traceId] }),
    index("trace_summaries_stream_start_idx").on(t.streamId, t.startTs.desc()),
    // Drives the decision job's "undecided + settled" scan.
    index("trace_summaries_decision_idx").on(
      t.streamId,
      t.retained,
      t.lastSpanAt,
    ),
    // Cross-stream jump-to-trace by id (findTraceById).
    index("trace_summaries_trace_idx").on(t.traceId),
  ],
);

/**
 * Per-stream service/operation catalog: one row per distinct
 * `(serviceName, spanName)` seen, driving the service/operation autocomplete
 * WITHOUT scanning spans. `kind` is the last-seen span kind for the operation.
 * Bounded by `serviceCap` / `operationCapPerService` at fold time (over-cap
 * entries are dropped and surfaced as an important event).
 */
export const traceServiceOps = pgTable(
  "trace_service_ops",
  {
    streamId: text("stream_id").notNull(),
    serviceName: text("service_name").notNull(),
    spanName: text("span_name").notNull(),
    kind: text("kind").$type<TraceSpan["kind"]>().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.streamId, t.serviceName, t.spanName] }),
    index("trace_service_ops_stream_service_idx").on(
      t.streamId,
      t.serviceName,
    ),
    index("trace_service_ops_stream_last_seen_idx").on(
      t.streamId,
      t.lastSeenAt,
    ),
  ],
);

/**
 * Per-operation, per-minute latency/volume aggregate over the spans matching a
 * `(serviceName, spanName)` selection. `durSumMs`/`durMinMs`/`durMaxMs` fold
 * additively / by extremum; `digest` holds the serialized t-digest (backend-api
 * tdigest module) that `queryBuckets` reads real `p95Ms` from - NULL only on
 * rows written before the digest path existed. Retention:
 * `minuteRetentionHours` before rollup.
 */
export const traceOpMinuteBuckets = pgTable(
  "trace_op_minute_buckets",
  {
    streamId: text("stream_id").notNull(),
    serviceName: text("service_name").notNull(),
    spanName: text("span_name").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    spanCount: bigint("span_count", { mode: "number" }).notNull().default(0),
    errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
    durSumMs: doublePrecision("dur_sum_ms").notNull().default(0),
    durMinMs: doublePrecision("dur_min_ms"),
    durMaxMs: doublePrecision("dur_max_ms"),
    /** Serialized t-digest backing p95 reads; NULL only on pre-digest rows. */
    digest: jsonb("digest").$type<number[]>(),
  },
  (t) => [
    primaryKey({
      columns: [t.streamId, t.serviceName, t.spanName, t.bucketStart],
    }),
    index("trace_op_minute_buckets_ts_idx").on(t.bucketStart),
    index("trace_op_minute_buckets_stream_ts_idx").on(t.streamId, t.bucketStart),
  ],
);

/** Per-operation, per-hour aggregate (rolled up from minute). Retention: hourly. */
export const traceOpHourlyBuckets = pgTable(
  "trace_op_hourly_buckets",
  {
    streamId: text("stream_id").notNull(),
    serviceName: text("service_name").notNull(),
    spanName: text("span_name").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    spanCount: bigint("span_count", { mode: "number" }).notNull().default(0),
    errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
    durSumMs: doublePrecision("dur_sum_ms").notNull().default(0),
    durMinMs: doublePrecision("dur_min_ms"),
    durMaxMs: doublePrecision("dur_max_ms"),
    digest: jsonb("digest").$type<number[]>(),
  },
  (t) => [
    primaryKey({
      columns: [t.streamId, t.serviceName, t.spanName, t.bucketStart],
    }),
    index("trace_op_hourly_buckets_ts_idx").on(t.bucketStart),
    index("trace_op_hourly_buckets_stream_ts_idx").on(t.streamId, t.bucketStart),
  ],
);

/**
 * One row per stream, updated once per flush (never per span). Holds the
 * denormalized activity markers + cap-drop counters the overview page reads.
 * Mirrors `metric_stream_activity`.
 */
export const traceStreamActivity = pgTable("trace_stream_activity", {
  streamId: text("stream_id").primaryKey(),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  approxSpansPerMinute: bigint("approx_spans_per_minute", { mode: "number" })
    .notNull()
    .default(0),
  droppedSpansCount: bigint("dropped_spans_count", { mode: "number" })
    .notNull()
    .default(0),
  droppedTracesCount: bigint("dropped_traces_count", { mode: "number" })
    .notNull()
    .default(0),
  // Spans a SATELLITE dropped from its bounded in-transit buffer during a
  // disconnect / slow-consumer episode, attributed to this stream via each
  // forwarded batch's per-group `droppedByGroup`. A distinct failure mode from
  // the pipeline's rate-limit / buffer-full drops (`droppedSpansCount`) - this is
  // telemetry that never reached core at all. Cumulative. Mirrors logstream's
  // `dropped_in_transit_count`.
  droppedInTransitCount: bigint("dropped_in_transit_count", { mode: "number" })
    .notNull()
    .default(0),
});

/**
 * Explicit stream -> catalog-system links (the Phase 4 catalog integration).
 * FK-less by design like every other table here (schema-scoped, no cross-schema
 * FKs): `systemId` is a BARE catalog id this schema never owns, and `streamId`
 * references `trace_streams` the same FK-less way every other table here does.
 * The `(streamId, systemId)` PK makes the replace-all set idempotent; the
 * reverse index on `systemId` serves the system-page direction
 * (`listStreamsForSystem` / `listLinkedStreamStatuses`).
 */
export const traceStreamSystemLinks = pgTable(
  "trace_stream_system_links",
  {
    streamId: text("stream_id").notNull(),
    systemId: text("system_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.streamId, t.systemId] }),
    index("trace_stream_system_links_system_idx").on(t.systemId),
  ],
);

/** Viewer-timeline events (silence, rate-limited, span/service/operation-cap). */
export const traceImportantEvents = pgTable(
  "trace_important_events",
  {
    id: text("id").primaryKey(),
    streamId: text("stream_id").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    type: text("type").$type<ImportantEventType>().notNull(),
    title: text("title").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("trace_important_events_stream_ts_idx").on(t.streamId, t.ts.desc()),
  ],
);
