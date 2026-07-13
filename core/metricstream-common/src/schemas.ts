import { z } from "zod";

// =============================================================================
// LIMITS
// =============================================================================

/** Max entries a single metric-window collector `labelFilters` array may hold. */
export const MAX_LABEL_FILTERS = 20;

/** Upper bound (characters) on a metric name carried in a request. */
export const MAX_METRIC_NAME_CHARS = 1024;

/** Upper bound (characters) on a single label key or value. */
export const MAX_LABEL_CHARS = 1024;

// =============================================================================
// METRIC TYPE + COUNTER KIND
// =============================================================================

/**
 * A datapoint's metric type. Histograms/summaries are DECOMPOSED at the source
 * parser into `<name>_sum` + `<name>_count` counters, so exactly two shapes
 * flow through storage.
 */
export const METRIC_TYPES = ["gauge", "counter"] as const;
export const MetricTypeSchema = z.enum(METRIC_TYPES);
export type MetricType = z.infer<typeof MetricTypeSchema>;

/**
 * How a counter's samples are reported. `cumulative` (Prometheus + OTLP
 * cumulative) reports an ever-growing total; rate/increase are derived at read
 * time by differencing successive `last` values with reset detection. `delta`
 * (OTLP delta temporality) reports per-interval increments that are summed into
 * the minute bucket's `deltaSum`. A series' flavor is tagged ONCE by the parser
 * (the `metric_series.counterKind` column) and never mixed. Meaningless for
 * gauges.
 */
export const COUNTER_KINDS = ["cumulative", "delta"] as const;
export const CounterKindSchema = z.enum(COUNTER_KINDS);
export type CounterKind = z.infer<typeof CounterKindSchema>;

// =============================================================================
// STREAM CONFIG (caps + retention)
// =============================================================================

/**
 * Per-stream cardinality, rate and retention policy. Every field has a default
 * so an empty object parses to the full policy; updates send a partial and
 * merge.
 */
export const MetricStreamConfigSchema = z.object({
  /** Max distinct series kept per stream. New series past the cap are DROPPED
   * (counted + surfaced); existing series keep updating.
   *
   * BEST-EFFORT PER-POD-FLUSH: the cap is enforced by each flush re-reading the
   * live series count inside its transaction, so under concurrent flushes on
   * multiple pods the effective ceiling can briefly overshoot by up to
   * (pods x new-series-per-flush) before the counts reconcile. There is NO
   * cross-pod advisory lock on admission - that is a deliberate trade to keep
   * the hot ingest path lock-free. The overshoot is bounded and self-correcting
   * (subsequent flushes see the higher count and admit fewer), and retention
   * later reclaims series that stop reporting. */
  seriesCap: z.number().int().min(100).max(1_000_000).default(5000),
  /** Hours to keep minute-grain buckets before rolling them up to hourly. */
  minuteRetentionHours: z.number().int().min(1).max(24 * 30).default(48),
  /** Days to keep hourly buckets and important events. */
  hourlyRetentionDays: z.number().int().min(1).max(730).default(90),
  /** Soft ingest rate limit per stream per minute (429 + Retry-After above it). */
  softDatapointsPerMinute: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .default(60_000),
  /** Hard cap on datapoints accepted in a single ingest request (400/partial). */
  maxDatapointsPerRequest: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(10_000),
});
export type MetricStreamConfig = z.infer<typeof MetricStreamConfigSchema>;

/** Partial config for updates: any subset of {@link MetricStreamConfigSchema}. */
export const MetricStreamConfigInputSchema = MetricStreamConfigSchema.partial();
export type MetricStreamConfigInput = z.infer<
  typeof MetricStreamConfigInputSchema
>;

/** Compile-time defaults, for callers that need the policy without parsing. */
export const DEFAULT_METRIC_STREAM_CONFIG: MetricStreamConfig =
  MetricStreamConfigSchema.parse({});

// =============================================================================
// STREAM
// =============================================================================

export const MetricStreamSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config: MetricStreamConfigSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MetricStream = z.infer<typeof MetricStreamSchema>;

export const CreateMetricStreamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  config: MetricStreamConfigInputSchema.optional(),
});
export type CreateMetricStream = z.infer<typeof CreateMetricStreamSchema>;

export const UpdateMetricStreamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  config: MetricStreamConfigInputSchema.optional(),
});
export type UpdateMetricStream = z.infer<typeof UpdateMetricStreamSchema>;

// =============================================================================
// SOURCE TOKENS
// =============================================================================

/** A source token as returned by list/read - NEVER carries the secret. */
export const MetricStreamTokenSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  name: z.string(),
  /** First 8 chars of the full secret, for display/disambiguation. */
  tokenPrefix: z.string(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});
