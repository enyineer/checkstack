import { z } from "zod";
import { SEVERITY_BANDS } from "./severity";

/**
 * Upper bound (characters) on a raw log line / pattern template carried in a
 * request. Matches the ingest `maxLineBytes` ceiling so the pattern builder can
 * never author (or dry-run) a template larger than a line it could ever match.
 */
export const MAX_LOG_LINE_CHARS = 32_768;

/** Max entries a stream's `severityRules.valueMap` may declare. */
export const MAX_SEVERITY_VALUE_MAP_ENTRIES = 100;

/** Max per-pattern `severityRules.patternOverrides` a stream may declare. */
export const MAX_SEVERITY_PATTERN_OVERRIDES = 100;

// =============================================================================
// SEVERITY
// =============================================================================

/** Zod enum over the six severity bands (see `./severity`). The `SeverityBand`
 * type itself is owned by and exported from `./severity`. */
export const SeverityBandSchema = z.enum(SEVERITY_BANDS);

// =============================================================================
// SEVERITY RULES (per-stream severity remapping; folded into stream config)
// =============================================================================

/**
 * One pattern-based severity override: every line classified into `patternId`
 * is re-banded to `band`, regardless of its source severity. Applied AFTER
 * classification, in the flush fold (see the v2 plan "Severity application
 * order").
 */
export const SeverityPatternOverrideSchema = z.object({
  patternId: z.string(),
  band: SeverityBandSchema,
});
export type SeverityPatternOverride = z.infer<
  typeof SeverityPatternOverrideSchema
>;

/**
 * Per-stream severity remapping. `valueMap` overrides the DEFAULT source-value
 * mapping during normalize (keyed on the RAW source severity value,
 * case-insensitive); `patternOverrides` re-band a whole pattern after
 * classification. Both are optional; an absent `severityRules` means "use the
 * built-in mapping only".
 *
 * The `valueMap` KEY is whatever the source natively calls its severity, per
 * protocol: OTLP keys on `severityText`, the native NDJSON/JSON parser on the
 * `level`/`severity` field, and syslog on the RFC 5424 severity KEYWORD derived
 * from the PRI (`emerg`/`alert`/`crit`/`err`/`warning`/`notice`/`info`/`debug`).
 * So `{ "err": "fatal" }` re-bands syslog error lines, and `{ "WARNING": "error"
 * }` re-bands a native source's `WARNING` level (lookup is case-insensitive).
 */
export const SeverityRulesSchema = z.object({
  /** Raw source severity value -> band (case-insensitive lookup at normalize;
   * for syslog the key is the PRI-derived severity keyword, e.g. `"err"`). */
  valueMap: z
    .record(z.string(), SeverityBandSchema)
    .superRefine((map, ctx) => {
      if (Object.keys(map).length > MAX_SEVERITY_VALUE_MAP_ENTRIES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `severityRules.valueMap may define at most ${MAX_SEVERITY_VALUE_MAP_ENTRIES} entries.`,
        });
      }
    })
    .optional(),
  /** Per-pattern band overrides, applied after classification. */
  patternOverrides: z
    .array(SeverityPatternOverrideSchema)
    .max(MAX_SEVERITY_PATTERN_OVERRIDES)
    .optional(),
});
export type SeverityRules = z.infer<typeof SeverityRulesSchema>;

// =============================================================================
// STREAM CONFIG (tiered storage: retention, sampling, ingest caps)
// =============================================================================

/**
 * Per-stream storage & rate policy. Every field has a default so an empty
 * object parses to the full policy; updates send a partial and merge.
 *
 * Aggregates (severity/pattern buckets) always carry full volume; these knobs
 * only govern how many RAW lines are kept and for how long.
 */
