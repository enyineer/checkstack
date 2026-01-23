import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  aggregatedCounter,
  mergeAverage,
  mergeRate,
  mergeCounter,
  z,
  configString,
  configNumber,
  type ConnectedClient,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type {
  JenkinsTransportClient,
  JenkinsRequest,
  JenkinsResponse,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Jenkins health check configuration schema.
 * Provides connectivity settings for the Jenkins API.
 */
export const jenkinsConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .describe("Jenkins server URL (e.g., https://jenkins.example.com)"),
  username: configString({}).describe(
    "Jenkins username for API authentication",
  ),
  apiToken: configString({ "x-secret": true }).describe(
    "Jenkins API token (generate from User > Configure > API Token)",
  ),
  timeout: configNumber({})
    .int()
    .min(1000)
    .default(30_000)
    .describe("Request timeout in milliseconds"),
});

export type JenkinsConfig = z.infer<typeof jenkinsConfigSchema>;

/** Per-run result metadata */
const jenkinsResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
  }).optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type JenkinsResult = z.infer<typeof jenkinsResultSchema>;

/** Aggregated field definitions for bucket merging */
const jenkinsAggregatedFields = {
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  avgResponseTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
};

type JenkinsAggregatedResult = InferAggregatedResult<
  typeof jenkinsAggregatedFields
>;

// ============================================================================
// STRATEGY
// ============================================================================

export class JenkinsHealthCheckStrategy implements HealthCheckStrategy<
  JenkinsConfig,
  JenkinsTransportClient,
  JenkinsResult,
  typeof jenkinsAggregatedFields
> {
  id = "jenkins";
  displayName = "Jenkins Health Check";
  description = "Monitor Jenkins CI/CD server health and job status";

  config: Versioned<JenkinsConfig> = new Versioned({
    version: 1,
    schema: jenkinsConfigSchema,
  });

  result: Versioned<JenkinsResult> = new Versioned({
    version: 1,
    schema: jenkinsResultSchema,
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: jenkinsAggregatedFields,
  });

  /**
   * Create a Jenkins transport client for API requests.
   */
  async createClient(
    config: JenkinsConfig,
  ): Promise<ConnectedClient<JenkinsTransportClient>> {
    const validatedConfig = this.config.validate(config);
    const baseUrl = validatedConfig.baseUrl.replace(/\/$/, ""); // Remove trailing slash

    // Create Basic Auth header
    const authHeader = `Basic ${Buffer.from(
      `${validatedConfig.username}:${validatedConfig.apiToken}`,
    ).toString("base64")}`;

    const client: JenkinsTransportClient = {
      async exec(request: JenkinsRequest): Promise<JenkinsResponse> {
        // Build URL with query params
        let url = `${baseUrl}${request.path}`;
        if (request.query && Object.keys(request.query).length > 0) {
          const params = new URLSearchParams(request.query);
          url += `?${params.toString()}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          validatedConfig.timeout,
        );

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: authHeader,
              Accept: "application/json",
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Get Jenkins version from header
          const jenkinsVersion = response.headers.get("X-Jenkins") || undefined;

          if (!response.ok) {
            return {
              statusCode: response.status,
              data: undefined,
              error: `HTTP ${response.status}: ${response.statusText}`,
              jenkinsVersion,
            };
          }

          const data = await response.json();

          return {
            statusCode: response.status,
            data,
            jenkinsVersion,
          };
        } catch (error) {
          clearTimeout(timeoutId);

          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            statusCode: 0,
            data: undefined,
            error: errorMessage,
          };
        }
      },
    };

    return {
      client,
      close: () => {
        // HTTP is stateless, nothing to close
      },
    };
  }

  mergeResult(
    existing: JenkinsAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<JenkinsResult>,
  ): JenkinsAggregatedResult {
    const metadata = run.metadata;

    const avgResponseTimeMs = mergeAverage(
      existing?.avgResponseTimeMs,
      metadata?.responseTimeMs,
    );

    const isSuccess = metadata?.connected ?? false;
    const successRate = mergeRate(existing?.successRate, isSuccess);

    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    return { successRate, avgResponseTimeMs, errorCount };
  }
}
