import {
  pgTable,
  text,
  integer,
  smallint,
  bigint,
  doublePrecision,
  jsonb,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import type {
  LogStreamConfig,
  SeverityBand,
  ImportantEventType,
  PatternOrigin,
} from "@checkstack/logstream-common";

/**
 * Log stream definition. Team-scoped resource (RLAC keys grants on
 * `logstream.stream`). `config` carries the tiered-storage policy
 * (retention / sampling / caps); see `LogStreamConfigSchema`.
 */
export const logStreams = pgTable("log_streams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  config: jsonb("config").$type<LogStreamConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Per-stream source tokens. Only the sha256 hash and an 8-char display prefix
 * are stored; the full secret is shown once at mint. `tokenHash` is uniquely
 * indexed - it is the ingest auth lookup key.
 */
export const logStreamTokens = pgTable(
  "log_stream_tokens",
  {
    id: text("id").primaryKey(),
    // No FK to log_streams: like every other stream-scoped table here
    // (events/buckets/patterns), cleanup on stream delete is done explicitly in
    // deleteStream. This keeps the schema uniform and avoids drizzle-kit
    // emitting a `public`-qualified FK target, which breaks the plugin's
    // schema-scoped migration (plugins do not run in the `public` schema).
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
    index("log_stream_tokens_hash_uq").on(t.tokenHash),
    index("log_stream_tokens_stream_idx").on(t.streamId),
  ],
);

/**
 * Capped raw log lines. `id` is a bigint identity (cheap, monotonic) used as
 * the keyset tiebreak in `(ts, id)` search pagination. Indexes are kept to the
 * minimum needed for search + retention delete to keep write cost low.
 */
export const logEvents = pgTable(
  "log_events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    streamId: text("stream_id").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    severityNumber: integer("severity_number").notNull(),
    severityText: text("severity_text"),
    band: text("band").$type<SeverityBand>().notNull(),
    body: text("body").notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    resource: jsonb("resource").$type<Record<string, unknown>>(),
    patternId: text("pattern_id"),
    traceId: text("trace_id"),
    spanId: text("span_id"),
  },
  (t) => [
    index("log_events_stream_ts_idx").on(t.streamId, t.ts.desc(), t.id.desc()),
    index("log_events_stream_pattern_ts_idx").on(
      t.streamId,
      t.patternId,
      t.ts.desc(),
    ),
    index("log_events_ts_idx").on(t.ts),
  ],
);

/**
 * Drain templates. `id` = sha256(streamId + normalized template) so identical
 * templates converge to one id across pods. `totalCount` is approximate
 * (incremented during bucket flushes); `severityMax` is the worst OTel severity
 * number seen for the pattern.
 */
export const logPatterns = pgTable(
  "log_patterns",
  {
    id: text("id").primaryKey(),
    streamId: text("stream_id").notNull(),
    template: text("template").notNull(),
    tokenCount: integer("token_count").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    sampleBody: text("sample_body").notNull(),
    totalCount: bigint("total_count", { mode: "number" })
      .notNull()
      .default(0),
    severityMax: integer("severity_max").notNull().default(0),
    // 'mined' (Drain-learned) or 'user' (authored up front). User patterns are
    // protected: never LRU-evicted, refined, or removed by stale retention.
    // Defaulted so the migration backfills every existing row as 'mined'.
    origin: text("origin").$type<PatternOrigin>().notNull().default("mined"),
  },
  (t) => [
    index("log_patterns_stream_last_seen_idx").on(
      t.streamId,
      t.lastSeenAt.desc(),
    ),
  ],
);

/**
 * Numeric aggregates of a pattern's `<*>` wildcard values, per minute bucket.
 * One row per (stream, pattern, wildcard position, minute). `count` is how many
 * numeric samples folded in; `sum`/`min`/`max` are the folded numeric stats
 * (only plain finite numbers are folded - non-numeric mask classes are skipped
 * upstream). Retention: `minuteRetentionHours`, rolled up to
 * {@link logPatternVariableHourly} like the pattern buckets.
 */
export const logPatternVariableBuckets = pgTable(
  "log_pattern_variable_buckets",
  {
    streamId: text("stream_id").notNull(),
    patternId: text("pattern_id").notNull(),
    varIndex: smallint("var_index").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    sum: doublePrecision("sum").notNull().default(0),
    min: doublePrecision("min").notNull(),
    max: doublePrecision("max").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.streamId, t.patternId, t.varIndex, t.bucketStart],
    }),
    index("log_pattern_variable_buckets_ts_idx").on(t.bucketStart),
  ],
);

