import {
  NormalizedSpanEventSchema,
  NormalizedSpanLinkSchema,
  TelemetrySpanKindSchema,
  TelemetrySpanStatusCodeSchema,
} from "@checkstack/telemetry-common";
import { z } from "zod";

// =============================================================================
// STREAM CONFIG (sampling + caps + tiered retention)
// =============================================================================

/**
 * Tail-based sampling policy. Applied by the trace sink once a trace is
 * COMPLETE (root seen, or `completionGraceSeconds` elapsed since the last span):
 * the whole trace is either RETAINED (raw spans kept) or dropped to summary
 * only. Every field has a default so an empty object parses to the full policy.
 */
export const TraceSamplingConfigSchema = z.object({
  /** Always retain a trace that has at least one error span. */
  keepErrorTraces: z.boolean().default(true),
  /**
   * Retain any trace whose root duration is at least this many ms. `null`
   * disables the slow-trace rule (only error + baseline sampling then apply).
   */
  slowTraceThresholdMs: z.number().min(0).max(3_600_000).nullable().default(1000),
  /** Fraction (0..1) of the remaining (non-error, non-slow) traces to retain. */
  baselineSampleRate: z.number().min(0).max(1).default(0.01),
  /**
   * Hard ceiling on retained traces per stream per hour (overflow is dropped to
   * summary only). `null` = no ceiling beyond the sampling rules above.
   */
  maxRetainedTracesPerHour: z
    .number()
    .int()
    .min(1)
    .max(10_000_000)
    .nullable()
    .default(null),
});
export type TraceSamplingConfig = z.infer<typeof TraceSamplingConfigSchema>;

/**
 * Per-stream sampling, cardinality, rate and retention policy. Every field has
 * a default so an empty object parses to the full policy; updates send a
 * partial and merge.
 *
 * Retention is tiered: raw spans of RETAINED traces are kept for
 * `retainedTraceRetentionDays`; every trace (retained or not) keeps a
 * lightweight `trace_summaries` row for `summaryRetentionDays`; the per-minute
 * and per-hour operation aggregates follow `minuteRetentionHours` /
 * `hourlyRetentionDays`. `hotRetentionHours` bounds the in-flight assembly
 * window before a trace is force-completed.
 */
export const TraceStreamConfigSchema = z.object({
  /** Hours to keep in-flight (not-yet-complete) trace assembly state. */
  hotRetentionHours: z.number().int().min(1).max(72).default(6),
  /** Days to keep raw spans of RETAINED traces. */
  retainedTraceRetentionDays: z.number().int().min(1).max(90).default(7),
  /** Days to keep lightweight trace summaries (every trace, retained or not). */
  summaryRetentionDays: z.number().int().min(1).max(365).default(30),
  /** Hours to keep minute-grain operation buckets before rolling to hourly. */
  minuteRetentionHours: z.number().int().min(1).max(24 * 30).default(48),
  /** Days to keep hourly operation buckets and important events. */
  hourlyRetentionDays: z.number().int().min(1).max(730).default(90),
  /**
   * Seconds to wait after the last span of a trace before force-completing it
   * (assembling + sampling) when no root span has arrived.
   */
  completionGraceSeconds: z.number().int().min(5).max(600).default(30),
  /**
   * Tail-based sampling policy (see {@link TraceSamplingConfigSchema}).
   * `prefault` (not `default`) so an omitted `sampling` is PARSED through the
   * nested schema and picks up its per-field defaults - zod v4's `.default`
   * short-circuits parsing and would store a bare `{}` instead.
   */
  sampling: TraceSamplingConfigSchema.prefault({}),
  /** Max distinct service names tracked per stream (overflow surfaced). */
  serviceCap: z.number().int().min(1).max(100_000).default(100),
  /** Max distinct operation (span name) values tracked per service. */
  operationCapPerService: z.number().int().min(1).max(100_000).default(500),
  /** Hard cap on spans assembled into a single trace (overflow dropped). */
  maxSpansPerTrace: z.number().int().min(1).max(1_000_000).default(2000),
  /** Truncate a single span's serialized size to this many bytes. */
  maxSpanBytes: z.number().int().min(256).max(1_048_576).default(32_768),
  /** Soft ingest rate limit per stream per minute (429 + Retry-After above it). */
  softRateLimitPerMinute: z
    .number()
    .int()
    .min(0)
    .max(10_000_000)
    .default(60_000),
});
export type TraceStreamConfig = z.infer<typeof TraceStreamConfigSchema>;

