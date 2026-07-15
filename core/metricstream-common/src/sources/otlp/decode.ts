/**
 * OTLP METRICS field mapping over the shared protobuf primitives and the
 * signal-agnostic OTLP structure readers from `@checkstack/ingest-utils`.
 * Decodes an `ExportMetricsServiceRequest` (the body OTLP/HTTP metric shippers
 * POST) into a protocol-neutral {@link OtlpMetricsPayload}; the fold into
 * normalized datapoints (histogram/summary decomposition, resource-attr folding,
 * counter-flavor tagging) lives in `./normalize`.
 *
 * Field numbers follow the stable OpenTelemetry proto definitions
 * (`opentelemetry/proto/metrics/v1/metrics.proto`,
 * `opentelemetry/proto/collector/metrics/v1/metrics_service.proto`). The
 * `AnyValue` / `KeyValue` / `Resource` readers and the depth guard are shared;
 * only the metrics-specific message decoding lives here. Unknown fields are
 * skipped, so a newer producer decodes fine. Pure module: no IO.
 */

import {
  ProtoReader,
  bytesToHex,
  readAttribute,
  readResource,
} from "@checkstack/otlp-wire";

/** OTLP `AggregationTemporality` enum. */
export const AGGREGATION_TEMPORALITY = {
  UNSPECIFIED: 0,
  DELTA: 1,
  CUMULATIVE: 2,
} as const;

/**
 * One OTLP `Exemplar`: a sampled measurement carrying the trace context of the
 * request that produced it (the chart-point -> trace bridge). `traceId`/`spanId`
 * are lowercase hex of the raw id bytes (empty string when the field was absent);
 * the normalizer validates + drops those without a real 32-hex trace id.
 */
export interface OtlpExemplar {
  timeUnixNano: bigint;
  value: number;
  traceId: string;
  spanId: string;
}

/** One numeric datapoint (Gauge / Sum). */
export interface OtlpNumberPoint {
  attributes: Record<string, unknown>;
  timeUnixNano: bigint;
  value: number;
  /** Trace-context exemplars sampled on this point (absent when none decoded). */
  exemplars?: OtlpExemplar[];
}

/** One histogram datapoint (only `count` + optional `sum` are kept; buckets dropped). */
export interface OtlpHistogramPoint {
  attributes: Record<string, unknown>;
  timeUnixNano: bigint;
  count: number;
  sum?: number;
  /** Trace-context exemplars sampled on this point (absent when none decoded). */
  exemplars?: OtlpExemplar[];
}

/** One summary datapoint (only `count` + `sum` are kept; quantiles dropped). */
export interface OtlpSummaryPoint {
  attributes: Record<string, unknown>;
  timeUnixNano: bigint;
  count: number;
  sum: number;
}

/** The decoded metric data (oneof), tagged by kind. */
export type OtlpMetricData =
  | { kind: "gauge"; points: OtlpNumberPoint[] }
  | { kind: "sum"; monotonic: boolean; temporality: number; points: OtlpNumberPoint[] }
  | { kind: "histogram"; temporality: number; points: OtlpHistogramPoint[] }
  | { kind: "summary"; points: OtlpSummaryPoint[] };

/** One decoded metric: name/unit + its typed data (undefined when unsupported). */
export interface OtlpMetric {
  name: string;
  unit?: string;
  data?: OtlpMetricData;
}

/** One `ResourceMetrics`: the resource attributes plus its flattened metrics. */
export interface OtlpResourceMetrics {
  resource: Record<string, unknown>;
  metrics: OtlpMetric[];
}

/** The decoded `ExportMetricsServiceRequest`. */
export type OtlpMetricsPayload = OtlpResourceMetrics[];

// -----------------------------------------------------------------------------
// datapoint readers
// -----------------------------------------------------------------------------