/**
 * Pattern-variable aggregates per hour bucket (rolled up from minute).
 * Retention: `hourlyRetentionDays`.
 */
export const logPatternVariableHourly = pgTable(
  "log_pattern_variable_hourly",
  {
    streamId: text("stream_id").notNull(),
    patternId: text("pattern_id").notNull(),
    varIndex: smallint("var_index").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    sum: doublePrecision("sum").notNull().default(0),
    min: doublePrecision("min").notNull(),
    max: doublePrecision("max").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.streamId, t.patternId, t.varIndex, t.bucketStart],
    }),
    index("log_pattern_variable_hourly_ts_idx").on(t.bucketStart),
  ],
);

/** Severity counts per minute bucket. Retention: `minuteRetentionHours`. */
export const logSeverityBuckets = pgTable(
  "log_severity_buckets",
  {
    streamId: text("stream_id").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    band: text("band").$type<SeverityBand>().notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.streamId, t.bucketStart, t.band] }),
    index("log_severity_buckets_ts_idx").on(t.bucketStart),
  ],
);

/** Pattern counts per minute bucket. Retention: `minuteRetentionHours`. */
export const logPatternBuckets = pgTable(
  "log_pattern_buckets",
  {
    streamId: text("stream_id").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    patternId: text("pattern_id").notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.streamId, t.bucketStart, t.patternId] }),
    index("log_pattern_buckets_ts_idx").on(t.bucketStart),
  ],
);

/** Severity counts per hour bucket (rolled up from minute). Retention: hourly. */
export const logSeverityHourly = pgTable(
  "log_severity_hourly",
  {
    streamId: text("stream_id").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    band: text("band").$type<SeverityBand>().notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.streamId, t.bucketStart, t.band] }),
    index("log_severity_hourly_ts_idx").on(t.bucketStart),
  ],
);

/** Pattern counts per hour bucket (rolled up from minute). Retention: hourly. */
export const logPatternHourly = pgTable(
  "log_pattern_hourly",
  {
    streamId: text("stream_id").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    patternId: text("pattern_id").notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.streamId, t.bucketStart, t.patternId] }),
    index("log_pattern_hourly_ts_idx").on(t.bucketStart),
  ],
);

/** Viewer timeline events (new pattern, spike, silence, ...). */
export const logImportantEvents = pgTable(
  "log_important_events",
  {
    id: text("id").primaryKey(),
    streamId: text("stream_id").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    type: text("type").$type<ImportantEventType>().notNull(),
    severityNumber: integer("severity_number"),
    patternId: text("pattern_id"),
    title: text("title").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("log_important_events_stream_ts_idx").on(t.streamId, t.ts.desc())],
);

/**
 * One row per stream, updated once per flush (never per line). Holds the
 * denormalized activity markers the overview page + silence detection read.
 */
export const logStreamActivity = pgTable("log_stream_activity", {
  streamId: text("stream_id").primaryKey(),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  lastFlushAt: timestamp("last_flush_at", { withTimezone: true }),
  approxRatePerMinute: bigint("approx_rate_per_minute", { mode: "number" })
    .notNull()
    .default(0),
  silenceEventAt: timestamp("silence_event_at", { withTimezone: true }),
  /**
   * Log lines a SATELLITE dropped from its bounded in-transit buffer during a
   * disconnect / slow-consumer episode, attributed to THIS stream from each
   * forwarded batch's per-group `droppedByGroup`. Distinct from the pipeline's
   * rate-limit / buffer-full drops: this telemetry never reached core.
   * Incremented by the satellite telemetry handler, never by the flush.
   */
  droppedInTransitCount: bigint("dropped_in_transit_count", { mode: "number" })
    .notNull()
    .default(0),
});