export type MetricStreamToken = z.infer<typeof MetricStreamTokenSchema>;

export const MintTokenSchema = z.object({
  streamId: z.string(),
  name: z.string().min(1).max(255),
});
export type MintToken = z.infer<typeof MintTokenSchema>;

/** Mint response: the full secret (shown ONCE) plus the persisted token row. */
export const MintTokenResultSchema = z.object({
  /** The full `ckms_...` secret. Displayed once; never retrievable again. */
  secret: z.string(),
  token: MetricStreamTokenSchema,
});
export type MintTokenResult = z.infer<typeof MintTokenResultSchema>;

export const RevokeTokenSchema = z.object({
  streamId: z.string(),
  tokenId: z.string(),
});
export type RevokeToken = z.infer<typeof RevokeTokenSchema>;

// =============================================================================
// SCRAPE TARGETS (Prometheus pull source; CRUD)
// =============================================================================

/** Lower/upper bounds on a scrape target's poll interval. */
export const MIN_SCRAPE_INTERVAL_SECONDS = 5;
export const MAX_SCRAPE_INTERVAL_SECONDS = 86_400;
/** Default per-scrape HTTP timeout. */
export const DEFAULT_SCRAPE_TIMEOUT_MS = 10_000;

/** The only URL schemes a scrape target may use (defense-in-depth vs SSRF). */
export const SCRAPE_TARGET_URL_SCHEMES = ["http:", "https:"] as const;

/** True when `url` parses and carries an allowed (http/https) scheme. */
function isHttpScrapeUrl(url: string): boolean {
  try {
    const scheme = new URL(url).protocol;
    return (SCRAPE_TARGET_URL_SCHEMES as readonly string[]).includes(scheme);
  } catch {
    return false;
  }
}

/**
 * A scrape target URL: a valid absolute URL of at most 2048 chars, restricted to
 * the http/https schemes. The scheme allowlist keeps a target from being pointed
 * at `file:`, `gopher:` and other fetch-adjacent schemes; the runtime scrape path
 * additionally resolves the host through the platform SSRF egress guard before
 * every fetch (cloud-metadata / link-local ranges are denied by default).
 */
export const ScrapeTargetUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine(isHttpScrapeUrl, {
    message: "Scrape target URL must use the http or https scheme.",
  });

/**
 * A scrape target as returned by list/read. The bearer token is NEVER returned
 * (it is stored encrypted at rest via the config-secret channel); the read DTO
 * exposes only `hasBearerToken` so the editor can render a "secret is set"
 * affordance without ever transporting the plaintext.
 */
export const MetricScrapeTargetSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  name: z.string(),
  url: z.string(),
  intervalSeconds: z.number().int(),
  timeoutMs: z.number().int(),
  enabled: z.boolean(),
  /**
   * When set, this target is scraped FROM the satellite with this id (its
   * datapoints are forwarded over the satellite channel), not by the core
   * reconciler. `null` = scraped by core. The core scrape scheduler excludes
   * satellite-bound targets; the metric-scrape capability handler assigns them.
   */
  satelliteId: z.string().nullable(),
  /** True when a bearer-token secret is stored for this target. */
  hasBearerToken: z.boolean(),
  lastScrapeAt: z.date().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MetricScrapeTarget = z.infer<typeof MetricScrapeTargetSchema>;

/**
 * Sentinel for the update path's `bearerToken`: an OMITTED field keeps the
 * existing secret, an explicit `null` CLEARS it, and a non-empty string SETS a
 * new one. (Mirrors the healthcheck config-secret "blank keeps, sentinel
 * clears" convention, but modelled explicitly here since scrape targets are a
 * bespoke resource, not a DynamicForm-driven config.)
 */
export const CreateScrapeTargetSchema = z.object({
  streamId: z.string(),
  name: z.string().min(1).max(255),
  url: ScrapeTargetUrlSchema,
  intervalSeconds: z
    .number()
    .int()
    .min(MIN_SCRAPE_INTERVAL_SECONDS)
    .max(MAX_SCRAPE_INTERVAL_SECONDS)
    .default(60),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .default(DEFAULT_SCRAPE_TIMEOUT_MS),
  /** Optional plaintext bearer token - extracted to an encrypted secret on write. */
  bearerToken: z.string().min(1).max(4096).optional(),
  /**
   * Bind the target to a satellite so it is scraped FROM there and forwarded
   * over the satellite channel. Omitted / null = scraped by core.
   */
  satelliteId: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});
export type CreateScrapeTarget = z.infer<typeof CreateScrapeTargetSchema>;

