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
import {
  healthResultNumber,
  healthResultString,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "../plugin-metadata";
import type { JenkinsTransportClient } from "../transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const serverInfoConfigSchema = z.object({});

export type ServerInfoConfig = z.infer<typeof serverInfoConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const serverInfoResultSchema = z.object({
  jenkinsVersion: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Jenkins Version",
  }),
  mode: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Server Mode",
  }),
  numExecutors: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Executors",
  }),
  usableWorkers: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Usable Workers",
  }),
  totalJobs: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Total Jobs",
  }),
  uptime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Uptime",
    "x-chart-unit": "hours",
  }).optional(),
});

export type ServerInfoResult = z.infer<typeof serverInfoResultSchema>;

// Aggregated result fields definition
const serverInfoAggregatedFields = {
  avgExecutors: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Executors",
  }),
  avgTotalJobs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Jobs",
  }),
};

// Type inferred from field definitions
export type ServerInfoAggregatedResult = InferAggregatedResult<
  typeof serverInfoAggregatedFields
>;

// ============================================================================
// SERVER INFO COLLECTOR
// ============================================================================

/**
 * Built-in collector for Jenkins server information.
 * Fetches basic server health metrics via /api/json.
 */
export class ServerInfoCollector implements CollectorStrategy<
  JenkinsTransportClient,
  ServerInfoConfig,
  ServerInfoResult,
  ServerInfoAggregatedResult
> {
  id = "server-info";
  displayName = "Server Info";
  description = "Collects Jenkins server information and health metrics";

  supportedPlugins = [pluginMetadata];

  config = new Versioned({ version: 1, schema: serverInfoConfigSchema });
  result = new Versioned({ version: 1, schema: serverInfoResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: serverInfoAggregatedFields,
  });

  async execute({
    client,
  }: {
    config: ServerInfoConfig;
    client: JenkinsTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<ServerInfoResult>> {
    const response = await client.exec({
      path: "/api/json",
      query: {
        tree: "mode,numExecutors,usableWorkers,jobs[name]",
      },
    });

    if (response.error) {
      return {
        result: {
          jenkinsVersion: "",
          mode: "",
          numExecutors: 0,
          usableWorkers: 0,
          totalJobs: 0,
        },
        error: response.error,
      };
    }

    const data = response.data as {
      mode?: string;
      numExecutors?: number;
      usableWorkers?: number;
      jobs?: Array<{ name: string }>;
    };

    return {
      result: {
        jenkinsVersion: response.jenkinsVersion || "unknown",
        mode: data.mode || "NORMAL",
        numExecutors: data.numExecutors || 0,
        usableWorkers: data.usableWorkers || 0,
        totalJobs: data.jobs?.length || 0,
      },
    };
  }

  mergeResult(
    existing: ServerInfoAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<ServerInfoResult>,
  ): ServerInfoAggregatedResult {
    const metadata = run.metadata;

    return {
      avgExecutors: mergeAverage(
        existing?.avgExecutors,
        metadata?.numExecutors,
      ),
      avgTotalJobs: mergeAverage(existing?.avgTotalJobs, metadata?.totalJobs),
    };
  }
}
