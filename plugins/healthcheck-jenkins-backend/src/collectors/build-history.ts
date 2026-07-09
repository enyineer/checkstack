import {
  Versioned,
  z,
  configString,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  VersionedAggregated,
  aggregatedAverage,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import { healthResultNumber } from "@checkstack/healthcheck-common";
import { pluginMetadata } from "../plugin-metadata";
import type { JenkinsTransportClient } from "../transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const buildHistoryConfigSchema = z.object({
  // Templatable: supports `{{ environment.jobName }}` so one config covers N
  // environments. Presence is enforced POST-RENDER in `execute` (an empty
  // render must not silently probe an empty job path and look healthy).
  jobName: configString({ "x-templatable": true })
    .min(1)
    .describe(
      "Full job path (e.g., 'folder/job-name' or 'my-job'). Supports templating, e.g. {{ environment.jobName }}",
    ),
  buildCount: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Number of recent builds to analyze"),
});

export type BuildHistoryConfig = z.infer<typeof buildHistoryConfigSchema>;

/**
 * Post-render validator for the required `jobName`. The stored value is a
 * templatable string, so `.min(1)` cannot meaningfully run at store time against
 * a template; the executor renders `{{ environment.* }}` per environment, then
 * this rejects a render that collapsed to empty/whitespace. An empty job path is
 * a config error - transport-failure semantics - not a "healthy" empty probe.
 */
const renderedRequiredSchema = z.string().trim().min(1);

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const buildHistoryResultSchema = z.object({
  // Window-relative count: changes run-to-run with the sampled build window
  // and has no stable baseline. Off by default to avoid alert fatigue;
  // success rate carries the real signal.
  totalBuilds: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Total Builds",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
  }),
  // Raw outcome counts drift with the window composition rather than tracking
  // a real problem. The percentage form (successRate) is the stable signal.
  successCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Successful",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
  }),
  failureCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Failed",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
  }),
  unstableCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Unstable",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
  }),
  abortedCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Aborted",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
  }),
  // Percentage form of build outcomes: stable, bounded, maps directly to a
  // real problem. Kept enabled with a confirmation window and an absolute
  // floor so small jitter near a noisy baseline does not alert.
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 10,
    "x-chart-priority": 10,
  }),
  avgDurationMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Duration",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 20,
  }),
  // Best/worst case durations swing widely with build content and offer no
  // stable baseline. Average duration carries the latency signal.
  minDurationMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Min Duration",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": false,
    "x-chart-priority": 30,
    "x-chart-good-direction": "down",
  }),
  maxDurationMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max Duration",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": false,
    "x-chart-priority": 40,
    "x-chart-good-direction": "down",
  }),
  lastSuccessBuildNumber: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Last Success #",
    "x-anomaly-enabled": false,
  }).optional(),
  lastFailureBuildNumber: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Last Failure #",
    "x-anomaly-enabled": false,
  }).optional(),
});

export type BuildHistoryResult = z.infer<typeof buildHistoryResultSchema>;

// Aggregated result fields definition
const buildHistoryAggregatedFields = {
  avgSuccessRate: aggregatedAverage({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Success Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 10,
    "x-chart-priority": 10,
  }),
  avgBuildDuration: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Build Duration",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 20,
  }),
};

// Type inferred from field definitions
export type BuildHistoryAggregatedResult = InferAggregatedResult<
  typeof buildHistoryAggregatedFields
>;

// ============================================================================
// BUILD HISTORY COLLECTOR
// ============================================================================

/**
 * Collector for Jenkins build history.
 * Analyzes recent builds for trends and patterns.
 */
export class BuildHistoryCollector implements CollectorStrategy<
  JenkinsTransportClient,
  BuildHistoryConfig,
  BuildHistoryResult,
  BuildHistoryAggregatedResult
> {
  id = "build-history";
  displayName = "Build History";
  description = "Analyze recent build trends for a Jenkins job";

  supportedPlugins = [pluginMetadata];
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: buildHistoryConfigSchema });
  result = new Versioned({ version: 1, schema: buildHistoryResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: buildHistoryAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: BuildHistoryConfig;
    client: JenkinsTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<BuildHistoryResult>> {
    // Post-render guard: reject a template that rendered to empty before probing
    // an empty job path (which would otherwise return a misleading result).
    const jobName = renderedRequiredSchema.safeParse(config.jobName);
    if (!jobName.success) {
      return {
        result: {
          totalBuilds: 0,
          successCount: 0,
          failureCount: 0,
          unstableCount: 0,
          abortedCount: 0,
          successRate: 0,
          avgDurationMs: 0,
          minDurationMs: 0,
          maxDurationMs: 0,
        },
        error:
          `Rendered jobName is empty: ${JSON.stringify(config.jobName)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      };
    }

    // Encode job path for URL (handle folders)
    const jobPath = jobName.data
      .split("/")
      .map((part) => `job/${encodeURIComponent(part)}`)
      .join("/");

    const response = await client.exec({
      path: `/${jobPath}/api/json`,
      query: {
        tree: `builds[number,result,duration,timestamp]{0,${config.buildCount}}`,
      },
    });

    if (response.error) {
      return {
        result: {
          totalBuilds: 0,
          successCount: 0,
          failureCount: 0,
          unstableCount: 0,
          abortedCount: 0,
          successRate: 0,
          avgDurationMs: 0,
          minDurationMs: 0,
          maxDurationMs: 0,
        },
        error: response.error,
      };
    }

    const data = response.data as {
      builds?: Array<{
        number?: number;
        result?: string;
        duration?: number;
        timestamp?: number;
      }>;
    };

    const builds = data.builds || [];

    // Count results
    let successCount = 0;
    let failureCount = 0;
    let unstableCount = 0;
    let abortedCount = 0;
    let lastSuccessBuildNumber: number | undefined;
    let lastFailureBuildNumber: number | undefined;

    const durations: number[] = [];

    for (const build of builds) {
      if (build.duration !== undefined) {
        durations.push(build.duration);
      }

      switch (build.result) {
        case "SUCCESS": {
          successCount++;
          if (lastSuccessBuildNumber === undefined) {
            lastSuccessBuildNumber = build.number;
          }
          break;
        }
        case "FAILURE": {
          failureCount++;
          if (lastFailureBuildNumber === undefined) {
            lastFailureBuildNumber = build.number;
          }
          break;
        }
        case "UNSTABLE": {
          unstableCount++;
          break;
        }
        case "ABORTED": {
          abortedCount++;
          break;
        }
      }
    }

    const totalBuilds = builds.length;
    const successRate =
      totalBuilds > 0 ? Math.round((successCount / totalBuilds) * 100) : 0;

    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    const minDurationMs = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDurationMs = durations.length > 0 ? Math.max(...durations) : 0;

    return {
      result: {
        totalBuilds,
        successCount,
        failureCount,
        unstableCount,
        abortedCount,
        successRate,
        avgDurationMs,
        minDurationMs,
        maxDurationMs,
        lastSuccessBuildNumber,
        lastFailureBuildNumber,
      },
    };
  }

  mergeResult(
    existing: BuildHistoryAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<BuildHistoryResult>,
  ): BuildHistoryAggregatedResult {
    const metadata = run.metadata;

    return {
      avgSuccessRate: mergeAverage(
        existing?.avgSuccessRate,
        metadata?.successRate,
      ),
      avgBuildDuration: mergeAverage(
        existing?.avgBuildDuration,
        metadata?.avgDurationMs,
      ),
    };
  }
}