export const LogStreamConfigSchema = z.object({
  /** Days to keep raw `log_events` rows. */
  rawRetentionDays: z.number().int().min(1).max(90).default(3),
  /** Hours to keep minute-grain buckets before rolling them up to hourly. */
  minuteRetentionHours: z.number().int().min(1).max(24 * 30).default(48),
  /** Days to keep hourly buckets, patterns and important events. */
  hourlyRetentionDays: z.number().int().min(1).max(730).default(90),
  /** Fraction (0..1) of INFO/DEBUG lines to keep as raw rows (WARN+ always kept). */
  infoSampleRate: z.number().min(0).max(1).default(0.05),
  /** Hard cap on raw rows kept per stream per minute (overflow dropped). */
  maxRawPerMinute: z.number().int().min(0).max(100_000).default(600),
  /** Truncate a single line's body to this many bytes. */
  maxLineBytes: z.number().int().min(256).max(1_048_576).default(32_768),
  /** Soft ingest rate limit per stream per minute (429 + Retry-After above it). */
  softRateLimitPerMinute: z
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .default(60_000),
  /**
   * Optional per-stream severity remapping (value map + pattern overrides).
   * Omitted by default; stored in the same `config` jsonb (no column change).
   */
  severityRules: SeverityRulesSchema.optional(),
});
export type LogStreamConfig = z.infer<typeof LogStreamConfigSchema>;

/** Partial config for updates: any subset of {@link LogStreamConfigSchema}. */
export const LogStreamConfigInputSchema = LogStreamConfigSchema.partial();
export type LogStreamConfigInput = z.infer<typeof LogStreamConfigInputSchema>;

/** Compile-time defaults, for callers that need the policy without parsing. */
export const DEFAULT_LOG_STREAM_CONFIG: LogStreamConfig =
  LogStreamConfigSchema.parse({});

// =============================================================================
// STREAM
// =============================================================================

export const LogStreamSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config: LogStreamConfigSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type LogStream = z.infer<typeof LogStreamSchema>;

export const CreateLogStreamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  config: LogStreamConfigInputSchema.optional(),
});
export type CreateLogStream = z.infer<typeof CreateLogStreamSchema>;

export const UpdateLogStreamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  config: LogStreamConfigInputSchema.optional(),
});
export type UpdateLogStream = z.infer<typeof UpdateLogStreamSchema>;

// =============================================================================
// SOURCE TOKENS
// =============================================================================

/** A source token as returned by list/read - NEVER carries the secret. */
export const LogStreamTokenSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  name: z.string(),
  /** First 8 chars of the full secret, for display/disambiguation. */
  tokenPrefix: z.string(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});
export type LogStreamToken = z.infer<typeof LogStreamTokenSchema>;

export const MintTokenSchema = z.object({
  streamId: z.string(),
  name: z.string().min(1).max(255),
});
export type MintToken = z.infer<typeof MintTokenSchema>;

/** Mint response: the full secret (shown ONCE) plus the persisted token row. */
export const MintTokenResultSchema = z.object({
  /** The full `ckls_...` secret. Displayed once; never retrievable again. */
  secret: z.string(),
  token: LogStreamTokenSchema,
});
export type MintTokenResult = z.infer<typeof MintTokenResultSchema>;

export const RevokeTokenSchema = z.object({
  streamId: z.string(),
  tokenId: z.string(),
});
export type RevokeToken = z.infer<typeof RevokeTokenSchema>;

// =============================================================================
// NORMALIZED INGESTED LINE (shared shape between ingest parsers and storage)
// =============================================================================

/**
 * A single log line after protocol normalization, before storage-tier
 * selection. `streamId` is added by the ingest handler from the resolved token;
 * `patternId` is filled by the Drain engine during flush.
 */
export const IngestedLineSchema = z.object({
  /** Event time. */
  ts: z.date(),
  /** When the platform received the line (defaults to now at ingest). */
  observedAt: z.date(),
  /** OTel severity number (0-24); 0/unknown allowed, banded to `info`. */
  severityNumber: z.number().int().min(0).max(24),
  /** Original severity text from the source, if any. */
  severityText: z.string().optional(),
  /** Derived band (see `./severity`). */
  band: SeverityBandSchema,
  /** Message body (already truncated to the stream's `maxLineBytes`). */
  body: z.string(),
  /** Flattened attributes (already size-capped). */
  attributes: z.record(z.string(), z.unknown()).optional(),
  /** Resource attributes (service.name etc.). */
  resource: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
});
export type IngestedLine = z.infer<typeof IngestedLineSchema>;

