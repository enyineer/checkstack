/**
 * `window-metrics` collector: the primary way to assert on a log stream. It
 * reads pre-aggregated severity + pattern counts over a complete-minute window
 * and exposes them as numeric, assertable, chart-annotated metrics.
 *
 * Collector rule: a read FAILURE (our own DB unreachable) throws and is mapped
 * by the executor to a transport failure. A zero count, a silent stream, or a
 * huge error count are METRICS - assertions (and the anomaly engine) decide
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
import { pluginMetadata } from "@checkstack/logstream-common";
import type { LogStreamHealthClient } from "./strategy";
import { buildWindowMetrics, type WindowMetricsResult } from "./window";

export const WINDOW_METRICS_COLLECTOR_ID = "window-metrics";

// ============================================================================
// CONFIG
// ============================================================================

const windowMetricsConfigSchema = z.object({
  windowSeconds: configNumber({})
    .int()
    .min(MIN_WINDOW_SECONDS)
    .optional()
    .describe(
      "Window to evaluate, in seconds (floored to whole minutes; min 60). Defaults to the check interval.",
    ),
});

export type WindowMetricsConfig = z.infer<typeof windowMetricsConfigSchema>;

// ============================================================================
// RESULT
// ============================================================================

// error/fatal counts enable anomaly detection with `lower-is-better`: fewer is
// better, so an UPWARD spike is the anomaly the plan calls for ("direction up
// for error/fatal"). Volume-dependent counts (total/info/debug/patterns) stay
// chart-only to avoid alerting on traffic swings.
const windowMetricsResultSchema = healthResultSchema({
  totalCount: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Total lines",
    "x-chart-priority": 40,
    "x-anomaly-enabled": false,
  }).describe("Total log lines received over the evaluation window."),
  fatalCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Fatal lines",
    "x-chart-priority": 5,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 1,
  }).describe("Fatal-band lines over the window (0 when none)."),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Error lines",
    "x-chart-priority": 10,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 3,
  }).describe("Error-band lines over the window (0 when none)."),
  warnCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Warning lines",
    "x-chart-priority": 20,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }).describe("Warning-band lines over the window (0 when none)."),
  infoCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Info lines",
    "x-chart-priority": 60,
    "x-anomaly-enabled": false,
  }).describe("Info-band lines over the window (0 when none)."),
  debugCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Debug lines",
    "x-chart-priority": 70,
    "x-anomaly-enabled": false,
  }).describe("Debug-band lines over the window (0 when none)."),
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
    "(error + fatal) lines per minute, averaged over the whole-minute window.",
  ),
  secondsSinceLastLog: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Seconds since last log",
    "x-chart-unit": "s",
    "x-chart-priority": 30,
    // Absence is asserted directly (e.g. `secondsSinceLastLog < 600`), not
    // learned as an anomaly - the value grows unboundedly during silence.
    "x-anomaly-enabled": false,
  }).describe(
    "Whole seconds since the stream last received any line; counts from stream " +
      "creation when the stream has never received a line (not a sentinel), so " +
      "an absence assertion like `secondsSinceLastLog < 600` is meaningful from creation.",
  ),
  newPatternCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "New patterns",
    "x-chart-priority": 50,
    "x-anomaly-enabled": false,
  }).describe(
    "Distinct log patterns first observed within the window (0 when none).",
  ),
  distinctPatternCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Distinct patterns",
    "x-chart-priority": 55,
    "x-anomaly-enabled": false,
  }).describe(
    "Distinct log patterns with any occurrence in the window (0 when none).",
  ),
});

export type WindowMetricsResultShape = z.infer<
  typeof windowMetricsResultSchema
>;

// ============================================================================
// AGGREGATION
// ============================================================================

// Each run reads an independent window sample, so bucket aggregation AVERAGES
// the samples (never sums - a raw sum would scale with how many evaluation
// runs land in the bucket). Freshness folds as a min/max range.
const windowMetricsAggregatedFields = {
  avgTotalCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg total lines",
    "x-chart-priority": 40,
    "x-anomaly-enabled": false,
  }),
  avgErrorCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg error lines",
    "x-chart-priority": 10,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 3,
  }),
  avgFatalCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg fatal lines",
    "x-chart-priority": 5,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 1,
  }),
  avgWarnCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg warning lines",
    "x-chart-priority": 20,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
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
  secondsSinceLastLog: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Seconds since last log",
    "x-chart-unit": "s",
    "x-chart-priority": 30,
    "x-anomaly-enabled": false,
  }),
};

export type WindowMetricsAggregatedResult = InferAggregatedResult<
  typeof windowMetricsAggregatedFields
>;

/** Resolve the effective window seconds (config override or check interval). */
function resolveWindowSeconds({
  config,
  runContext,
}: {
  config: WindowMetricsConfig;
  runContext?: CollectorRunContext;
}): { windowSeconds: number | undefined; intervalSeconds: number } {
  const intervalSeconds = runContext?.check.intervalSeconds ?? MIN_WINDOW_SECONDS;
  return { windowSeconds: config.windowSeconds, intervalSeconds };
}

