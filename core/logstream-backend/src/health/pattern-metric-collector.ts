/**
 * `pattern-metric` collector: assert on the numeric `<*>` wildcard values of a
 * single Drain pattern - e.g. a template `response time <*>ms` whose variable at
 * position 0 is the latency, asserted as `maxValue < 50`. It reads the
 * pre-aggregated pattern-variable buckets (count/sum/min/max per minute) over
 * the same complete-minute window as `window-metrics`.
 *
 * Collector rule: a read failure throws (transport failure). A window with no
 * numeric samples is a METRIC, not an error: `sampleCount` reports 0 and the
 * value fields report 0 (healthcheck fields must be numbers, never null) - so
 * assert on `sampleCount > 0` alongside a value threshold to tell "no data"
 * apart from a genuine zero reading.
 */

import {
  Versioned,
  z,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  mergeAverage,
  mergeMinMax,
  configString,
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
} from "@checkstack/healthcheck-common";
import {
  pluginMetadata,
  LOGSTREAM_PATTERN_OPTIONS_RESOLVER,
  LOGSTREAM_VARIABLE_OPTIONS_RESOLVER,
} from "@checkstack/logstream-common";
import type { LogStreamHealthClient } from "./strategy";
import {
  computeWindowBounds,
  buildPatternMetric,
  MIN_WINDOW_SECONDS,
  type PatternMetricResult,
} from "./window";

export const PATTERN_METRIC_COLLECTOR_ID = "pattern-metric";

// ============================================================================
// CONFIG
// ============================================================================

const patternMetricConfigSchema = z.object({
  patternId: configString({
    "x-options-resolver": LOGSTREAM_PATTERN_OPTIONS_RESOLVER,
  })
    .min(1)
    .describe(
      "The log pattern (Drain template) whose numeric variable to evaluate. " +
        "Select the log stream under General first - this list offers the " +
        "patterns discovered on that stream.",
    ),
  variableIndex: configNumber({
    "x-options-resolver": LOGSTREAM_VARIABLE_OPTIONS_RESOLVER,
    // The variable picker resolves against the pattern chosen in the SAME
    // form; without this the options fetch runs once at mount (patternId
    // still empty) and never again, leaving the picker permanently empty.
    "x-depends-on": ["patternId"],
  })
    .int()
    .min(0)
    .describe(
      "Which `<*>` wildcard position of the pattern to aggregate (0-based, " +
        "left to right). The picker lists each position with a few recent " +
        "sample values and whether they look numeric - only numeric samples " +
        "are aggregated.",
    ),
  windowSeconds: configNumber({})
    .int()
    .min(MIN_WINDOW_SECONDS)
    .optional()
    .describe(
      "Window to evaluate, in seconds (floored to whole minutes; min 60). Defaults to the check interval.",
    ),
});

export type PatternMetricConfig = z.infer<typeof patternMetricConfigSchema>;

// ============================================================================
// RESULT
// ============================================================================

// The value's UNIT is unknown to the platform - it is whatever the logged
// number means (ms, bytes, a count) - so these fields carry no anomaly
// detection (an anomaly direction cannot be assumed) and no unit annotation.
// Users assert against a threshold they know for the field.
const patternMetricResultSchema = healthResultSchema({
  avgValue: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Average value",
    "x-chart-priority": 10,
    "x-anomaly-enabled": false,
  }).describe(
    "Mean of the pattern's numeric variable over the window. Unit is " +
      "domain-specific (whatever the logged number means). 0 when the window " +
      "had no numeric samples - assert on `sampleCount > 0` alongside.",
  ),
  minValue: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Minimum value",
    "x-chart-priority": 20,
    "x-anomaly-enabled": false,
  }).describe(
    "Smallest numeric value over the window. 0 when there were no samples.",
  ),
  maxValue: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Maximum value",
    "x-chart-priority": 15,
    "x-anomaly-enabled": false,
  }).describe(
    "Largest numeric value over the window. 0 when there were no samples.",
  ),
  sampleCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Sample count",
    "x-chart-priority": 30,
    "x-anomaly-enabled": false,
  }).describe(
    "How many numeric samples the window covered. 0 means the pattern matched " +
      "no line with a numeric value at this position - the value fields then " +
      "report 0, so guard value assertions with `sampleCount > 0`.",
  ),
});

export type PatternMetricResultShape = z.infer<
  typeof patternMetricResultSchema
>;

// ============================================================================
// AGGREGATION
// ============================================================================

// Each run reads an independent window sample, so the average folds by
// averaging and the extrema fold as a min/max range (never a sum, which would
// scale with how many evaluation runs land in the bucket).
const patternMetricAggregatedFields = {
  avgValue: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg value",
    "x-chart-priority": 10,
    "x-anomaly-enabled": false,
  }),
  minValue: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Value range (min)",
    "x-chart-priority": 20,
    "x-anomaly-enabled": false,
  }),
  maxValue: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Value range (max)",
    "x-chart-priority": 15,
    "x-anomaly-enabled": false,
  }),
  avgSampleCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg sample count",
    "x-chart-priority": 30,
    "x-anomaly-enabled": false,
  }),
};

export type PatternMetricAggregatedResult = InferAggregatedResult<
  typeof patternMetricAggregatedFields
>;

// ============================================================================
// COLLECTOR
// ============================================================================

export class PatternMetricCollector
  implements
    CollectorStrategy<
      LogStreamHealthClient,
      PatternMetricConfig,
      PatternMetricResultShape,
      PatternMetricAggregatedResult
    >
{
  id = PATTERN_METRIC_COLLECTOR_ID;
  displayName = "Pattern Metric";
  description =
    "Aggregate one log pattern's numeric `<*>` value over a window (assertable)";

  supportedPlugins = [pluginMetadata];
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: patternMetricConfigSchema });
  result = new Versioned({ version: 1, schema: patternMetricResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: patternMetricAggregatedFields,
  });

  constructor(private readonly now: () => Date = () => new Date()) {}

  async execute({
    config,
    client,
    runContext,
  }: {
    config: PatternMetricConfig;
    client: LogStreamHealthClient;
    pluginId: string;
    runContext?: CollectorRunContext;
  }): Promise<CollectorResult<PatternMetricResultShape>> {
    const now = this.now();
    const intervalSeconds =
      runContext?.check.intervalSeconds ?? MIN_WINDOW_SECONDS;
    const { from, readTo } = computeWindowBounds({
      now,
      windowSeconds: config.windowSeconds,
      intervalSeconds,
    });

    const { reader } = client;
    // Include the in-progress minute (`readTo`), like the sibling collectors,
    // so a fresh burst counts immediately. Any REJECTION propagates as a
    // transport failure (the DB could not answer); an empty window is a metric.
    const window = await reader.readPatternVariableWindow({
      patternId: config.patternId,
      varIndex: config.variableIndex,
      from,
      to: readTo,
    });

    const result: PatternMetricResult = buildPatternMetric({ window });
    return { result };
  }

  mergeResult(
    existing: PatternMetricAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<PatternMetricResultShape>,
  ): PatternMetricAggregatedResult {
    const m = newRun.metadata;
    return {
      avgValue: mergeAverage(existing?.avgValue, m?.avgValue),
      minValue: mergeMinMax(existing?.minValue, m?.minValue),
      maxValue: mergeMinMax(existing?.maxValue, m?.maxValue),
      avgSampleCount: mergeAverage(existing?.avgSampleCount, m?.sampleCount),
    };
  }
}
