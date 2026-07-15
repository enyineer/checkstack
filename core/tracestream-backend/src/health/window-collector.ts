/**
 * `trace-window` collector: the primary way to assert on a trace stream. It
 * reads pre-aggregated span (op-bucket minute tier) + trace (summary index)
 * counts over a complete-minute window and exposes them as numeric, assertable,
 * chart-annotated metrics. Mirrors logstream's window-metrics collector.
 *
 * Collector rule: a read FAILURE (our own storage unreachable) throws and is
 * mapped by the executor to a transport failure. A zero count, a silent stream,
 * or a huge error count are METRICS - assertions (and the anomaly engine) decide
 * health, never the collector.
 */

import {
  Versioned,
  z,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  mergeAverage,
  mergeMinMax,
  configNumber,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  type CollectorRunContext,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultSchema,
  computeWindowBounds,
  MIN_WINDOW_SECONDS,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "@checkstack/tracestream-common";
import type { TraceStreamHealthClient } from "./strategy";
import { buildTraceWindowMetrics, type TraceWindowResult } from "./window";

export const TRACE_WINDOW_COLLECTOR_ID = "trace-window";

// ============================================================================
// CONFIG
// ============================================================================

const traceWindowConfigSchema = z.object({
  windowSeconds: configNumber({})
    .int()
    .min(MIN_WINDOW_SECONDS)
    .optional()
    .describe(
      "Window to evaluate, in seconds (floored to whole minutes; min 60). Defaults to the check interval.",
    ),
});

export type TraceWindowConfig = z.infer<typeof traceWindowConfigSchema>;

// ============================================================================
// RESULT
// ============================================================================

// error counts enable anomaly detection with `lower-is-better`: fewer is better,
// so an UPWARD spike is the anomaly. Volume-dependent counts (span/trace totals)
// stay chart-only to avoid alerting on traffic swings.
const traceWindowResultSchema = healthResultSchema({
  spanCount: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Spans",
    "x-chart-priority": 40,
    "x-anomaly-enabled": false,
  }).describe(
    "Service-labeled spans over the window (the operation-metric population).",
  ),
  traceCount: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Traces",
    "x-chart-priority": 45,
    "x-anomaly-enabled": false,
  }).describe("Traces whose start fell within the evaluation window."),
  errorSpanCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Error spans",
    "x-chart-priority": 10,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 3,
  }).describe("Error spans over the window (0 when none)."),
  errorTraceCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Error traces",
    "x-chart-priority": 12,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 1,
  }).describe("Traces with any error span over the window (0 when none)."),
  errorRatePerMinute: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Error rate",
    "x-chart-unit": "/min",
    "x-chart-priority": 15,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 1,
  }).describe(
    "Error spans per minute, averaged over the whole-minute window.",
  ),
  secondsSinceLastSpan: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Seconds since last span",
    "x-chart-unit": "s",
    "x-chart-priority": 30,
    // Absence is asserted directly (e.g. `secondsSinceLastSpan < 600`), not
    // learned as an anomaly - the value grows unboundedly during silence.
    "x-anomaly-enabled": false,
  }).describe(
    "Whole seconds since the stream last received any span; counts from stream " +
      "creation when the stream has never received a span (not a sentinel), so " +
      "an absence assertion like `secondsSinceLastSpan < 600` is meaningful from creation.",
  ),
});

export type TraceWindowResultShape = z.infer<typeof traceWindowResultSchema>;

// ============================================================================
// AGGREGATION
// ============================================================================

// Each run reads an independent window sample, so bucket aggregation AVERAGES
// the samples (never sums - a raw sum would scale with how many evaluation runs
// land in the bucket). Freshness folds as a min/max range.
const traceWindowAggregatedFields = {
  avgSpanCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg spans",
    "x-chart-priority": 40,
    "x-anomaly-enabled": false,
  }),
  avgTraceCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg traces",
    "x-chart-priority": 45,
    "x-anomaly-enabled": false,
  }),
  avgErrorSpanCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg error spans",
    "x-chart-priority": 10,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 3,
  }),
  avgErrorTraceCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg error traces",
    "x-chart-priority": 12,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 1,
  }),
  avgErrorRatePerMinute: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg error rate",
    "x-chart-unit": "/min",
    "x-chart-priority": 15,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 1,
  }),
  secondsSinceLastSpan: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Seconds since last span",
    "x-chart-unit": "s",
    "x-chart-priority": 30,
    "x-anomaly-enabled": false,
  }),
};