// =============================================================================
// EVENT (raw line) DTO + SEARCH
// =============================================================================

/**
 * A stored raw line. `id` is a stringified bigint identity (JSON-safe; the DB
 * column is a bigint). Search keyset-paginates on `(ts, id)` DESC.
 */
export const LogEventSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  ts: z.date(),
  observedAt: z.date(),
  severityNumber: z.number().int(),
  severityText: z.string().nullable(),
  band: SeverityBandSchema,
  body: z.string(),
  attributes: z.record(z.string(), z.unknown()).nullable(),
  resource: z.record(z.string(), z.unknown()).nullable(),
  patternId: z.string().nullable(),
  traceId: z.string().nullable(),
  spanId: z.string().nullable(),
});
export type LogEvent = z.infer<typeof LogEventSchema>;

/** Keyset cursor for {@link SearchEventsSchema}: last seen `(ts, id)`. */
export const EventCursorSchema = z.object({
  ts: z.coerce.date(),
  id: z.string(),
});
export type EventCursor = z.infer<typeof EventCursorSchema>;

export const SearchEventsSchema = z.object({
  streamId: z.string(),
  /** ILIKE substring match on `body`. */
  text: z.string().optional(),
  /** Restrict to these severity bands (omitted/empty = all). */
  severityBands: z.array(SeverityBandSchema).optional(),
  patternId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: EventCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
export type SearchEvents = z.infer<typeof SearchEventsSchema>;

export const SearchEventsResultSchema = z.object({
  events: z.array(LogEventSchema),
  /** Cursor to pass for the next (older) page, or null at the end. */
  nextCursor: EventCursorSchema.nullable(),
});
export type SearchEventsResult = z.infer<typeof SearchEventsResultSchema>;

// =============================================================================
// PATTERNS (Drain templates)
// =============================================================================

/**
 * How a pattern came to exist. `mined` patterns are learned by the Drain engine
 * from incoming lines; `user` patterns are authored up front via `createPattern`
 * and are PROTECTED: never LRU-evicted from the tree, never template-refined,
 * and never removed by stale-pattern retention.
 */
export const PATTERN_ORIGINS = ["mined", "user"] as const;
export const PatternOriginSchema = z.enum(PATTERN_ORIGINS);
export type PatternOrigin = z.infer<typeof PatternOriginSchema>;

export const LogPatternSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  template: z.string(),
  tokenCount: z.number().int(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  sampleBody: z.string(),
  /** Approximate cumulative occurrence count (incremented in bucket flushes). */
  totalCount: z.number(),
  /** Worst OTel severity number seen for this pattern. */
  severityMax: z.number().int(),
  /** Band derived from `severityMax`, for display. */
  band: SeverityBandSchema,
  /** Whether the pattern was mined by Drain or authored by a user. */
  origin: PatternOriginSchema,
  /**
   * A hidden pattern keeps counting in every aggregate (severity/pattern
   * buckets, health checks), but its matched lines are no longer stored as raw
   * `log_events` rows and it is excluded from pattern listings by default.
   */
  hidden: z.boolean(),
});
export type LogPattern = z.infer<typeof LogPatternSchema>;

export const ListPatternsSchema = z.object({
  streamId: z.string(),
  limit: z.number().int().min(1).max(500).default(100),
  /** Include hidden patterns (the Patterns tab's management view). */
  includeHidden: z.boolean().default(false),
  /** Restrict to patterns whose derived band is one of these (omitted = all). */
  bands: z.array(SeverityBandSchema).optional(),
  /**
   * `lastSeenAt` (default): user patterns first, then recency - the picker /
   * management ordering. `totalCount`: by volume - the "Top patterns" ordering.
   */
  orderBy: z.enum(["lastSeenAt", "totalCount"]).default("lastSeenAt"),
});
export type ListPatterns = z.infer<typeof ListPatternsSchema>;

export const SetPatternHiddenSchema = z.object({
  streamId: z.string(),
  patternId: z.string(),
  hidden: z.boolean(),
});
export type SetPatternHidden = z.infer<typeof SetPatternHiddenSchema>;

// =============================================================================
// CUSTOM PATTERNS (user-authored: create / delete / test)
// =============================================================================

/**
 * Create a user pattern. `template` is authored in the MASKED-token space (the
 * builder's chips ARE the masked tokens); the backend derives
 * `patternId = sha256(streamId + template)` and stores it with `origin: 'user'`.
 * A conflict with an existing id is reported as a friendly 409.
 */
export const CreatePatternSchema = z.object({
  streamId: z.string(),
  template: z.string().min(1).max(MAX_LOG_LINE_CHARS),
});
export type CreatePattern = z.infer<typeof CreatePatternSchema>;

export const DeletePatternSchema = z.object({
  streamId: z.string(),
  patternId: z.string(),
});
export type DeletePattern = z.infer<typeof DeletePatternSchema>;

/**
 * Dry-run a candidate template against the newest raw lines of a stream, using
 * the SAME matcher the ingest path uses. `sampleLimit` bounds how many recent
 * lines are scanned.
 */
export const TestPatternSchema = z.object({
  streamId: z.string(),
  template: z.string().min(1).max(MAX_LOG_LINE_CHARS),
  /** How many of the newest raw lines to scan (server caps at 200). */
  sampleLimit: z.number().int().min(1).max(200).default(100),
});
export type TestPattern = z.infer<typeof TestPatternSchema>;

/** One matched raw line returned by `testPattern` (id + body only). */
export const PatternMatchSampleSchema = z.object({
  id: z.string(),
  body: z.string(),
});
export type PatternMatchSample = z.infer<typeof PatternMatchSampleSchema>;

export const TestPatternResultSchema = z.object({
  /** Total matched lines among the scanned sample. */
  matchCount: z.number().int(),
  /** Up to 3 matched lines, for the builder's live preview. */
  samples: z.array(PatternMatchSampleSchema).max(3),
});
export type TestPatternResult = z.infer<typeof TestPatternResultSchema>;

/**
 * Mask a raw log line into its Drain template (the masked-token space the
 * pattern builder authors in), so the frontend can seed pattern chips from a
 * pasted line WITHOUT re-implementing the backend masker (which would drift).
 * `body` is capped to keep the request bounded.
 */
export const MaskLineSchema = z.object({
  streamId: z.string(),
  body: z.string().min(1).max(MAX_LOG_LINE_CHARS),
});
export type MaskLine = z.infer<typeof MaskLineSchema>;

export const MaskLineResultSchema = z.object({
  /** The space-joined masked tokens (e.g. `user logged in <*>`). */
  template: z.string(),
});
export type MaskLineResult = z.infer<typeof MaskLineResultSchema>;

// =============================================================================
// PATTERN VARIABLES (numeric aggregates of `<*>` wildcard values)
// =============================================================================

export const ListPatternVariablesSchema = z.object({
  streamId: z.string(),
  patternId: z.string(),
});
export type ListPatternVariables = z.infer<typeof ListPatternVariablesSchema>;

/**
 * Recent-sample summary for one `<*>` position (`varIndex`, 0-based over the
 * template's STANDALONE wildcard tokens - a wildcard embedded inside a word,
 * like `db-<*>`, is not a variable; its value is never captured). Drives the
 * pattern-metric collector's variable picker, which labels e.g.
 * `Variable 0 (… after <*> retries) - samples: 12, 40, 3`.
 */
export const PatternVariableSampleSchema = z.object({
  varIndex: z.number().int().min(0),
  /**
   * Short template snippet around this position (one token of context each
   * side, `…`-elided), so an operator can tell WHICH `<*>` this is even when
   * the template also contains embedded, non-assertable wildcards.
   */
  context: z.string(),
  /** A few recent raw values seen at this wildcard position. */
  sampleValues: z.array(z.string()),
  /** Fraction (0..1) of recent samples that parsed as a finite number. */
  numericShare: z.number().min(0).max(1),
});
export type PatternVariableSample = z.infer<typeof PatternVariableSampleSchema>;

export const ListPatternVariablesResultSchema = z.object({
  variables: z.array(PatternVariableSampleSchema),
  /**
   * The window (in seconds, ending now) the sample summary covered. The picker
   * uses it to say "no samples in the last 24h" with the REAL window instead
   * of a hardcoded claim.
   */
  summaryWindowSeconds: z.number().int().positive(),
});
export type ListPatternVariablesResult = z.infer<
  typeof ListPatternVariablesResultSchema
>;

/**
 * Windowed numeric aggregate of one pattern variable, summed across the buckets
 * in a window - the shape the storage read helper returns and the pattern-metric
 * collector consumes. `min`/`max` are null when the window has no samples;
 * the collector maps a null-window to zeroed fields and lets users assert on
 * `sampleCount > 0` alongside.
 */
export const PatternVariableWindowSchema = z.object({
  sampleCount: z.number(),
  sum: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
});
export type PatternVariableWindow = z.infer<typeof PatternVariableWindowSchema>;

// =============================================================================
// BUCKETS (windowed aggregates for charts)
// =============================================================================

export const BucketGrainSchema = z.enum(["minute", "hour"]);
export type BucketGrain = z.infer<typeof BucketGrainSchema>;

export const GetBucketsSchema = z.object({
  streamId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  /** Omitted = auto-pick minute vs hour tier from the window width. */
  grain: BucketGrainSchema.optional(),
});
export type GetBuckets = z.infer<typeof GetBucketsSchema>;

export const SeverityBucketPointSchema = z.object({
  bucketStart: z.date(),
  band: SeverityBandSchema,
  count: z.number(),
});
export type SeverityBucketPoint = z.infer<typeof SeverityBucketPointSchema>;

export const SeverityBucketsResultSchema = z.object({
  grain: BucketGrainSchema,
  points: z.array(SeverityBucketPointSchema),
});
export type SeverityBucketsResult = z.infer<typeof SeverityBucketsResultSchema>;

export const PatternBucketPointSchema = z.object({
  bucketStart: z.date(),
  patternId: z.string(),
  count: z.number(),
});
export type PatternBucketPoint = z.infer<typeof PatternBucketPointSchema>;

export const PatternBucketsResultSchema = z.object({
  grain: BucketGrainSchema,
  points: z.array(PatternBucketPointSchema),
});
export type PatternBucketsResult = z.infer<typeof PatternBucketsResultSchema>;

// =============================================================================
// IMPORTANT EVENTS (viewer timeline)
// =============================================================================

export const IMPORTANT_EVENT_TYPES = [
  "new_pattern",
  "spike",
  "silence",
  "silence_recovered",
  "threshold",
] as const;

export const ImportantEventTypeSchema = z.enum(IMPORTANT_EVENT_TYPES);
export type ImportantEventType = z.infer<typeof ImportantEventTypeSchema>;

export const ImportantEventSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  ts: z.date(),
  type: ImportantEventTypeSchema,
  severityNumber: z.number().int().nullable(),
  patternId: z.string().nullable(),
  title: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
});
export type ImportantEvent = z.infer<typeof ImportantEventSchema>;

