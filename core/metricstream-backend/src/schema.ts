import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  timestamp,
  boolean,
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
 * Per-stream source tokens (OTLP/native push auth). Only the sha256 hash and an
 * 8-char display prefix are stored; the full secret is shown once at mint.
 * `tokenHash` is the ingest auth lookup key.
 *
 * No FK to metric_streams: like every other stream-scoped table here, cleanup on
 * stream delete is done explicitly in deleteStream. This keeps the schema
 * uniform and avoids drizzle-kit emitting a `public`-qualified FK target, which
 * breaks the plugin's schema-scoped migration (plugins do not run in `public`).
 */
export const metricStreamTokens = pgTable(
  "metric_stream_tokens",
  {
    id: text("id").primaryKey(),
    streamId: text("stream_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("metric_stream_tokens_hash_uq").on(t.tokenHash),
    index("metric_stream_tokens_stream_idx").on(t.streamId),
  ],
);

/**
 * Prometheus scrape targets (pull source). One recurring scrape job per ENABLED
 * target is scheduled by the reconciler.
 *
 * SECRET STORAGE: an optional bearer token is stored ENCRYPTED AT REST via the
 * platform's `InternalSecretsService` (the same local AES-GCM store healthcheck's
 * config-secret channel uses). This column NEVER holds plaintext - it holds the
 * marker `__mssecret__:<targetId>` when a token is set inline, a
 * `${{ secrets.NAME }}` reference, or NULL. The scraper resolves it to plaintext
 * just-in-time via `resolveScrapeTargetBearer` (see `secrets/`).
 */
export const metricScrapeTargets = pgTable(
  "metric_scrape_targets",
  {
    id: text("id").primaryKey(),
    streamId: text("stream_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    /** Marker / reference for the encrypted bearer token, or null. NEVER plaintext. */
    bearerTokenSecret: text("bearer_token_secret"),
    /**
     * When set, this target is scraped FROM this satellite (its datapoints are
     * forwarded over the satellite channel via the metric-scrape capability) and
     * is EXCLUDED from the core scrape reconciler's scheduling. NULL = scraped by
     * core. FK-less like the rest of this schema (satellites live in another
     * plugin's schema; cleanup is by convention, and an orphaned binding simply
     * never receives config until the satellite reconnects). */
    satelliteId: text("satellite_id"),
    enabled: boolean("enabled").notNull().default(true),
    /** Consecutive scrape failures; drives the `scrape_failing` event at >=3. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastScrapeAt: timestamp("last_scrape_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("metric_scrape_targets_stream_idx").on(t.streamId),
    // The metric-scrape capability config query filters enabled targets by
    // satellite; index the binding column so the per-satellite build is cheap.
    index("metric_scrape_targets_satellite_idx").on(t.satelliteId),
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
 * Concrete series: a metric name + a specific label set. `id` = sha256 of
 * `streamId + " " + name + " " + canonicalLabelString` so identical series
 * converge to one id across pods. The label-value autocomplete source (bounded
 * DISTINCT queries over `(streamId, name)`). `counterKind` tags the series
 * flavor once (see the read-time rate math).
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