// ============================================================================
// COLLECTOR
// ============================================================================

export class WindowMetricsCollector
  implements
    CollectorStrategy<
      LogStreamHealthClient,
      WindowMetricsConfig,
      WindowMetricsResultShape,
      WindowMetricsAggregatedResult
    >
{
  id = WINDOW_METRICS_COLLECTOR_ID;
  displayName = "Window Metrics";
  description =
    "Windowed log severity + pattern metrics for a stream (assertable)";

  supportedPlugins = [pluginMetadata];

  config = new Versioned({ version: 1, schema: windowMetricsConfigSchema });
  result = new Versioned({ version: 1, schema: windowMetricsResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: windowMetricsAggregatedFields,
  });

  /**
   * Injectable clock so the complete-minute window is deterministic in tests.
   */
  constructor(private readonly now: () => Date = () => new Date()) {}

  async execute({
    config,
    client,
    runContext,
  }: {
    config: WindowMetricsConfig;
    client: LogStreamHealthClient;
    pluginId: string;
    runContext?: CollectorRunContext;
  }): Promise<CollectorResult<WindowMetricsResultShape>> {
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
    // transport failure (the DB could not answer); zero rows are a metric, never
    // an error.
    const [severity, newPatternCount, distinctPatternCount, lastReceivedAt] =
      await Promise.all([
        reader.readSeverityTotals({ from, to: readTo }),
        reader.readNewPatternCount({ from, to: readTo }),
        reader.readDistinctPatternCount({ from, to: readTo }),
        reader.readLastReceivedAt(),
      ]);

    const result: WindowMetricsResult = buildWindowMetrics({
      severity,
      newPatternCount,
      distinctPatternCount,
      now,
      lastReceivedAt,
      streamCreatedAt: reader.streamCreatedAt,
      windowMinutes,
    });

    return { result };
  }

  mergeResult(
    existing: WindowMetricsAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<WindowMetricsResultShape>,
  ): WindowMetricsAggregatedResult {
    const m = newRun.metadata;
    return {
      avgTotalCount: mergeAverage(existing?.avgTotalCount, m?.totalCount),
      avgErrorCount: mergeAverage(existing?.avgErrorCount, m?.errorCount),
      avgFatalCount: mergeAverage(existing?.avgFatalCount, m?.fatalCount),
      avgWarnCount: mergeAverage(existing?.avgWarnCount, m?.warnCount),
      avgErrorRatePerMinute: mergeAverage(
        existing?.avgErrorRatePerMinute,
        m?.errorRatePerMinute,
      ),
      secondsSinceLastLog: mergeMinMax(
        existing?.secondsSinceLastLog,
        m?.secondsSinceLastLog,
      ),
    };
  }
}
