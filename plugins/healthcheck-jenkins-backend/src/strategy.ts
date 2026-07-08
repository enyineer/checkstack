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
  configSecret,
  type ConnectedClient,
  type TransportTimings,
  type InferAggregatedResult,
  baseStrategyConfigSchema,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import type {
  JenkinsTransportClient,
  JenkinsRequest,
  JenkinsResponse,
} from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Jenkins health check configuration schema.
 * Provides connectivity settings for the Jenkins API.
 */
export const jenkinsConfigSchema = baseStrategyConfigSchema.extend({
  // Templatable: supports `{{ environment.baseUrl }}` so one config covers N
  // environments. The `.url()` validation moves to POST-RENDER (see
  // `createClient`) because the stored value `{{ environment.baseUrl }}` is not
  // itself a valid URL.
  baseUrl: configString({ "x-templatable": true }).describe(
    "Jenkins server URL (e.g., https://jenkins.example.com). Supports templating, e.g. {{ environment.baseUrl }}",
  ),
  username: configString({}).describe(
    "Jenkins username for API authentication",
  ),
  apiToken: configSecret({ id: "apiToken" }).describe(
    "Jenkins API token (generate from User > Configure > API Token)",
  ),
});

/**
 * Post-render validator for the Jenkins `baseUrl`. The stored value is a plain
 * templatable string (no `.url()`); the executor renders `{{ environment.* }}`
 * per environment, then this re-validates the CONCRETE rendered URL. A bad
 * render (e.g. an empty environment yielding a relative path) surfaces as a
 * clear config error - transport-failure semantics - instead of a confusing
 * fetch failure.
 */
const renderedUrlSchema = z.string().url();

export type JenkinsConfig = z.infer<typeof jenkinsConfigSchema>;

/** Per-run result metadata */
const jenkinsResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
    "x-chart-true-label": "connected",
    "x-chart-false-label": "disconnected",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-priority": 10,
  }),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 20,
  }).optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type JenkinsResult = z.infer<typeof jenkinsResultSchema>;

/** Aggregated field definitions for bucket merging */
const jenkinsAggregatedFields = {
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
  avgResponseTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 20,
  }),
  // Absolute count twin of successRate; it tracks the same connectivity
  // signal but drifts with sampling cadence. Success rate (a bounded
  // percentage) is the stable form, so the raw count is off by default.
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
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
  category = StrategyCategory.INTEGRATION;

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

    // Post-render guard: `baseUrl` is a templatable string, so `.url()` cannot
    // run at store time. The executor has already rendered `{{ environment.* }}`
    // into `config.baseUrl`; validate the CONCRETE rendered URL here so a bad
    // render fails clearly instead of attempting a request against a
    // non-URL/relative path.
    const renderedUrl = renderedUrlSchema.safeParse(validatedConfig.baseUrl);
    if (!renderedUrl.success) {
      throw new Error(
        `Rendered baseUrl is invalid: ${JSON.stringify(validatedConfig.baseUrl)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      );
    }
    const baseUrl = renderedUrl.data.replace(/\/$/, ""); // Remove trailing slash

    // Create Basic Auth header
    const authHeader = `Basic ${Buffer.from(
      `${validatedConfig.username}:${validatedConfig.apiToken}`,
    ).toString("base64")}`;

    // Jenkins uses a plain fetch per request, so we can only observe the coarse
    // request round-trip. Map that to processingMs and do not attempt to split
    // out DNS/connect/TLS phases, which fetch does not expose here
    // (last-request-wins).
    const timings: TransportTimings = {};

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

        const start = performance.now();
        const recordProcessing = () => {
          timings.processingMs = Math.max(
            0,
            Math.round(performance.now() - start),
          );
        };

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: authHeader,
              Accept: "application/json",
            },
            signal: controller.signal,
          });

          // Get Jenkins version from header
          const jenkinsVersion = response.headers.get("X-Jenkins") || undefined;

          if (!response.ok) {
            clearTimeout(timeoutId);
            recordProcessing();
            return {
              statusCode: response.status,
              data: undefined,
              error: `HTTP ${response.status}: ${response.statusText}`,
              jenkinsVersion,
            };
          }

          // Read body BEFORE clearing timeout - body streaming can also hang
          const data = await response.json();

          clearTimeout(timeoutId);
          recordProcessing();

          return {
            statusCode: response.status,
            data,
            jenkinsVersion,
          };
        } catch (error) {
          clearTimeout(timeoutId);
          recordProcessing();

          const errorMessage = extractErrorMessage(error);
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
      timings,
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
