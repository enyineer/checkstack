import {
  Versioned,
  z,
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
  jobName: z
    .string()
    .min(1)
    .describe("Full job path (e.g., 'folder/job-name' or 'my-job')"),
  buildCount: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Number of recent builds to analyze"),
});

export type BuildHistoryConfig = z.infer<typeof buildHistoryConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const buildHistoryResultSchema = z.object({
  totalBuilds: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Total Builds",
  }),
  successCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Successful",
  }),
  failureCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Failed",
  }),
  unstableCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Unstable",
  }),
  abortedCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Aborted",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  avgDurationMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Duration",
    "x-chart-unit": "ms",
  }),
  minDurationMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Min Duration",
    "x-chart-unit": "ms",
  }),
  maxDurationMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max Duration",
    "x-chart-unit": "ms",
  }),
  lastSuccessBuildNumber: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Last Success #",
  }).optional(),
  lastFailureBuildNumber: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Last Failure #",
  }).optional(),
});

export type BuildHistoryResult = z.infer<typeof buildHistoryResultSchema>;

// Aggregated result fields definition
const buildHistoryAggregatedFields = {
  avgSuccessRate: aggregatedAverage({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Success Rate",
    "x-chart-unit": "%",
  }),
  avgBuildDuration: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Build Duration",
    "x-chart-unit": "ms",
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
    // Encode job path for URL (handle folders)
    const jobPath = config.jobName
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
