/**
 * `operation-latency` collector: assert on ONE service/operation's latency +
 * error profile within a window - e.g. `p95Ms > 500` for a slow endpoint, or
 * `errorRate > 0.05` for a failing operation. `allowMultiple` so a check can
 * watch several operations.
 *
 * The p95 is the REAL percentile of the t-digest merged across every minute
 * bucket in the window (via `queryWindowLatency`), NOT an average of per-bucket
 * p95s (which is statistically wrong). Collector rule: a read failure throws
 * (transport failure); a zero-span window is a metric assertions decide on.
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
  computeWindowBounds,
  MIN_WINDOW_SECONDS,
} from "@checkstack/healthcheck-common";
import {
  pluginMetadata,
  TRACESTREAM_SERVICE_OPTIONS_RESOLVER,
  TRACESTREAM_OPERATION_OPTIONS_RESOLVER,
} from "@checkstack/tracestream-common";
import type { TraceStreamHealthClient } from "./strategy";
import { buildOperationLatency } from "./window";

export const OPERATION_LATENCY_COLLECTOR_ID = "operation-latency";

// ============================================================================
// CONFIG
// ============================================================================

const operationLatencyConfigSchema = z.object({
  serviceName: configString({
    "x-options-resolver": TRACESTREAM_SERVICE_OPTIONS_RESOLVER,
  })
    .min(1)
    .describe(
      "The service to evaluate. Select the trace stream under General first - " +
        "this list offers that stream's discovered services (empty until the " +
        "stream has received spans).",
    ),
  spanName: configString({
    "x-options-resolver": TRACESTREAM_OPERATION_OPTIONS_RESOLVER,
    // The operation picker reads `serviceName` from the SAME form; the editor
    // only re-fetches a picker's options when a field in `x-depends-on` changes.
    // Without this the fetch runs once at mount (serviceName still empty) and the
    // picker stays permanently at "No options available".
    "x-depends-on": ["serviceName"],
  })
    .optional()
    .describe(
      "Optional operation (span name) to narrow to. Leave empty to aggregate " +
        "every operation of the selected service.",
    ),
  windowSeconds: configNumber({})
    .int()
    .min(MIN_WINDOW_SECONDS)
    .optional()
    .describe(
      "Window to evaluate, in seconds (floored to whole minutes; min 60). Defaults to the check interval.",
    ),
});

export type OperationLatencyConfig = z.infer<
  typeof operationLatencyConfigSchema
>;

// ============================================================================
// RESULT
// ============================================================================

const operationLatencyResultSchema = healthResultSchema({
  p95Ms: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "p95 latency",
    "x-chart-unit": "ms",
    "x-chart-priority": 10,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 50,
  }).describe(
    "p95 latency over the window from the merged t-digest (0 when no spans matched).",
  ),
  avgMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg latency",
    "x-chart-unit": "ms",
    "x-chart-priority": 20,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 50,
  }).describe("Mean latency over the window (0 when no spans matched)."),
  maxMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max latency",
    "x-chart-unit": "ms",
    "x-chart-priority": 30,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }).describe("Slowest single span over the window (0 when no spans matched)."),
  spanCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Spans",
    "x-chart-priority": 40,
    "x-anomaly-enabled": false,
  }).describe(
    "Spans matched by the (service, operation?) selection over the window.",
  ),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Error spans",
    "x-chart-priority": 15,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 3,
  }).describe("Error spans among the matched spans (0 when none)."),
  errorRate: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Error rate",
    "x-chart-priority": 25,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 0.05,
  }).describe(
    "Fraction of matched spans that errored (0..1); 0 when the window is empty. " +
      "Pair with `spanCount > 0` so a quiet window is not read as a real zero.",
  ),
});

export type OperationLatencyResultShape = z.infer<
  typeof operationLatencyResultSchema
>;

// ============================================================================
// AGGREGATION
// ============================================================================

const operationLatencyAggregatedFields = {
  avgP95Ms: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg p95 latency",
    "x-chart-unit": "ms",
    "x-chart-priority": 10,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 50,
  }),
  avgMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg latency",
    "x-chart-unit": "ms",
    "x-chart-priority": 20,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }),
  maxMs: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max latency",
    "x-chart-unit": "ms",
    "x-chart-priority": 30,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }),
  avgErrorRate: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg error rate",
    "x-chart-priority": 25,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 0.05,
  }),
};

export type OperationLatencyAggregatedResult = InferAggregatedResult<
  typeof operationLatencyAggregatedFields
>;

// ============================================================================
// COLLECTOR
// ============================================================================

export class OperationLatencyCollector
  implements
    CollectorStrategy<
      TraceStreamHealthClient,
      OperationLatencyConfig,
      OperationLatencyResultShape,
      OperationLatencyAggregatedResult
    >
{
  id = OPERATION_LATENCY_COLLECTOR_ID;
  displayName = "Operation Latency";
  description =
    "Windowed p95/avg latency + error rate for one service/operation (assertable)";

  supportedPlugins = [pluginMetadata];
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: operationLatencyConfigSchema });
  result = new Versioned({ version: 1, schema: operationLatencyResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: operationLatencyAggregatedFields,
  });

  constructor(private readonly now: () => Date = () => new Date()) {}

  async execute({
    config,
    client,
    runContext,
  }: {
    config: OperationLatencyConfig;
    client: TraceStreamHealthClient;
    pluginId: string;
    runContext?: CollectorRunContext;
  }): Promise<CollectorResult<OperationLatencyResultShape>> {
    const now = this.now();
    const intervalSeconds =
      runContext?.check.intervalSeconds ?? MIN_WINDOW_SECONDS;
    const { from, readTo } = computeWindowBounds({
      now,
      windowSeconds: config.windowSeconds,
      intervalSeconds,
    });

    const { reader } = client;
    // Include the in-progress minute (`readTo`) so a latency burst seconds into
    // the current minute counts immediately (see WindowBounds). A REJECTION
    // propagates as a transport failure; an empty window is zeroed metrics.
    const window = await reader.readOperationLatency({
      serviceName: config.serviceName,
      spanName: config.spanName,
      from,
      to: readTo,
    });

    const result = buildOperationLatency({ window });
    return { result };
  }

  mergeResult(
    existing: OperationLatencyAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<OperationLatencyResultShape>,
  ): OperationLatencyAggregatedResult {
    const m = newRun.metadata;
    return {
      avgP95Ms: mergeAverage(existing?.avgP95Ms, m?.p95Ms),
      avgMs: mergeAverage(existing?.avgMs, m?.avgMs),
      maxMs: mergeMinMax(existing?.maxMs, m?.maxMs),
      avgErrorRate: mergeAverage(existing?.avgErrorRate, m?.errorRate),
    };
  }
}