/** Partial config for updates: any subset of {@link TraceStreamConfigSchema}. */
export const TraceStreamConfigInputSchema = TraceStreamConfigSchema.partial();
export type TraceStreamConfigInput = z.infer<
  typeof TraceStreamConfigInputSchema
>;

/** Compile-time defaults, for callers that need the policy without parsing. */
export const DEFAULT_TRACE_STREAM_CONFIG: TraceStreamConfig =
  TraceStreamConfigSchema.parse({});

// =============================================================================
// STREAM
// =============================================================================

export const TraceStreamSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config: TraceStreamConfigSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TraceStream = z.infer<typeof TraceStreamSchema>;

export const CreateTraceStreamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  config: TraceStreamConfigInputSchema.optional(),
});
export type CreateTraceStream = z.infer<typeof CreateTraceStreamSchema>;

export const UpdateTraceStreamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  config: TraceStreamConfigInputSchema.optional(),
});
export type UpdateTraceStream = z.infer<typeof UpdateTraceStreamSchema>;

// =============================================================================
// STORED SPAN (as served by getTrace)
// =============================================================================

/**
 * One STORED span of a retained trace, as served by `getTrace`. Span kind,
 * status code and the event/link shapes are REUSED from
 * `@checkstack/telemetry-common` so the sink stores exactly what a source
 * normalized. `id` is the row's bigint identity serialized to a string (JS
 * numbers cannot hold a 64-bit id). `durationMs` is precomputed
 * (`endTs - startTs`) for the waterfall. `serviceName` is broken out of
 * `resourceAttributes` because it is the primary grouping dimension.
 */
export const TraceSpanSchema = z.object({
  /** Row identity (bigint serialized to string). */
  id: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  kind: TelemetrySpanKindSchema,
  serviceName: z.string().nullable(),
  startTs: z.date(),
  endTs: z.date(),
  durationMs: z.number(),
  statusCode: TelemetrySpanStatusCodeSchema,
  statusMessage: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()).nullable(),
  events: z.array(NormalizedSpanEventSchema).nullable(),
  links: z.array(NormalizedSpanLinkSchema).nullable(),
  resourceAttributes: z.record(z.string(), z.unknown()).nullable(),
});
export type TraceSpan = z.infer<typeof TraceSpanSchema>;

// =============================================================================
// TRACE SUMMARY (search rows + overview)
// =============================================================================

/**
 * A lightweight per-trace summary row. Written for EVERY trace (retained or
 * not) and drives search + overview. `retained` is tri-state: `null` while the
 * trace is still in-flight (sampling not yet decided), then `true`/`false` once
 * the tail-sampling verdict lands.
 */
export const TraceSummarySchema = z.object({
  traceId: z.string(),
  rootServiceName: z.string().nullable(),
  rootSpanName: z.string().nullable(),
  startTs: z.date(),
  durationMs: z.number(),
  spanCount: z.number(),
  errorSpanCount: z.number(),
  hasError: z.boolean(),
  /** `null` = sampling undecided (trace still assembling). */
  retained: z.boolean().nullable(),
  lastSpanAt: z.date(),
});
export type TraceSummary = z.infer<typeof TraceSummarySchema>;

// =============================================================================
// SEARCH
// =============================================================================

/** Keyset cursor for trace search: page after this `(startTs, traceId)`. */
export const TraceSearchCursorSchema = z.object({
  startTs: z.coerce.date(),
  traceId: z.string(),
});
export type TraceSearchCursor = z.infer<typeof TraceSearchCursorSchema>;

/** Filter a search to error-only or ok-only traces. */
export const TraceStatusFilterSchema = z.enum(["error", "ok"]);
export type TraceStatusFilter = z.infer<typeof TraceStatusFilterSchema>;

