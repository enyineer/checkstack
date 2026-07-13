/**
 * `metric-window` collector: the way to assert on a metric stream. It resolves
 * the series matching a `(metricName, labelFilters)` selection, reads their
 * pre-aggregated minute buckets over a complete-minute window, and exposes the
 * folded values as numeric, assertable, chart-annotated metrics.
 *
 * Collector rule: a read FAILURE (our own DB unreachable) throws and is mapped
 * by the executor to a transport failure. A zero count, a stale metric, or a
 * huge value are METRICS - assertions decide health, never the collector.
 *
 * Anomaly detection is DISABLED on every field: a metric stream carries
 * arbitrary user domains (bytes, ms, request counts, temperatures, ...), so no
 * single good-direction can be assumed. Users assert against thresholds they
 * know for their metric; the platform anomaly engine is not given a direction
 * it cannot infer.
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
  MAX_LABEL_FILTERS,
  MAX_LABEL_CHARS,
  MAX_METRIC_NAME_CHARS,
  METRICSTREAM_METRIC_NAME_OPTIONS_RESOLVER,
  METRICSTREAM_LABEL_KEY_OPTIONS_RESOLVER,
  METRICSTREAM_LABEL_VALUE_OPTIONS_RESOLVER,
  type MetricWindowCollectorConfig,
} from "@checkstack/metricstream-common";
import type { MetricStreamHealthClient } from "./strategy";
import {
  computeWindowBounds,
  buildMetricWindowResult,
  MIN_WINDOW_SECONDS,
} from "./window";
import { METRIC_WINDOW_COLLECTOR_ID } from "./constants";

// ============================================================================
// CONFIG (annotated equivalent of the frozen MetricWindowCollectorConfigSchema)
// ============================================================================

/**
 * A single exact-match label filter row. The item's `key` field offers the
 * DISTINCT label keys of the chosen `metricName`; its `value` field offers the
 * DISTINCT values for that `(metricName, key)` pair - the value resolver reads
 * BOTH `metricName` (top-level) and its own row's `key` via the DynamicForm
 * row-scoped-formValues capability (UI investigation outcome (b)).
 */
const labelFilterConfigSchema = z.object({
  key: configString({
    "x-options-resolver": METRICSTREAM_LABEL_KEY_OPTIONS_RESOLVER,
    "x-depends-on": ["metricName"],
  })
    .min(1)
    .max(MAX_LABEL_CHARS)
    .describe("Label key to match exactly."),
  value: configString({
    "x-options-resolver": METRICSTREAM_LABEL_VALUE_OPTIONS_RESOLVER,
    "x-depends-on": ["metricName", "key"],
  })
    .max(MAX_LABEL_CHARS)
    .describe("Label value the key must equal."),
});

const metricWindowConfigSchema = z.object({
  metricName: configString({
    "x-options-resolver": METRICSTREAM_METRIC_NAME_OPTIONS_RESOLVER,
    "x-searchable": true,
  })
    .min(1)
    .max(MAX_METRIC_NAME_CHARS)
    .describe(
      "The metric to evaluate. Select the metric stream under General first - " +
        "this searchable list offers the metric names seen on that stream.",
    ),
  labelFilters: z
    .array(labelFilterConfigSchema)
    .max(MAX_LABEL_FILTERS)
    .default([])
    .describe(
      "Exact-match label filters. A series matches when it carries EVERY " +
        "key=value pair; extra labels on the series are ignored. Leave empty to " +
        "aggregate across all series of the metric.",
    ),
  windowSeconds: configNumber({})
    .int()
    .min(MIN_WINDOW_SECONDS)
    .max(86_400)
    .optional()
    .describe(
      "Window to evaluate, in seconds (floored to whole minutes; min 60). Defaults to the check interval.",
    ),
});

/** The parsed collector config matches the FROZEN common shape by construction. */
type MetricWindowConfig = MetricWindowCollectorConfig;

// ============================================================================
// RESULT
// ============================================================================

