import {
  pgTable,
  text,
  bigint,
  doublePrecision,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import type {
  MetricStreamConfig,
  MetricType,
  CounterKind,
  ImportantEventType,
} from "@checkstack/metricstream-common";

/**
 * Metric stream definition. Team-scoped resource (RLAC keys grants on
 * `metricstream.stream`). `config` carries the caps/retention policy; see
 * `MetricStreamConfigSchema`.
 */
export const metricStreams = pgTable("metric_streams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  config: jsonb("config").$type<MetricStreamConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Explicit stream -> catalog-system links (see telemetry-common's
 * `system-links.ts`). A stream is linked to N systems and a system to N streams,
 * so the mapping is its own junction table keyed on the pair.
 *
 * `systemId` is a BARE text column, NOT a FK: catalog systems live in another
 * plugin's schema, and (like every other stream-scoped table here) no FK is
 * emitted so drizzle-kit never targets a `public`-qualified relation the
 * schema-scoped migration cannot resolve. Rows are cleaned up explicitly on
 * stream delete; an orphaned link (system deleted elsewhere) simply resolves to
 * nothing on read. `streamId` mirrors `metricStreamTokens.streamId`.
 *
 * The reverse index serves the system-page direction (`listStreamsForSystem` /
 * `listLinkedStreamStatuses`), which looks up by `systemId`.
 */
export const metricStreamSystemLinks = pgTable(
  "metric_stream_system_links",
  {
    streamId: text("stream_id").notNull(),
    systemId: text("system_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.streamId, t.systemId] }),
    index("metric_stream_system_links_system_idx").on(t.systemId),
  ],
);

/**
 * Registered metric names per stream. Drives the metric autocomplete WITHOUT
 * scanning the series table. `seriesCount` is maintained as series are
 * admitted/removed. PK (stream, name).
 */
export const metricNames = pgTable(
  "metric_names",
  {
    streamId: text("stream_id").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<MetricType>().notNull(),
    counterKind: text("counter_kind").$type<CounterKind>(),
    unit: text("unit"),
    help: text("help"),
    seriesCount: bigint("series_count", { mode: "number" })
      .notNull()
      .default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.streamId, t.name] })],
);

/**
 * One trace-context exemplar as STORED on a series (the jsonb shape of
 * `metric_series.last_exemplars`). `ts` is epoch millis, not a `Date`: jsonb has
 * no Date type, so storing a number keeps the round-trip lossless (a `Date` would
 * come back a string and silently break comparisons). Kept small + bounded - a
 * chart-to-trace jump-off, never a series to aggregate.
 */
export interface StoredExemplar {
  traceId: string;
  spanId?: string;
  value: number;
  /** Exemplar timestamp as epoch millis. */
  tsMs: number;
}

/**
 * Concrete series: a metric name + a specific label set. `id` = sha256 of
 * `streamId + " " + name + " " + canonicalLabelString` so identical series
 * converge to one id across pods. The label-value autocomplete source (bounded
 * DISTINCT queries over `(streamId, name)`). `counterKind` tags the series
 * flavor once (see the read-time rate math).
 *
 * `lastExemplars` holds the newest few {@link StoredExemplar}s seen for this
 * series (MERGED on flush when a batch carries exemplars, keeping the newest few
 * deduped by trace id) - the chart's jump-off to the trace behind a point.
 * Bounded, retention-free (dropped with the series row), and NULL until the
 * first exemplar arrives.
 */
export const metricSeries = pgTable(
  "metric_series",
  {
    id: text("id").primaryKey(),
    streamId: text("stream_id").notNull(),
    name: text("name").notNull(),
    labels: jsonb("labels").$type<Record<string, string>>().notNull(),
    counterKind: text("counter_kind").$type<CounterKind>(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastExemplars: jsonb("last_exemplars").$type<StoredExemplar[]>(),
  },
  (t) => [
    index("metric_series_stream_name_idx").on(t.streamId, t.name),
    index("metric_series_stream_last_seen_idx").on(
      t.streamId,
      t.lastSeenAt.desc(),
    ),
  ],
);

/**
 * Per-series, per-minute aggregate. `last`/`lastTs` follow latest-lastTs-wins
 * semantics (the SQL upsert only overwrites `last` when the incoming `lastTs` is
 * newer). `deltaSum` accumulates delta-counter increments; cumulative counters
 * carry their total in `last`. Retention: `minuteRetentionHours`.
 */
export const metricMinuteBuckets = pgTable(
  "metric_minute_buckets",
  {
    seriesId: text("series_id").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    sum: doublePrecision("sum").notNull().default(0),
    min: doublePrecision("min").notNull(),
    max: doublePrecision("max").notNull(),
    last: doublePrecision("last").notNull(),
    lastTs: timestamp("last_ts", { withTimezone: true }).notNull(),
    deltaSum: doublePrecision("delta_sum").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.bucketStart] }),
    index("metric_minute_buckets_ts_idx").on(t.bucketStart),
  ],
);

/** Per-series, per-hour aggregate (rolled up from minute). Retention: hourly. */
export const metricHourlyBuckets = pgTable(
  "metric_hourly_buckets",
  {
    seriesId: text("series_id").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    sum: doublePrecision("sum").notNull().default(0),
    min: doublePrecision("min").notNull(),
    max: doublePrecision("max").notNull(),
    last: doublePrecision("last").notNull(),
    lastTs: timestamp("last_ts", { withTimezone: true }).notNull(),
    deltaSum: doublePrecision("delta_sum").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.seriesId, t.bucketStart] }),
    index("metric_hourly_buckets_ts_idx").on(t.bucketStart),
  ],
);

/**
 * One row per stream, updated once per flush (never per datapoint). Holds the
 * denormalized activity markers + cardinality-drop counters the overview page
 * reads.
 */
export const metricStreamActivity = pgTable("metric_stream_activity", {
  streamId: text("stream_id").primaryKey(),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  approxDatapointsPerMinute: bigint("approx_datapoints_per_minute", {
    mode: "number",
  })
    .notNull()
    .default(0),
  droppedSeriesCount: bigint("dropped_series_count", { mode: "number" })
    .notNull()
    .default(0),
  droppedDatapointsCount: bigint("dropped_datapoints_count", { mode: "number" })
    .notNull()
    .default(0),
  /**
   * Datapoints a SATELLITE dropped from its bounded in-transit buffer during a
   * disconnect / slow-consumer episode, attributed to THIS stream from each
   * forwarded batch's per-group `droppedByGroup`. Distinct from the
   * cardinality-cap / buffer-full drops above: this telemetry never reached
   * core. Incremented by the satellite telemetry handlers, never by the flush.
   */
  droppedInTransitCount: bigint("dropped_in_transit_count", { mode: "number" })
    .notNull()
    .default(0),
});

/** Viewer timeline events (series-cap overflow, scrape failing, silence, ...). */
export const metricImportantEvents = pgTable(
  "metric_important_events",
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
    index("metric_important_events_stream_ts_idx").on(
      t.streamId,
      t.ts.desc(),
    ),
  ],
);