export const SearchTracesSchema = z.object({
  streamId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  serviceName: z.string().optional(),
  spanName: z.string().optional(),
  status: TraceStatusFilterSchema.optional(),
  minDurationMs: z.number().min(0).optional(),
  maxDurationMs: z.number().min(0).optional(),
  traceId: z.string().optional(),
  cursor: TraceSearchCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type SearchTraces = z.infer<typeof SearchTracesSchema>;

export const SearchTracesResultSchema = z.object({
  traces: z.array(TraceSummarySchema),
  nextCursor: TraceSearchCursorSchema.nullable(),
});
export type SearchTracesResult = z.infer<typeof SearchTracesResultSchema>;

// =============================================================================
// GET TRACE (summary + waterfall spans)
// =============================================================================

export const GetTraceSchema = z.object({
  streamId: z.string(),
  traceId: z.string(),
});
export type GetTrace = z.infer<typeof GetTraceSchema>;

export const GetTraceResultSchema = z.object({
  summary: TraceSummarySchema,
  spans: z.array(TraceSpanSchema),
});
export type GetTraceResult = z.infer<typeof GetTraceResultSchema>;

// =============================================================================
// OPERATION BUCKETS (windowed aggregates for charts)
// =============================================================================

export const BucketGrainSchema = z.enum(["minute", "hour"]);
export type BucketGrain = z.infer<typeof BucketGrainSchema>;

/**
 * One windowed aggregate over the spans matching an optional
 * `(serviceName, spanName)` selection at one tier. `durMinMs`/`durMaxMs`/`p95Ms`
 * are null when the bucket has no spans.
 */
export const TraceOpBucketSchema = z.object({
  bucketStart: z.date(),
  spanCount: z.number(),
  errorCount: z.number(),
  durSumMs: z.number(),
  durMinMs: z.number().nullable(),
  durMaxMs: z.number().nullable(),
  p95Ms: z.number().nullable(),
});
export type TraceOpBucket = z.infer<typeof TraceOpBucketSchema>;

export const GetOpBucketsSchema = z.object({
  streamId: z.string(),
  serviceName: z.string().optional(),
  spanName: z.string().optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  /** Omitted = auto-pick minute vs hour tier from the window width. */
  grain: BucketGrainSchema.optional(),
});
export type GetOpBuckets = z.infer<typeof GetOpBucketsSchema>;

export const GetOpBucketsResultSchema = z.object({
  grain: BucketGrainSchema,
  buckets: z.array(TraceOpBucketSchema),
});
export type GetOpBucketsResult = z.infer<typeof GetOpBucketsResultSchema>;

// =============================================================================
// SERVICES + OPERATIONS (autocomplete / browser)
// =============================================================================

/** One service seen in a stream, with its operation cardinality. */
export const TraceServiceInfoSchema = z.object({
  serviceName: z.string(),
  operationCount: z.number(),
  lastSeenAt: z.date(),
});
export type TraceServiceInfo = z.infer<typeof TraceServiceInfoSchema>;

export const ListServicesSchema = z.object({
  streamId: z.string(),
});
export type ListServices = z.infer<typeof ListServicesSchema>;

export const ListServicesResultSchema = z.object({
  services: z.array(TraceServiceInfoSchema),
});
export type ListServicesResult = z.infer<typeof ListServicesResultSchema>;

/** One operation (span name) seen for a service. */
export const TraceOperationInfoSchema = z.object({
  spanName: z.string(),
  kind: TelemetrySpanKindSchema,
  lastSeenAt: z.date(),
});
export type TraceOperationInfo = z.infer<typeof TraceOperationInfoSchema>;

export const ListOperationsSchema = z.object({
  streamId: z.string(),
  serviceName: z.string(),
});
export type ListOperations = z.infer<typeof ListOperationsSchema>;

export const ListOperationsResultSchema = z.object({
  operations: z.array(TraceOperationInfoSchema),
});
export type ListOperationsResult = z.infer<typeof ListOperationsResultSchema>;

// =============================================================================
// OVERVIEW
// =============================================================================

/** Top service by span volume, for the overview card. */
export const TraceTopServiceSchema = z.object({
  serviceName: z.string(),
  spanCount: z.number(),
});
export type TraceTopService = z.infer<typeof TraceTopServiceSchema>;

export const StreamOverviewSchema = z.object({
  totals24h: z.object({
    spans: z.number(),
    traces: z.number(),
    errorTraces: z.number(),
    retainedTraces: z.number(),
  }),
  /** Most recent span activity, or null before any span arrived. */
  lastReceivedAt: z.date().nullable(),
  /**
   * Spans the pipeline dropped (rate-limit, buffer-full, or the span/service/
   * operation caps). Cumulative.
   */
  droppedSpansCount: z.number(),
  /**
   * Traces dropped to summary-only because the retained-per-hour ceiling
   * overflowed. Cumulative.
   */
  droppedTracesCount: z.number(),
  /**
   * Spans a satellite dropped from its in-transit buffer during a disconnect /
   * slow-consumer episode - telemetry that never reached core. Cumulative.
   */
  droppedInTransitCount: z.number(),
  /** Up to 5 slowest RETAINED traces in the last 24h (quick links). */
  slowestRetained: z.array(TraceSummarySchema).max(5),
  /** Up to 10 top services by span volume. */
  topServices: z.array(TraceTopServiceSchema).max(10),
});
export type StreamOverview = z.infer<typeof StreamOverviewSchema>;

export const GetStreamOverviewSchema = z.object({
  streamId: z.string(),
});
export type GetStreamOverview = z.infer<typeof GetStreamOverviewSchema>;

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
export const TraceStreamSummarySchema = z.object({
  /** The stream id (drives the `listKey` RLAC filter). */
  id: z.string(),
  name: z.string(),
  lastReceivedAt: z.date().nullable(),
  traces24h: z.number(),
  errorTraces24h: z.number(),
  serviceCount: z.number(),
});
export type TraceStreamSummary = z.infer<typeof TraceStreamSummarySchema>;

export const ListStreamSummariesResultSchema = z.object({
  summaries: z.array(TraceStreamSummarySchema),
});
export type ListStreamSummariesResult = z.infer<
  typeof ListStreamSummariesResultSchema
>;

// =============================================================================
// CROSS-STREAM TRACE LOOKUP (jump-to-trace by id)
// =============================================================================

/**
 * One stream in which a looked-up `traceId` was found.
 *
 * IMPORTANT: the identifier field MUST be `id` (the STREAM id). `findTraceById`
 * is a cross-stream read post-filtered by the caller's stream grants via
 * `listKey` - the item field the filter keys on is `id`.
 */
export const FindTraceByIdMatchSchema = z.object({
  /** The stream id (drives the `listKey` RLAC filter). */
  id: z.string(),
  streamName: z.string(),
  summary: TraceSummarySchema,
});
export type FindTraceByIdMatch = z.infer<typeof FindTraceByIdMatchSchema>;

export const FindTraceByIdSchema = z.object({
  traceId: z.string().min(1),
});
export type FindTraceById = z.infer<typeof FindTraceByIdSchema>;

export const FindTraceByIdResultSchema = z.object({
  matches: z.array(FindTraceByIdMatchSchema),
});
export type FindTraceByIdResult = z.infer<typeof FindTraceByIdResultSchema>;

// =============================================================================
// IMPORTANT EVENTS (viewer timeline)
// =============================================================================

export const TRACE_IMPORTANT_EVENT_TYPES = [
  "silence",
  "silence_recovered",
  "rate_limited",
  "span_cap_exceeded",
  "span_bytes_exceeded",
  "service_cap_exceeded",
  "operation_cap_exceeded",
  "error_spike",
] as const;

export const ImportantEventTypeSchema = z.enum(TRACE_IMPORTANT_EVENT_TYPES);
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

/**
 * Keyset page cursor for the important-events timeline. Ordering is
 * `(ts DESC, id DESC)`, so the cursor carries BOTH the timestamp and the id of
 * the last row on the page: paging on `ts` alone would skip or repeat rows that
 * share a millisecond (cap/rate events fire in bursts at the same `ts`).
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
// PICKER (dynamic options for the healthcheck strategy config + future pickers)
// =============================================================================

export const StreamForPickerSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type StreamForPicker = z.infer<typeof StreamForPickerSchema>;