const metricWindowResultSchema = healthResultSchema({
  lastValue: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Last value",
    "x-chart-priority": 10,
    "x-anomaly-enabled": false,
  }).describe(
    "The latest sample across matching series (by sample time) over the window. " +
      "0 when the selection had no samples - guard with `sampleCount > 0`.",
  ),
  avgValue: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Average value",
    "x-chart-priority": 20,
    "x-anomaly-enabled": false,
  }).describe(
    "Sample-weighted mean across matching series over the window. Unit is " +
      "domain-specific (whatever the metric measures). 0 when there were no samples.",
  ),
  minValue: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Minimum value",
    "x-chart-priority": 40,
    "x-anomaly-enabled": false,
  }).describe("Smallest sample across matching series over the window. 0 when none."),
  maxValue: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Maximum value",
    "x-chart-priority": 30,
    "x-anomaly-enabled": false,
  }).describe("Largest sample across matching series over the window. 0 when none."),
  sampleCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Sample count",
    "x-chart-priority": 60,
    "x-anomaly-enabled": false,
  }).describe(
    "How many samples the window covered across matching series. 0 means the " +
      "selection matched no data - the value fields then report 0, so guard value " +
      "assertions with `sampleCount > 0`.",
  ),
  seriesCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Series count",
    "x-chart-priority": 70,
    "x-anomaly-enabled": false,
  }).describe(
    "Distinct matching series that had data in the window (label cardinality of the selection).",
  ),
  ratePerSecond: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Rate",
    "x-chart-unit": "/s",
    "x-chart-priority": 15,
    "x-anomaly-enabled": false,
  }).describe(
    "Per-second increase of a COUNTER over the window (reset-aware; delta and " +
      "cumulative counters both supported). 0 for gauges - rate/increase are " +
      "counters-only.",
  ),
  increase: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Increase",
    "x-chart-priority": 25,
    "x-anomaly-enabled": false,
  }).describe(
    "Total increase of a COUNTER over the window (reset-aware). 0 for gauges.",
  ),
  secondsSinceLastSample: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Seconds since last sample",
    "x-chart-unit": "s",
    "x-chart-priority": 50,
    // Absence is asserted directly (e.g. `secondsSinceLastSample < 600`), not
    // learned as an anomaly - the value grows unboundedly during staleness.
    "x-anomaly-enabled": false,
  }).describe(
    "Whole seconds since the selection last received a sample; counts from stream " +
      "creation when the selection has never been seen (not a sentinel), so an " +
      "absence assertion like `secondsSinceLastSample < 600` is meaningful from creation.",
  ),
});

export type MetricWindowResultShape = z.infer<typeof metricWindowResultSchema>;

// ============================================================================
// AGGREGATION
// ============================================================================

// Each run reads an independent window sample, so bucket aggregation AVERAGES
// the samples (never sums - a raw sum would scale with how many evaluation runs
// land in the bucket). Extrema fold as a min/max range.
const metricWindowAggregatedFields = {
  avgLastValue: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg last value",
    "x-chart-priority": 10,
    "x-anomaly-enabled": false,
  }),
  avgValue: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg value",
    "x-chart-priority": 20,
    "x-anomaly-enabled": false,
  }),
  minValue: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Value range (min)",
    "x-chart-priority": 40,
    "x-anomaly-enabled": false,
  }),
  maxValue: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Value range (max)",
    "x-chart-priority": 30,
    "x-anomaly-enabled": false,
  }),
  avgRatePerSecond: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg rate",
    "x-chart-unit": "/s",
    "x-chart-priority": 15,
    "x-anomaly-enabled": false,
  }),
  avgSampleCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg sample count",
    "x-chart-priority": 60,
    "x-anomaly-enabled": false,
  }),
  secondsSinceLastSample: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Seconds since last sample",
    "x-chart-unit": "s",
    "x-chart-priority": 50,
    "x-anomaly-enabled": false,
  }),
};