export type TraceWindowAggregatedResult = InferAggregatedResult<
  typeof traceWindowAggregatedFields
>;

/** Resolve the effective window seconds (config override or check interval). */
function resolveWindowSeconds({
  config,
  runContext,
}: {
  config: TraceWindowConfig;
  runContext?: CollectorRunContext;
}): { windowSeconds: number | undefined; intervalSeconds: number } {
  const intervalSeconds =
    runContext?.check.intervalSeconds ?? MIN_WINDOW_SECONDS;
  return { windowSeconds: config.windowSeconds, intervalSeconds };
}

// ============================================================================
// COLLECTOR
// ============================================================================

export class TraceWindowCollector
  implements
    CollectorStrategy<
      TraceStreamHealthClient,
      TraceWindowConfig,
      TraceWindowResultShape,
      TraceWindowAggregatedResult
    >
{
  id = TRACE_WINDOW_COLLECTOR_ID;
  displayName = "Window Metrics";
  description =
    "Windowed trace span + error metrics for a stream (assertable)";

  supportedPlugins = [pluginMetadata];

  config = new Versioned({ version: 1, schema: traceWindowConfigSchema });
  result = new Versioned({ version: 1, schema: traceWindowResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: traceWindowAggregatedFields,
  });

  /** Injectable clock so the complete-minute window is deterministic in tests. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  async execute({
    config,
    client,
    runContext,
  }: {
    config: TraceWindowConfig;
    client: TraceStreamHealthClient;
    pluginId: string;
    runContext?: CollectorRunContext;
  }): Promise<CollectorResult<TraceWindowResultShape>> {
    const now = this.now();
    const { windowSeconds, intervalSeconds } = resolveWindowSeconds({
      config,
      runContext,
    });
    const { from, readTo, windowMinutes } = computeWindowBounds({
      now,
      windowSeconds,
      intervalSeconds,
    });

    const { reader } = client;
    // Count reads span `[from, readTo)` - the complete-minute window PLUS the
    // in-progress minute - so a burst seconds into the current minute is
    // reflected immediately (see WindowBounds). Any REJECTION propagates as a
    // transport failure (storage could not answer); zero rows are a metric.
    const [spanTotals, traceTotals, lastReceivedAt] = await Promise.all([
      reader.readWindowSpanTotals({ from, to: readTo }),
      reader.readWindowTraceTotals({ since: from }),
      reader.readLastReceivedAt(),
    ]);

    const result: TraceWindowResult = buildTraceWindowMetrics({
      spanTotals,
      traceTotals,
      now,
      lastReceivedAt,
      streamCreatedAt: reader.streamCreatedAt,
      windowMinutes,
    });

    return { result };
  }

  mergeResult(
    existing: TraceWindowAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<TraceWindowResultShape>,
  ): TraceWindowAggregatedResult {
    const m = newRun.metadata;
    return {
      avgSpanCount: mergeAverage(existing?.avgSpanCount, m?.spanCount),
      avgTraceCount: mergeAverage(existing?.avgTraceCount, m?.traceCount),
      avgErrorSpanCount: mergeAverage(
        existing?.avgErrorSpanCount,
        m?.errorSpanCount,
      ),
      avgErrorTraceCount: mergeAverage(
        existing?.avgErrorTraceCount,
        m?.errorTraceCount,
      ),
      avgErrorRatePerMinute: mergeAverage(
        existing?.avgErrorRatePerMinute,
        m?.errorRatePerMinute,
      ),
      secondsSinceLastSpan: mergeMinMax(
        existing?.secondsSinceLastSpan,
        m?.secondsSinceLastSpan,
      ),
    };
  }
}
