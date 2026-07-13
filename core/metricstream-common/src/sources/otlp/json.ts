/**
 * OTLP/JSON `ExportMetricsServiceRequest` -> the neutral {@link OtlpMetricsPayload}
 * (the same shape the protobuf decoder produces), so `./normalize` folds either
 * wire form identically. Tolerant of the proto3-JSON mapping: camelCase or
 * snake_case keys, `int64` values as strings or numbers, `aggregationTemporality`
 * as a number or an enum name. Malformed sub-parts are skipped rather than
 * throwing. Pure module: no IO, no node builtins - browser-safe so the satellite
 * agent's `/v1/metrics` receiver can import it alongside the core ingest path.
 */

import {
  AGGREGATION_TEMPORALITY,
  type OtlpHistogramPoint,
  type OtlpMetric,
  type OtlpMetricData,
  type OtlpMetricsPayload,
  type OtlpNumberPoint,
  type OtlpSummaryPoint,
} from "./decode";

export function parseOtlpMetricsJson(input: unknown): OtlpMetricsPayload {
  const root = asRecord(input);
  if (!root) return [];
  const out: OtlpMetricsPayload = [];
  for (const rmRaw of asArray(pick(root, "resourceMetrics", "resource_metrics"))) {
    const rm = asRecord(rmRaw);
    if (!rm) continue;
    const resourceObj = asRecord(pick(rm, "resource"));
    const resource = resourceObj
      ? kvListToObject(asArray(pick(resourceObj, "attributes")))
      : {};
    const metrics: OtlpMetric[] = [];
    for (const smRaw of asArray(pick(rm, "scopeMetrics", "scope_metrics"))) {
      const sm = asRecord(smRaw);
      if (!sm) continue;
      for (const mRaw of asArray(pick(sm, "metrics"))) {
        const metric = jsonMetric(asRecord(mRaw));
        if (metric) metrics.push(metric);
      }
    }
    out.push({ resource, metrics });
  }
  return out;
}

function jsonMetric(rec: Record<string, unknown> | null): OtlpMetric | null {
  if (!rec) return null;
  const name = asString(pick(rec, "name")) ?? "";
  const unit = asString(pick(rec, "unit")) ?? undefined;
  const data = jsonMetricData(rec);
  return { name, unit, data };
}

function jsonMetricData(rec: Record<string, unknown>): OtlpMetricData | undefined {
  const gauge = asRecord(pick(rec, "gauge"));
  if (gauge) {
    return { kind: "gauge", points: numberPoints(gauge) };
  }
  const sum = asRecord(pick(rec, "sum"));
  if (sum) {
    return {
      kind: "sum",
      monotonic: asBool(pick(sum, "isMonotonic", "is_monotonic")),
      temporality: jsonTemporality(pick(sum, "aggregationTemporality", "aggregation_temporality")),
      points: numberPoints(sum),
    };
  }
  const histogram = asRecord(pick(rec, "histogram"));
  if (histogram) {
    return {
      kind: "histogram",
      temporality: jsonTemporality(
        pick(histogram, "aggregationTemporality", "aggregation_temporality"),
      ),
      points: histogramPoints(histogram),
    };
  }
  const summary = asRecord(pick(rec, "summary"));
  if (summary) {
    return { kind: "summary", points: summaryPoints(summary) };
  }
  return undefined;
}

function numberPoints(data: Record<string, unknown>): OtlpNumberPoint[] {
  const out: OtlpNumberPoint[] = [];
  for (const raw of asArray(pick(data, "dataPoints", "data_points"))) {
    const dp = asRecord(raw);
    if (!dp) continue;
    out.push({
      attributes: kvListToObject(asArray(pick(dp, "attributes"))),
      timeUnixNano: asBigint(pick(dp, "timeUnixNano", "time_unix_nano")),
      value: jsonNumberValue(dp),
    });
  }
  return out;
}

function histogramPoints(data: Record<string, unknown>): OtlpHistogramPoint[] {
  const out: OtlpHistogramPoint[] = [];
  for (const raw of asArray(pick(data, "dataPoints", "data_points"))) {
    const dp = asRecord(raw);
    if (!dp) continue;
    const sum = pick(dp, "sum");
    out.push({
      attributes: kvListToObject(asArray(pick(dp, "attributes"))),
      timeUnixNano: asBigint(pick(dp, "timeUnixNano", "time_unix_nano")),
      count: asNumber(pick(dp, "count")),
      sum: sum === undefined ? undefined : asNumber(sum),
    });
  }
  return out;
}

function summaryPoints(data: Record<string, unknown>): OtlpSummaryPoint[] {
  const out: OtlpSummaryPoint[] = [];
  for (const raw of asArray(pick(data, "dataPoints", "data_points"))) {
    const dp = asRecord(raw);
    if (!dp) continue;
    out.push({
      attributes: kvListToObject(asArray(pick(dp, "attributes"))),
      timeUnixNano: asBigint(pick(dp, "timeUnixNano", "time_unix_nano")),
      count: asNumber(pick(dp, "count")),
      sum: asNumber(pick(dp, "sum")),
    });
  }
  return out;
}

/** A NumberDataPoint's value: `asDouble` or `asInt` (string or number). */
function jsonNumberValue(dp: Record<string, unknown>): number {
  const asDouble = pick(dp, "asDouble", "as_double");
  if (asDouble !== undefined) return asNumber(asDouble);
  const asInt = pick(dp, "asInt", "as_int");
  if (asInt !== undefined) return asNumber(asInt);
  return 0;
}

/** Map a JSON aggregationTemporality (number or enum name) to its int value. */
function jsonTemporality(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
    if (trimmed.endsWith("DELTA")) return AGGREGATION_TEMPORALITY.DELTA;
    if (trimmed.endsWith("CUMULATIVE")) return AGGREGATION_TEMPORALITY.CUMULATIVE;
  }
  return AGGREGATION_TEMPORALITY.UNSPECIFIED;
}

/** Resolve an OTLP/JSON AnyValue object to a plain value. */
function resolveJsonAnyValue(value: unknown): unknown {
  const obj = asRecord(value);
  if (!obj) return value ?? null;
  if ("stringValue" in obj) return obj.stringValue;
  if ("string_value" in obj) return obj.string_value;
  if ("boolValue" in obj) return Boolean(obj.boolValue);
  if ("bool_value" in obj) return Boolean(obj.bool_value);
  if ("intValue" in obj) return Number(obj.intValue);
  if ("int_value" in obj) return Number(obj.int_value);
  if ("doubleValue" in obj) return Number(obj.doubleValue);
  if ("double_value" in obj) return Number(obj.double_value);
  const arr = pick(obj, "arrayValue", "array_value");
  if (arr) {
    const values = asArray(pick(asRecord(arr) ?? {}, "values"));
    return values.map((v) => resolveJsonAnyValue(v));
  }
  const kv = pick(obj, "kvlistValue", "kvlist_value");
  if (kv) return kvListToObject(asArray(pick(asRecord(kv) ?? {}, "values")));
  return null;
}

function kvListToObject(list: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of list) {
    const kv = asRecord(raw);
    if (!kv) continue;
    const key = asString(pick(kv, "key"));
    if (key === null) continue;
    out[key] = resolveJsonAnyValue(pick(kv, "value"));
  }
  return out;
}

// -----------------------------------------------------------------------------
// small tolerant accessors
// -----------------------------------------------------------------------------

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asBigint(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return 0n;
}
