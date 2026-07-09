import {
  Versioned,
  z,
  configString,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeRate,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "../plugin-metadata";
import type { JenkinsTransportClient } from "../transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const jobStatusConfigSchema = z.object({
  // Templatable: supports `{{ environment.jobName }}` so one config covers N
  // environments. Presence is enforced POST-RENDER in `execute` (an empty
  // render must not silently probe an empty job path and look healthy).
  jobName: configString({ "x-templatable": true })
    .min(1)
    .describe(
      "Full job path (e.g., 'folder/job-name' or 'my-job'). Supports templating, e.g. {{ environment.jobName }}",
    ),
  checkLastBuild: z
    .boolean()
    .default(true)
    .describe("Check the last build status"),
});

export type JobStatusConfig = z.infer<typeof jobStatusConfigSchema>;

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

const jobStatusResultSchema = z.object({
  jobName: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Job Name",
    "x-anomaly-enabled": false,
  }),
  buildable: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Buildable",
    "x-chart-true-label": "buildable",
    "x-chart-false-label": "not buildable",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-priority": 20,
  }),
  lastBuildNumber: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Last Build #",
    "x-anomaly-enabled": false,
  }).optional(),
  lastBuildResult: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Last Build Result",
    "x-anomaly-enabled": false,
    "x-chart-priority": 10,
  }).optional(),
  lastBuildDurationMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Build Duration",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 30,
  }).optional(),
  lastBuildTimestamp: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Last Build Time",
    "x-anomaly-enabled": false,
  }).optional(),
  timeSinceLastBuildMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Time Since Last Build",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": false,
  }).optional(),
  // Momentary "is this job queued right now" flag. It flips between runs as
  // a normal part of scheduling and is not a problem signal, so dominance
  // over it produces noise. Off by default; queue saturation is covered by
  // the dedicated queue-info collector.
  inQueue: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "In Queue",
    "x-chart-true-label": "queued",
    "x-chart-false-label": "not queued",
    "x-anomaly-enabled": false,
  }),
  color: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Status Color",
    "x-anomaly-enabled": false,
  }),
});

export type JobStatusResult = z.infer<typeof jobStatusResultSchema>;

// Aggregated result fields definition
const jobStatusAggregatedFields = {
  avgBuildDurationMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Build Duration",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 30,
  }),
  successRate: aggregatedRate({
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
  buildableRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Enabled Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 10,
    "x-chart-priority": 20,
  }),
};

// Type inferred from field definitions
export type JobStatusAggregatedResult = InferAggregatedResult<
  typeof jobStatusAggregatedFields
>;

// ============================================================================
// JOB STATUS COLLECTOR
// ============================================================================

/**
 * Collector for Jenkins job status.
 * Monitors individual job health and last build information.
 */
export class JobStatusCollector implements CollectorStrategy<
  JenkinsTransportClient,
  JobStatusConfig,
  JobStatusResult,
  JobStatusAggregatedResult
> {
  id = "job-status";
  displayName = "Job Status";
  description = "Monitor Jenkins job status and last build information";

  supportedPlugins = [pluginMetadata];
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: jobStatusConfigSchema });
  result = new Versioned({ version: 1, schema: jobStatusResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: jobStatusAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: JobStatusConfig;
    client: JenkinsTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<JobStatusResult>> {
    // Post-render guard: reject a template that rendered to empty before probing
    // an empty job path (which would otherwise return a misleading result).
    const jobName = renderedRequiredSchema.safeParse(config.jobName);
    if (!jobName.success) {
      return {
        result: {
          jobName: config.jobName,
          buildable: false,
          inQueue: false,
          color: "notbuilt",
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
        tree: "name,buildable,color,inQueue,lastBuild[number,result,duration,timestamp]",
      },
    });

    if (response.error) {
      return {
        result: {
          jobName: config.jobName,
          buildable: false,
          inQueue: false,
          color: "notbuilt",
        },
        error: response.error,
      };
    }

    const data = response.data as {
      name?: string;
      buildable?: boolean;
      color?: string;
      inQueue?: boolean;
      lastBuild?: {
        number?: number;
        result?: string;
        duration?: number;
        timestamp?: number;
      };
    };

    const result: JobStatusResult = {
      jobName: data.name || config.jobName,
      buildable: data.buildable ?? true,
      color: data.color || "notbuilt",
      inQueue: data.inQueue ?? false,
    };

    if (config.checkLastBuild && data.lastBuild) {
      result.lastBuildNumber = data.lastBuild.number;
      result.lastBuildResult = data.lastBuild.result || "UNKNOWN";
      result.lastBuildDurationMs = data.lastBuild.duration;
      result.lastBuildTimestamp = data.lastBuild.timestamp;

      if (data.lastBuild.timestamp) {
        result.timeSinceLastBuildMs = Date.now() - data.lastBuild.timestamp;
      }
    }

    return {
      result,
    };
  }

  mergeResult(
    existing: JobStatusAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<JobStatusResult>,
  ): JobStatusAggregatedResult {
    const metadata = run.metadata;

    return {
      avgBuildDurationMs: mergeAverage(
        existing?.avgBuildDurationMs,
        metadata?.lastBuildDurationMs,
      ),
      successRate: mergeRate(
        existing?.successRate,
        metadata?.lastBuildResult === "SUCCESS",
      ),
      buildableRate: mergeRate(existing?.buildableRate, metadata?.buildable),
    };
  }
}
