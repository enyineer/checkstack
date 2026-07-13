/**
 * Fold a decoded OTLP metrics payload into normalized datapoints. This is where
 * the metric-model decisions live:
 *
 * - HISTOGRAM + SUMMARY are DECOMPOSED into `<name>_sum` and `<name>_count`
 *   counters (Prometheus convention), so exactly two datapoint shapes
 *   (gauge / counter) flow through storage - no percentiles v1.
 * - A SUM's counter flavor is tagged once: monotonic sums are counters with
 *   `counterKind` `cumulative` or `delta` (from aggregation temporality); a
 *   NON-monotonic sum (UpDownCounter) is a gauge (its value is a level, not a
 *   monotonic total).
 * - GAUGE datapoints are gauges (no counter flavor).
 * - A small, DOCUMENTED allowlist of RESOURCE attributes (service.name,
 *   service.namespace, service.instance.id) is folded into every datapoint's
 *   labels so series stay attributable without exploding cardinality on the full
 *   resource. Datapoint attributes win over resource attributes on a key clash.
 *
 * `ts` is derived from `time_unix_nano` (0/absent -> receive time); the sink
 * clamps it into the trust window afterwards. Pure module: no IO.
 */

import type { NormalizedDatapoint } from "../../schemas";
import {
  AGGREGATION_TEMPORALITY,
  type OtlpMetric,
  type OtlpMetricsPayload,
} from "./decode";

/**
 * Resource attributes folded into every datapoint's labels. Kept deliberately
 * SMALL - these identify the emitting service/instance without pulling the whole
 * resource (which would explode series cardinality). Documented + frozen; extend
 * only with care (a new label key re-keys every affected series id).
 */
export const OTLP_RESOURCE_LABEL_ALLOWLIST = [
  "service.name",
  "service.namespace",
  "service.instance.id",
] as const;

const NANOS_PER_MS = 1_000_000n;

export interface OtlpNormalizeResult {
  datapoints: NormalizedDatapoint[];
  /** Datapoints that could not be represented (OTLP partialSuccess count). */
  rejected: number;
}

function tsFromNanos(nanos: bigint, fallback: Date): Date {
  if (nanos <= 0n) return fallback;
  return new Date(Number(nanos / NANOS_PER_MS));
}

/** Coerce an OTLP attribute value to a label string. */
function labelValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Build the label set for a datapoint: allowlisted resource attrs + point attrs. */
function buildLabels({
  resourceLabels,
  attributes,
}: {
  resourceLabels: Record<string, string>;
  attributes: Record<string, unknown>;
}): Record<string, string> {
  const labels: Record<string, string> = { ...resourceLabels };
  for (const [key, value] of Object.entries(attributes)) {
    labels[key] = labelValue(value);
  }
  return labels;
}

/** The allowlisted resource attributes of a ResourceMetrics, as label strings. */
function resourceLabelsOf(resource: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of OTLP_RESOURCE_LABEL_ALLOWLIST) {
    const value = resource[key];
    if (value !== undefined && value !== null) out[key] = labelValue(value);
  }
  return out;
}

export function normalizeOtlpMetrics({
  payload,
  now,
}: {
  payload: OtlpMetricsPayload;
  now: Date;
}): OtlpNormalizeResult {
  const datapoints: NormalizedDatapoint[] = [];
  let rejected = 0;

  for (const resourceMetrics of payload) {
    const resourceLabels = resourceLabelsOf(resourceMetrics.resource);
    for (const metric of resourceMetrics.metrics) {
      rejected += foldMetric({ metric, resourceLabels, now, datapoints });
    }
  }

  return { datapoints, rejected };
}

/** Fold one metric into `datapoints`; returns the count of rejected datapoints. */
function foldMetric({
  metric,
  resourceLabels,
  now,
  datapoints,
}: {
  metric: OtlpMetric;
  resourceLabels: Record<string, string>;
  now: Date;
  datapoints: NormalizedDatapoint[];
}): number {
  const { name, unit, data } = metric;
  if (!name || !data) {
    return countDatapoints(metric);
  }

  switch (data.kind) {
    case "gauge": {
      for (const p of data.points) {
        datapoints.push({
          name,
          type: "gauge",
          unit,
          labels: buildLabels({ resourceLabels, attributes: p.attributes }),
          value: p.value,
          ts: tsFromNanos(p.timeUnixNano, now),
        });
      }
      return 0;
    }
    case "sum": {
      const isDelta = data.temporality === AGGREGATION_TEMPORALITY.DELTA;
      for (const p of data.points) {
        const labels = buildLabels({ resourceLabels, attributes: p.attributes });
        const ts = tsFromNanos(p.timeUnixNano, now);
        if (data.monotonic) {
          datapoints.push({
            name,
            type: "counter",
            counterKind: isDelta ? "delta" : "cumulative",
            unit,
            labels,
            value: p.value,
            ts,
          });
        } else {
          // A non-monotonic sum is a level (UpDownCounter) - store as a gauge.
          datapoints.push({ name, type: "gauge", unit, labels, value: p.value, ts });
        }
      }
      return 0;
    }
    case "histogram": {
      const counterKind =
        data.temporality === AGGREGATION_TEMPORALITY.DELTA ? "delta" : "cumulative";
      for (const p of data.points) {
        const labels = buildLabels({ resourceLabels, attributes: p.attributes });
        const ts = tsFromNanos(p.timeUnixNano, now);
        datapoints.push({
          name: `${name}_count`,
          type: "counter",
          counterKind,
          unit,
          labels,
          value: p.count,
          ts,
        });
        if (p.sum !== undefined) {
          datapoints.push({
            name: `${name}_sum`,
            type: "counter",
            counterKind,
            unit,
            labels,
            value: p.sum,
            ts,
          });
        }
      }
      return 0;
    }
    case "summary": {
      for (const p of data.points) {
        const labels = buildLabels({ resourceLabels, attributes: p.attributes });
        const ts = tsFromNanos(p.timeUnixNano, now);
        // Summary has no temporality; it is always cumulative.
        datapoints.push({
          name: `${name}_count`,
          type: "counter",
          counterKind: "cumulative",
          unit,
          labels,
          value: p.count,
          ts,
        }, {
          name: `${name}_sum`,
          type: "counter",
          counterKind: "cumulative",
          unit,
          labels,
          value: p.sum,
          ts,
        });
      }
      return 0;
    }
  }
}

/** How many datapoints a metric carries (for the rejected count of unsupported metrics). */
function countDatapoints(metric: OtlpMetric): number {
  if (!metric.data) return 0;
  return metric.data.points.length;
}