export const UpdateScrapeTargetSchema = z.object({
  streamId: z.string(),
  targetId: z.string(),
  name: z.string().min(1).max(255).optional(),
  url: ScrapeTargetUrlSchema.optional(),
  intervalSeconds: z
    .number()
    .int()
    .min(MIN_SCRAPE_INTERVAL_SECONDS)
    .max(MAX_SCRAPE_INTERVAL_SECONDS)
    .optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  /** Omitted = keep existing; `null` = clear; string = set a new secret. */
  bearerToken: z.string().min(1).max(4096).nullable().optional(),
  /**
   * Rebind the target: omitted = keep, `null` = unbind (scrape from core),
   * string = bind to that satellite. The CRUD path notifies BOTH the old and
   * the new satellite so each converges its scrape set.
   */
  satelliteId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateScrapeTarget = z.infer<typeof UpdateScrapeTargetSchema>;

export const DeleteScrapeTargetSchema = z.object({
  streamId: z.string(),
  targetId: z.string(),
});
export type DeleteScrapeTarget = z.infer<typeof DeleteScrapeTargetSchema>;

export const ListScrapeTargetsSchema = z.object({
  streamId: z.string(),
});
export type ListScrapeTargets = z.infer<typeof ListScrapeTargetsSchema>;

// =============================================================================
// NORMALIZED DATAPOINT (shared shape between source parsers and the sink)
// =============================================================================

/**
 * A single datapoint after protocol normalization, before storage. `streamId`
 * is added by the ingest handler from the resolved token; the flush fold derives
 * the series id from `sha256(streamId + " " + name + " " + canonicalLabelString)`.
 *
 * `value` is the gauge sample OR the counter's CUMULATIVE total (for
 * `cumulative` counters) / the interval INCREMENT (for `delta` counters).
 * `ts` is clamped to `[now - maxLag, now + smallSkew]` at ingest.
 */
export const NormalizedDatapointSchema = z.object({
  /** Metric name, normalized (prom name or OTLP name). */
  name: z.string().min(1).max(MAX_METRIC_NAME_CHARS),
  type: MetricTypeSchema,
  /** Only meaningful for counters; how the samples are reported. */
  counterKind: CounterKindSchema.optional(),
  unit: z.string().optional(),
  /** Sorted at hash time; OTLP resource attrs (service.name etc.) folded in. */
  labels: z.record(z.string(), z.string()),
  value: z.number(),
  ts: z.date(),
});
export type NormalizedDatapoint = z.infer<typeof NormalizedDatapointSchema>;

// =============================================================================
// METRIC NAMES + SERIES (autocomplete sources)
// =============================================================================

/**
 * One metric name registered for a stream. Drives the metric autocomplete
 * WITHOUT scanning the series table. `seriesCount` is maintained as series are
 * admitted/removed.
 */
export const MetricNameInfoSchema = z.object({
  name: z.string(),
  type: MetricTypeSchema,
  counterKind: CounterKindSchema.nullable(),
  unit: z.string().nullable(),
  help: z.string().nullable(),
  seriesCount: z.number(),
  lastSeenAt: z.date(),
});
export type MetricNameInfo = z.infer<typeof MetricNameInfoSchema>;

/** One concrete series (a metric name + a specific label set). */
export const MetricSeriesInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  labels: z.record(z.string(), z.string()),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
});
export type MetricSeriesInfo = z.infer<typeof MetricSeriesInfoSchema>;

/** One exact-match label filter `{ key, value }`. */
export const LabelFilterSchema = z.object({
  key: z.string().min(1).max(MAX_LABEL_CHARS),
  value: z.string().max(MAX_LABEL_CHARS),
});
export type LabelFilter = z.infer<typeof LabelFilterSchema>;

// =============================================================================
// AUTOCOMPLETE QUERIES + RESULTS
// =============================================================================

