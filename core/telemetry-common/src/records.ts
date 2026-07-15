import { z } from "zod";
import type { TelemetrySignal } from "./signal-model";

/**
 * Normalized telemetry records - the lingua franca between SOURCES and SINKS.
 *
 * These shapes are deliberately OpenTelemetry-SHAPED (severity number bands,
 * resource + attributes, trace/span correlation ids, span kind/status), because
 * OTel is the only widely-agreed data model - but a source never needs to SPEAK
 * OTLP. A syslog line, a CloudWatch poll result and an OTLP export all become
 * the SAME normalized record before reaching a sink, so correlation keys and
 * resource identity are uniform no matter how the telemetry was produced.
 *
 * Records are IN-PROCESS structures handed from a source to a sink via the
 * telemetry extension points - they are not a wire format. Stream-level policy
 * (severity rules, banding, truncation, sampling, caps) is applied by the SINK's
 * own pipeline, exactly as it is for the plugins' token-push endpoints.
 */

/**
 * Resource identity shared by every record. `serviceName` is broken out
 * because it is the primary cross-signal correlation dimension (and feeds the
 * stream -> catalog-system mapping suggestions); everything else stays in
 * `attributes` (OTel resource attribute keys where applicable).
 */
export const TelemetryResourceSchema = z.object({
  serviceName: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type TelemetryResource = z.infer<typeof TelemetryResourceSchema>;

// =============================================================================
// LOGS
// =============================================================================

/**
 * One normalized log record. Maps 1:1 onto logstream's `IngestedLine` minus the
 * fields the sink derives itself (`band` from the stream's severity rules,
 * `observedAt` from receive time, body truncation from the stream's caps).
 */
export const NormalizedLogRecordSchema = z.object({
  /** Event time. The sink clamps this against platform receive time. */
  ts: z.date(),
  /** OTel severity number (0-24); 0/unknown is banded to `info` by the sink. */
  severityNumber: z.number().int().min(0).max(24).optional(),
  /** Original severity text from the source (`ERROR`, `warn`, syslog keyword). */
  severityText: z.string().optional(),
  /** Message body. The sink truncates to the stream's `maxLineBytes`. */
  body: z.string(),
  /** Flattened record attributes. */
  attributes: z.record(z.string(), z.unknown()).optional(),
  resource: TelemetryResourceSchema.optional(),
  /** W3C trace id (32 lowercase hex chars) when the source carries one. */
  traceId: z.string().optional(),
  /** W3C span id (16 lowercase hex chars) when the source carries one. */
  spanId: z.string().optional(),
});
export type NormalizedLogRecord = z.infer<typeof NormalizedLogRecordSchema>;

// =============================================================================
// METRICS
// =============================================================================

/**
 * Metric type / counter-kind literals - the SAME values metricstream uses for
 * its `NormalizedDatapoint`, so the metrics sink maps records without a
 * translation table. (The platform cannot import metricstream-common - the
 * dependency points the other way - so the literals are duplicated here and
 * guarded by the sink's own mapping tests.)
 */
export const TELEMETRY_METRIC_TYPES = ["gauge", "counter"] as const;
export const TelemetryMetricTypeSchema = z.enum(TELEMETRY_METRIC_TYPES);
export type TelemetryMetricType = z.infer<typeof TelemetryMetricTypeSchema>;

export const TELEMETRY_COUNTER_KINDS = ["cumulative", "delta"] as const;
export const TelemetryCounterKindSchema = z.enum(TELEMETRY_COUNTER_KINDS);
export type TelemetryCounterKind = z.infer<typeof TelemetryCounterKindSchema>;

/** One normalized scalar metric sample. */
/** Max exemplars carried per metric point (OTLP allows many; a handful is
 * plenty for a chart-to-trace jump and bounds storage). */
export const MAX_EXEMPLARS_PER_POINT = 4;

/**
 * An OTLP exemplar: a sampled measurement attached to a metric point that
 * carries the W3C trace context of the request that produced it - the bridge
 * from a chart point to the exact trace behind it.
 */
export const MetricExemplarSchema = z.object({
  /** W3C trace id (32 lowercase hex chars). */
  traceId: z.string().length(32),
  spanId: z.string().length(16).optional(),
  /** The sampled measurement value. */
  value: z.number(),
  ts: z.date(),
});
export type MetricExemplar = z.infer<typeof MetricExemplarSchema>;

export const NormalizedMetricPointSchema = z.object({
  name: z.string().min(1),
  type: TelemetryMetricTypeSchema,
  /** Only meaningful for counters; how the samples are reported. */
  counterKind: TelemetryCounterKindSchema.optional(),
  unit: z.string().optional(),
  labels: z.record(z.string(), z.string()),
  value: z.number(),
  ts: z.date(),
  /**
   * Resource identity. The metrics sink folds `serviceName` (and any resource
   * attributes it admits) into the series labels, mirroring how metricstream's
   * OTLP normalizer folds OTLP resource attrs.
   */
  resource: TelemetryResourceSchema.optional(),
  /** Trace-context exemplars sampled on this point (capped). */
  exemplars: z.array(MetricExemplarSchema).max(MAX_EXEMPLARS_PER_POINT).optional(),
});
export type NormalizedMetricPoint = z.infer<typeof NormalizedMetricPointSchema>;

// =============================================================================
// TRACES
// =============================================================================

export const TELEMETRY_SPAN_KINDS = [
  "internal",
  "server",
  "client",
  "producer",
  "consumer",
] as const;
export const TelemetrySpanKindSchema = z.enum(TELEMETRY_SPAN_KINDS);
export type TelemetrySpanKind = z.infer<typeof TelemetrySpanKindSchema>;

export const TELEMETRY_SPAN_STATUS_CODES = ["unset", "ok", "error"] as const;
export const TelemetrySpanStatusCodeSchema = z.enum(
  TELEMETRY_SPAN_STATUS_CODES,
);
export type TelemetrySpanStatusCode = z.infer<
  typeof TelemetrySpanStatusCodeSchema
>;

/** A timestamped event attached to a span (OTel `Span.Event`). */
export const NormalizedSpanEventSchema = z.object({
  ts: z.date(),
  name: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type NormalizedSpanEvent = z.infer<typeof NormalizedSpanEventSchema>;

/** A causal link to a span in another trace (OTel `Span.Link`). */
export const NormalizedSpanLinkSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type NormalizedSpanLink = z.infer<typeof NormalizedSpanLinkSchema>;

/**
 * One normalized span. Timestamps carry millisecond `Date`s for indexing plus
 * the original nanosecond precision (as OTel unix nanos in a bigint) so the
 * trace sink can store exact timings for sub-millisecond spans.
 */
export const NormalizedSpanSchema = z.object({
  /** W3C trace id: 32 lowercase hex chars. */
  traceId: z.string().length(32),
  /** W3C span id: 16 lowercase hex chars. */
  spanId: z.string().length(16),
  parentSpanId: z.string().length(16).optional(),
  name: z.string().min(1),
  kind: TelemetrySpanKindSchema,
  startTs: z.date(),
  endTs: z.date(),
  startUnixNano: z.bigint().optional(),
  endUnixNano: z.bigint().optional(),
  status: z
    .object({
      code: TelemetrySpanStatusCodeSchema,
      message: z.string().optional(),
    })
    .optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  events: z.array(NormalizedSpanEventSchema).optional(),
  links: z.array(NormalizedSpanLinkSchema).optional(),
  resource: TelemetryResourceSchema.optional(),
});
export type NormalizedSpan = z.infer<typeof NormalizedSpanSchema>;

// =============================================================================
// SIGNAL -> RECORD MAPPING
// =============================================================================

/** Compile-time map from a signal to its normalized record type. */
export interface TelemetryRecordMap {
  logs: NormalizedLogRecord;
  metrics: NormalizedMetricPoint;
  traces: NormalizedSpan;
}

/** The normalized record type for a given signal. */
export type TelemetryRecord<S extends TelemetrySignal> = TelemetryRecordMap[S];

/** Runtime schema lookup, for sources that validate records generically. */
export const TELEMETRY_RECORD_SCHEMAS: {
  [S in TelemetrySignal]: z.ZodType<TelemetryRecordMap[S]>;
} = {
  logs: NormalizedLogRecordSchema,
  metrics: NormalizedMetricPointSchema,
  traces: NormalizedSpanSchema,
};