/**
 * Read one `Exemplar` message. Fields (metrics.proto `Exemplar`):
 * `time_unix_nano` = 2 (fixed64), `as_double` = 3 (double), `span_id` = 4 (bytes),
 * `trace_id` = 5 (bytes), `as_int` = 6 (sfixed64), `filtered_attributes` = 7
 * (skipped - the sink stores the trace context, not the exemplar's own attrs).
 */
function readExemplar(reader: ProtoReader): OtlpExemplar {
  const exemplar: OtlpExemplar = {
    timeUnixNano: 0n,
    value: 0,
    traceId: "",
    spanId: "",
  };
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 2: { // time_unix_nano (fixed64)
        exemplar.timeUnixNano = reader.readFixed64();
        break;
      }
      case 3: { // as_double (double)
        exemplar.value = reader.readDouble();
        break;
      }
      case 4: { // span_id (bytes)
        exemplar.spanId = bytesToHex(reader.readBytes());
        break;
      }
      case 5: { // trace_id (bytes)
        exemplar.traceId = bytesToHex(reader.readBytes());
        break;
      }
      case 6: { // as_int (sfixed64)
        exemplar.value = Number(BigInt.asIntN(64, reader.readFixed64()));
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return exemplar;
}

function readNumberDataPoint(reader: ProtoReader): OtlpNumberPoint {
  const exemplars: OtlpExemplar[] = [];
  const point: OtlpNumberPoint = {
    attributes: {},
    timeUnixNano: 0n,
    value: 0,
    exemplars,
  };
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 7: { // attributes (repeated KeyValue)
        Object.assign(point.attributes, readAttribute(new ProtoReader(reader.readBytes())));
        break;
      }
      case 3: { // time_unix_nano (fixed64)
        point.timeUnixNano = reader.readFixed64();
        break;
      }
      case 4: { // as_double (double)
        point.value = reader.readDouble();
        break;
      }
      case 5: { // exemplars (repeated Exemplar)
        exemplars.push(readExemplar(new ProtoReader(reader.readBytes())));
        break;
      }
      case 6: { // as_int (sfixed64)
        point.value = Number(BigInt.asIntN(64, reader.readFixed64()));
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return point;
}

function readHistogramDataPoint(reader: ProtoReader): OtlpHistogramPoint {
  const exemplars: OtlpExemplar[] = [];
  const point: OtlpHistogramPoint = {
    attributes: {},
    timeUnixNano: 0n,
    count: 0,
    exemplars,
  };
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 9: { // attributes
        Object.assign(point.attributes, readAttribute(new ProtoReader(reader.readBytes())));
        break;
      }
      case 3: { // time_unix_nano (fixed64)
        point.timeUnixNano = reader.readFixed64();
        break;
      }
      case 4: { // count (fixed64)
        point.count = Number(reader.readFixed64());
        break;
      }
      case 5: { // sum (double)
        point.sum = reader.readDouble();
        break;
      }
      case 8: { // exemplars (repeated Exemplar)
        exemplars.push(readExemplar(new ProtoReader(reader.readBytes())));
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return point;
}

function readSummaryDataPoint(reader: ProtoReader): OtlpSummaryPoint {
  const point: OtlpSummaryPoint = {
    attributes: {},
    timeUnixNano: 0n,
    count: 0,
    sum: 0,
  };
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 7: { // attributes
        Object.assign(point.attributes, readAttribute(new ProtoReader(reader.readBytes())));
        break;
      }
      case 3: { // time_unix_nano (fixed64)
        point.timeUnixNano = reader.readFixed64();
        break;
      }
      case 4: { // count (fixed64)
        point.count = Number(reader.readFixed64());
        break;
      }
      case 5: { // sum (double)
        point.sum = reader.readDouble();
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return point;
}

// -----------------------------------------------------------------------------
// data-shape readers (Gauge / Sum / Histogram / Summary)
// -----------------------------------------------------------------------------

function readNumberPoints(reader: ProtoReader): OtlpNumberPoint[] {
  const points: OtlpNumberPoint[] = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) {
      points.push(readNumberDataPoint(new ProtoReader(reader.readBytes())));
    } else {
      reader.skip(wireType);
    }
  }
  return points;
}

function readSum(reader: ProtoReader): OtlpMetricData {
  const points: OtlpNumberPoint[] = [];
  let temporality: number = AGGREGATION_TEMPORALITY.UNSPECIFIED;
  let monotonic = false;
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: { // data_points
        points.push(readNumberDataPoint(new ProtoReader(reader.readBytes())));
        break;
      }
      case 2: { // aggregation_temporality (enum)
        temporality = reader.readVarintNumber();
        break;
      }
      case 3: { // is_monotonic (bool)
        monotonic = reader.readVarintNumber() !== 0;
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return { kind: "sum", monotonic, temporality, points };
}

function readHistogram(reader: ProtoReader): OtlpMetricData {
  const points: OtlpHistogramPoint[] = [];
  let temporality: number = AGGREGATION_TEMPORALITY.UNSPECIFIED;
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: { // data_points
        points.push(readHistogramDataPoint(new ProtoReader(reader.readBytes())));
        break;
      }
      case 2: { // aggregation_temporality
        temporality = reader.readVarintNumber();
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return { kind: "histogram", temporality, points };
}

function readSummary(reader: ProtoReader): OtlpMetricData {
  const points: OtlpSummaryPoint[] = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) {
      points.push(readSummaryDataPoint(new ProtoReader(reader.readBytes())));
    } else {
      reader.skip(wireType);
    }
  }
  return { kind: "summary", points };
}

// -----------------------------------------------------------------------------
// Metric / ScopeMetrics / ResourceMetrics / request
// -----------------------------------------------------------------------------

function readMetric(reader: ProtoReader): OtlpMetric {
  const metric: OtlpMetric = { name: "" };
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: { // name
        metric.name = reader.readString();
        break;
      }
      case 3: { // unit
        metric.unit = reader.readString();
        break;
      }
      case 5: { // gauge
        metric.data = { kind: "gauge", points: readNumberPoints(new ProtoReader(reader.readBytes())) };
        break;
      }
      case 7: { // sum
        metric.data = readSum(new ProtoReader(reader.readBytes()));
        break;
      }
      case 9: { // histogram
        metric.data = readHistogram(new ProtoReader(reader.readBytes()));
        break;
      }
      case 11: { // summary
        metric.data = readSummary(new ProtoReader(reader.readBytes()));
        break;
      }
      default: {
        // description (2), exponential_histogram (10), metadata (12), etc.
        reader.skip(wireType);
      }
    }
  }
  return metric;
}