export const ListMetricNamesSchema = z.object({
  streamId: z.string(),
  /** Case-insensitive substring filter on the metric name. */
  query: z.string().max(MAX_METRIC_NAME_CHARS).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export type ListMetricNames = z.infer<typeof ListMetricNamesSchema>;

export const ListMetricNamesResultSchema = z.object({
  names: z.array(MetricNameInfoSchema),
});
export type ListMetricNamesResult = z.infer<typeof ListMetricNamesResultSchema>;

export const ListLabelKeysSchema = z.object({
  streamId: z.string(),
  metricName: z.string().min(1).max(MAX_METRIC_NAME_CHARS),
  limit: z.number().int().min(1).max(500).default(200),
});
export type ListLabelKeys = z.infer<typeof ListLabelKeysSchema>;

export const ListLabelKeysResultSchema = z.object({
  keys: z.array(z.string()),
});
export type ListLabelKeysResult = z.infer<typeof ListLabelKeysResultSchema>;

export const ListLabelValuesSchema = z.object({
  streamId: z.string(),
  metricName: z.string().min(1).max(MAX_METRIC_NAME_CHARS),
  key: z.string().min(1).max(MAX_LABEL_CHARS),
  /** Case-insensitive substring filter on the label value. */
  query: z.string().max(MAX_LABEL_CHARS).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export type ListLabelValues = z.infer<typeof ListLabelValuesSchema>;

export const ListLabelValuesResultSchema = z.object({
  values: z.array(z.string()),
});
export type ListLabelValuesResult = z.infer<typeof ListLabelValuesResultSchema>;

/** Compact metric-series summary for the metrics browser (bounded list). */
export const ListMetricSeriesSchema = z.object({
  streamId: z.string(),
  metricName: z.string().min(1).max(MAX_METRIC_NAME_CHARS),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListMetricSeries = z.infer<typeof ListMetricSeriesSchema>;

export const ListMetricSeriesResultSchema = z.object({
  series: z.array(MetricSeriesInfoSchema),
});
export type ListMetricSeriesResult = z.infer<
  typeof ListMetricSeriesResultSchema
>;

// =============================================================================
// BUCKETS (windowed aggregates for charts + the collector read path)
// =============================================================================

export const BucketGrainSchema = z.enum(["minute", "hour"]);
export type BucketGrain = z.infer<typeof BucketGrainSchema>;

/**
 * One aggregated bucket over all series matching a `(metricName, labelFilters)`
 * selection, at one tier. `last`/`lastTs` follow latest-lastTs-wins semantics;
 * `deltaSum` is the summed per-interval increments (delta counters). `min`/`max`
 * are null when the bucket has no samples.
 */
export const MetricBucketPointSchema = z.object({
  bucketStart: z.date(),
  count: z.number(),
  sum: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  last: z.number().nullable(),
  lastTs: z.date().nullable(),
  deltaSum: z.number(),
});
export type MetricBucketPoint = z.infer<typeof MetricBucketPointSchema>;

export const GetMetricBucketsSchema = z.object({
  streamId: z.string(),
  metricName: z.string().min(1).max(MAX_METRIC_NAME_CHARS),
  labelFilters: z.array(LabelFilterSchema).max(MAX_LABEL_FILTERS).optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  /** Omitted = auto-pick minute vs hour tier from the window width. */
  grain: BucketGrainSchema.optional(),
});
export type GetMetricBuckets = z.infer<typeof GetMetricBucketsSchema>;

export const GetMetricBucketsResultSchema = z.object({
  grain: BucketGrainSchema,
  points: z.array(MetricBucketPointSchema),
});
export type GetMetricBucketsResult = z.infer<
  typeof GetMetricBucketsResultSchema
>;

// =============================================================================
// IMPORTANT EVENTS (viewer timeline)
// =============================================================================

export const IMPORTANT_EVENT_TYPES = [
  "series_cap",
  "scrape_failing",
  "silence",
  "silence_recovered",
] as const;

export const ImportantEventTypeSchema = z.enum(IMPORTANT_EVENT_TYPES);
export type ImportantEventType = z.infer<typeof ImportantEventTypeSchema>;

export const ImportantEventSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  ts: z.date(),
  type: ImportantEventTypeSchema,
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
  title: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type RecordImportantEventInput = z.infer<
  typeof RecordImportantEventSchema
>;

export const ListImportantEventsSchema = z.object({
  streamId: z.string(),
  before: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ListImportantEvents = z.infer<typeof ListImportantEventsSchema>;

export const ListImportantEventsResultSchema = z.object({
  events: z.array(ImportantEventSchema),
  nextBefore: z.coerce.date().nullable(),
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
  approxDatapointsPerMinute: z.number(),
  droppedSeriesCount: z.number(),
  droppedDatapointsCount: z.number(),
  /**
   * Datapoints a SATELLITE dropped from its bounded in-transit buffer during a
   * disconnect / slow-consumer episode, attributed to this stream via each
   * forwarded batch's per-group `droppedByGroup`. A distinct failure mode from
   * the cardinality-cap (`droppedSeriesCount`) and buffer-full
   * (`droppedDatapointsCount`) drops - this is telemetry that never reached core
   * at all. Cumulative.
   */
  droppedInTransitCount: z.number(),
});
export type StreamActivity = z.infer<typeof StreamActivitySchema>;

export const StreamOverviewSchema = z.object({
  stream: MetricStreamSchema,
  activity: StreamActivitySchema.nullable(),
  /** Distinct series currently registered for the stream. */
  seriesCount: z.number(),
  /** The stream's configured `seriesCap`, for cap-usage tone/warnings. */
  seriesCap: z.number(),
  /** Top metric names by series count, for the overview card. */
  topMetrics: z.array(MetricNameInfoSchema),
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
 * One row of the streams-list summary.
 *
 * IMPORTANT: the identifier field MUST be `id` (the stream id). The RLAC
 * `listKey` post-filter keys every list item on `item.id` (see
 * `.claude/rules/rlac.md`); a `streamId`-named field would leave `id` undefined
 * and the filter would drop every row for a team-scoped caller.
 */
export const MetricStreamSummarySchema = z.object({
  /** The stream id (drives the `listKey` RLAC filter). */
  id: z.string(),
  lastReceivedAt: z.date().nullable(),
  approxDatapointsPerMinute: z.number(),
  /** Distinct series currently registered. */
  seriesCount: z.number(),
  /** The stream's configured cardinality cap. */
  seriesCap: z.number(),
  /** Total series dropped due to the cardinality cap (cumulative). */
  droppedSeriesCount: z.number(),
});
export type MetricStreamSummary = z.infer<typeof MetricStreamSummarySchema>;

export const ListStreamSummariesResultSchema = z.object({
  summaries: z.array(MetricStreamSummarySchema),
});
export type ListStreamSummariesResult = z.infer<
  typeof ListStreamSummariesResultSchema
>;

// =============================================================================
// HEALTH-CHECK CONFIG SCHEMAS (FROZEN shapes for C2/C3)
// =============================================================================

/**
 * The PARSED shape of the `metricstream` health-check STRATEGY config. The
 * backend builds an ANNOTATED equivalent (a `configString` with
 * `x-options-resolver: metricstreamStreamId`) that parses to this shape; the
 * annotations reference the resolver-name constants in `./health-resolvers`.
 */
export const MetricStreamStrategyConfigSchema = z.object({
  streamId: z.string().min(1),
});
export type MetricStreamStrategyConfig = z.infer<
  typeof MetricStreamStrategyConfigSchema
>;

/**
 * The PARSED shape of the single `metric-window` COLLECTOR config - FROZEN for
 * the C-phase agents. The backend builds the ANNOTATED equivalent:
 *
 * - `metricName`: a searchable dropdown (`x-options-resolver:
 *   metricstreamMetricName`, `x-searchable: true`).
 * - `labelFilters`: an ARRAY of `{ key, value }` objects. Each item's `key`
 *   carries `x-options-resolver: metricstreamLabelKey` and each `value` carries
 *   `x-options-resolver: metricstreamLabelValue` with
 *   `x-depends-on: ["metricName", "key"]`. This relies on the DynamicForm
 *   row-scoped-formValues capability so the `value` resolver reads its own row's
 *   `key` alongside the top-level `metricName` (UI investigation outcome (b)).
 * - `windowSeconds`: optional; same complete-minutes + in-progress-minute
 *   window semantics as logstream. Absent -> collector default.
 *
 * The label filters are EXACT-MATCH: a series matches when it carries every
 * `key=value` pair (extra labels on the series are ignored).
 */
export const MetricWindowCollectorConfigSchema = z.object({
  metricName: z.string().min(1).max(MAX_METRIC_NAME_CHARS),
  labelFilters: z.array(LabelFilterSchema).max(MAX_LABEL_FILTERS).default([]),
  windowSeconds: z.number().int().min(60).max(86_400).optional(),
});
export type MetricWindowCollectorConfig = z.infer<
  typeof MetricWindowCollectorConfigSchema
>;

/**
 * The `metric-window` collector RESULT fields. Numeric, chart-annotated. Aggregated
 * across all series matching the `(metricName, labelFilters)` selection over the
 * window: `min` of mins, `max` of maxs, sum-weighted `avg`, `last` = latest
 * `lastTs`. `ratePerSecond`/`increase` are counters-only (0 for gauges).
 * `secondsSinceLastSample` falls back to stream age when the selection was never
 * seen (the logstream staleness lesson).
 */
export const MetricWindowResultSchema = z.object({
  lastValue: z.number(),
  avgValue: z.number(),
  minValue: z.number(),
  maxValue: z.number(),
  sampleCount: z.number(),
  seriesCount: z.number(),
  ratePerSecond: z.number(),
  increase: z.number(),
  secondsSinceLastSample: z.number(),
});
export type MetricWindowResult = z.infer<typeof MetricWindowResultSchema>;