export type MetricWindowAggregatedResult = InferAggregatedResult<
  typeof metricWindowAggregatedFields
>;

// ============================================================================
// COLLECTOR
// ============================================================================

export class MetricWindowCollector
  implements
    CollectorStrategy<
      MetricStreamHealthClient,
      MetricWindowConfig,
      MetricWindowResultShape,
      MetricWindowAggregatedResult
    >
{
  id = METRIC_WINDOW_COLLECTOR_ID;
  displayName = "Metric Window";
  description =
    "Windowed metric values for a stream selection, aggregated and assertable";

  supportedPlugins = [pluginMetadata];
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: metricWindowConfigSchema });
  result = new Versioned({ version: 1, schema: metricWindowResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: metricWindowAggregatedFields,
  });

  /** Injectable clock so the complete-minute window is deterministic in tests. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  async execute({
    config,
    client,
    runContext,
  }: {
    config: MetricWindowConfig;
    client: MetricStreamHealthClient;
    pluginId: string;
    runContext?: CollectorRunContext;
  }): Promise<CollectorResult<MetricWindowResultShape>> {
    const now = this.now();
    const intervalSeconds =
      runContext?.check.intervalSeconds ?? MIN_WINDOW_SECONDS;
    const { from, readTo, windowMinutes } = computeWindowBounds({
      now,
      windowSeconds: config.windowSeconds,
      intervalSeconds,
    });

    const { reader } = client;
    // Any REJECTION below propagates as a transport failure (the DB could not
    // answer); an empty selection / zero samples is a metric, never an error.
    const selection = await reader.resolveSelection({
      metricName: config.metricName,
      labelFilters: config.labelFilters,
    });

    if (selection.seriesIds.length === 0) {
      // Never-seen selection: zeroed values, staleness counted from stream age.
      const result = buildMetricWindowResult({
        aggregate: {
          sampleCount: 0,
          sum: 0,
          min: null,
          max: null,
          last: null,
          lastTs: null,
          deltaSum: 0,
          seriesCount: 0,
        },
        metricType: selection.metricType,
        counterKind: selection.counterKind,
        cumulativePoints: [],
        windowMinutes,
        now,
        lastSampleAt: null,
        streamCreatedAt: reader.streamCreatedAt,
      });
      return { result };
    }

    const needsCumulative =
      selection.metricType === "counter" && selection.counterKind !== "delta";

    const [aggregate, cumulativePoints] = await Promise.all([
      reader.readWindowAggregate({
        seriesIds: selection.seriesIds,
        from,
        to: readTo,
      }),
      needsCumulative
        ? reader.readCumulativePoints({
            seriesIds: selection.seriesIds,
            from,
            to: readTo,
          })
        : Promise.resolve([]),
    ]);

    const result = buildMetricWindowResult({
      aggregate,
      metricType: selection.metricType,
      counterKind: selection.counterKind,
      cumulativePoints,
      windowMinutes,
      now,
      lastSampleAt: selection.lastSampleAt,
      streamCreatedAt: reader.streamCreatedAt,
    });
    return { result };
  }

  mergeResult(
    existing: MetricWindowAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<MetricWindowResultShape>,
  ): MetricWindowAggregatedResult {
    const m = newRun.metadata;
    return {
      avgLastValue: mergeAverage(existing?.avgLastValue, m?.lastValue),
      avgValue: mergeAverage(existing?.avgValue, m?.avgValue),
      minValue: mergeMinMax(existing?.minValue, m?.minValue),
      maxValue: mergeMinMax(existing?.maxValue, m?.maxValue),
      avgRatePerSecond: mergeAverage(
        existing?.avgRatePerSecond,
        m?.ratePerSecond,
      ),
      avgSampleCount: mergeAverage(existing?.avgSampleCount, m?.sampleCount),
      secondsSinceLastSample: mergeMinMax(
        existing?.secondsSinceLastSample,
        m?.secondsSinceLastSample,
      ),
    };
  }
}