function readScopeMetrics(reader: ProtoReader): OtlpMetric[] {
  const metrics: OtlpMetric[] = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 2) {
      metrics.push(readMetric(new ProtoReader(reader.readBytes())));
    } else {
      reader.skip(wireType);
    }
  }
  return metrics;
}

function readResourceMetrics(reader: ProtoReader): OtlpResourceMetrics {
  let resource: Record<string, unknown> = {};
  const metrics: OtlpMetric[] = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1: { // resource
        resource = readResource(new ProtoReader(reader.readBytes()));
        break;
      }
      case 2: { // scope_metrics (repeated)
        metrics.push(...readScopeMetrics(new ProtoReader(reader.readBytes())));
        break;
      }
      default: {
        reader.skip(wireType);
      }
    }
  }
  return { resource, metrics };
}

/** Decode an `ExportMetricsServiceRequest` from protobuf bytes. */
export function decodeExportMetricsServiceRequest(
  buf: Uint8Array,
): OtlpMetricsPayload {
  const reader = new ProtoReader(buf);
  const out: OtlpMetricsPayload = [];
  while (reader.hasMore) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) {
      out.push(readResourceMetrics(new ProtoReader(reader.readBytes())));
    } else {
      reader.skip(wireType);
    }
  }
  return out;
}