/** Input shape the backend recorder accepts (id/createdAt assigned at write). */
export const RecordImportantEventSchema = z.object({
  streamId: z.string(),
  ts: z.date(),
  type: ImportantEventTypeSchema,
  severityNumber: z.number().int().optional(),
  patternId: z.string().optional(),
  title: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type RecordImportantEventInput = z.infer<
  typeof RecordImportantEventSchema
>;

/**
 * Keyset page cursor for the important-events timeline. Ordering is
 * `(ts DESC, id DESC)`, so the cursor carries BOTH the timestamp and the id of
 * the last row on the page: paging on `ts` alone would skip or repeat rows that
 * share a millisecond (throttle/pattern events fire in bursts at the same `ts`).
 */
export const ImportantEventCursorSchema = z.object({
  ts: z.coerce.date(),
  id: z.string(),
});
export type ImportantEventCursor = z.infer<typeof ImportantEventCursorSchema>;

export const ListImportantEventsSchema = z.object({
  streamId: z.string(),
  cursor: ImportantEventCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListImportantEvents = z.infer<typeof ListImportantEventsSchema>;

export const ListImportantEventsResultSchema = z.object({
  events: z.array(ImportantEventSchema),
  nextCursor: ImportantEventCursorSchema.nullable(),
});
export type ListImportantEventsResult = z.infer<
  typeof ListImportantEventsResultSchema
>;

// =============================================================================
// ACTIVITY + OVERVIEW
// =============================================================================

export const StreamActivitySchema = z.object({
  streamId: z.string(),
  lastReceivedAt: z.date().nullable(),
  lastFlushAt: z.date().nullable(),
  approxRatePerMinute: z.number(),
  silenceEventAt: z.date().nullable(),
  /**
   * Log lines a SATELLITE dropped from its bounded in-transit buffer during a
   * disconnect / slow-consumer episode, attributed to this stream via each
   * forwarded batch's per-group `droppedByGroup`. A distinct failure mode from
   * the pipeline's rate-limit / buffer-full drops - this is telemetry that never
   * reached core at all. Cumulative.
   */
  droppedInTransitCount: z.number(),
});
export type StreamActivity = z.infer<typeof StreamActivitySchema>;

/** Per-pod, approximate ingest counters surfaced on the overview page. */
export const IngestCountersSchema = z.object({
  linesReceived: z.number(),
  linesDropped: z.number(),
  flushes: z.number(),
  lastFlushMs: z.number(),
});
export type IngestCounters = z.infer<typeof IngestCountersSchema>;

export const StreamSeverityTotalsSchema = z.object({
  trace: z.number(),
  debug: z.number(),
  info: z.number(),
  warn: z.number(),
  error: z.number(),
  fatal: z.number(),
});
export type StreamSeverityTotals = z.infer<typeof StreamSeverityTotalsSchema>;

export const StreamOverviewSchema = z.object({
  stream: LogStreamSchema,
  activity: StreamActivitySchema.nullable(),
  counters: IngestCountersSchema.nullable(),
  /** Severity totals over the last 24h (from buckets). */
  last24hSeverityTotals: StreamSeverityTotalsSchema,
  /** Top patterns by recent volume, for the overview card. */
  topPatterns: z.array(LogPatternSchema),
});
export type StreamOverview = z.infer<typeof StreamOverviewSchema>;

// =============================================================================
// PICKER (dynamic options for the healthcheck strategy config + future pickers)
// =============================================================================

export const StreamForPickerSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type StreamForPicker = z.infer<typeof StreamForPickerSchema>;

// =============================================================================
// STREAM SUMMARIES (batch row data for the streams list page)
// =============================================================================

/**
 * One row of the streams-list summary: last activity + last-24h error/warn
 * counts + pattern count for a single stream.
 *
 * IMPORTANT: the identifier field MUST be `id` (the stream id). The RLAC
 * `listKey` post-filter keys every list item on `item.id` (see
 * `.claude/rules/rlac.md`); a `streamId`-named field would leave `id` undefined
 * and the filter would drop every row for a team-scoped caller.
 */
export const LogStreamSummarySchema = z.object({
  /** The stream id (drives the `listKey` RLAC filter). */
  id: z.string(),
  lastReceivedAt: z.date().nullable(),
  /** Sum of `error`-band lines over the last 24h (cross-tier: minute + hourly). */
  last24hErrorCount: z.number(),
  /** Sum of `warn`-band lines over the last 24h (cross-tier: minute + hourly). */
  last24hWarnCount: z.number(),
  /** Number of Drain patterns learned for the stream. */
  patternCount: z.number(),
});
export type LogStreamSummary = z.infer<typeof LogStreamSummarySchema>;

export const ListStreamSummariesResultSchema = z.object({
  summaries: z.array(LogStreamSummarySchema),
});
export type ListStreamSummariesResult = z.infer<
  typeof ListStreamSummariesResultSchema
>;
