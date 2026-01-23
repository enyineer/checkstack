import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedCounter,
  mergeCounter,
  z,
  type InferAggregatedResult,
  type ConnectedClient,
} from "@checkstack/backend-api";
import {
  healthResultString,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type {
  HttpTransportClient,
  HttpRequest,
  HttpResponse,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * HTTP health check configuration schema.
 * Global defaults only - action params moved to RequestCollector.
 */
export const httpHealthCheckConfigSchema = z.object({
  timeout: z
    .number()
    .int()
    .min(100)
    .default(30_000)
    .describe("Default request timeout in milliseconds"),
});

export type HttpHealthCheckConfig = z.infer<typeof httpHealthCheckConfigSchema>;

// Legacy config types for migrations
interface HttpConfigV1 {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  headers?: { name: string; value: string }[];
  body?: string;
}

interface HttpConfigV2 extends HttpConfigV1 {
  timeout: number;
}

/** Per-run result metadata */
const httpResultMetadataSchema = healthResultSchema({
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type HttpResultMetadata = z.infer<typeof httpResultMetadataSchema>;

/** Aggregated field definitions for bucket merging */
const httpAggregatedFields = {
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
};

type HttpAggregatedResult = InferAggregatedResult<typeof httpAggregatedFields>;

// ============================================================================
// STRATEGY
// ============================================================================

export class HttpHealthCheckStrategy implements HealthCheckStrategy<
  HttpHealthCheckConfig,
  HttpTransportClient,
  HttpResultMetadata,
  typeof httpAggregatedFields
> {
  id = "http";
  displayName = "HTTP/HTTPS Health Check";
  description = "HTTP endpoint health monitoring";

  config: Versioned<HttpHealthCheckConfig> = new Versioned({
    version: 3, // v3 for createClient pattern with action params moved to RequestCollector
    schema: httpHealthCheckConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Add timeout field",
        migrate: (data: HttpConfigV1): HttpConfigV2 => ({
          ...data,
          timeout: 30_000,
        }),
      },
      {
        fromVersion: 2,
        toVersion: 3,
        description:
          "Remove url/method/headers/body (moved to RequestCollector)",
        migrate: (data: HttpConfigV2): HttpHealthCheckConfig => ({
          timeout: data.timeout,
        }),
      },
    ],
  });

  result: Versioned<HttpResultMetadata> = new Versioned({
    version: 3,
    schema: httpResultMetadataSchema,
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: httpAggregatedFields,
  });

  mergeResult(
    existing: HttpAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<HttpResultMetadata>,
  ): HttpAggregatedResult {
    const hasError = !!newRun.metadata?.error;
    return {
      errorCount: mergeCounter(existing?.errorCount, hasError),
    };
  }

  /**
   * Create an HTTP transport client for one-shot requests.
   * All request parameters come from the collector (RequestCollector).
   */
  async createClient(
    config: HttpHealthCheckConfig,
  ): Promise<ConnectedClient<HttpTransportClient>> {
    const validatedConfig = this.config.validate(config);

    const client: HttpTransportClient = {
      async exec(request: HttpRequest): Promise<HttpResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          request.timeout ?? validatedConfig.timeout,
        );

        try {
          const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          const body = await response.text();
          const headers: Record<string, string> = {};

          // eslint-disable-next-line unicorn/no-array-for-each
          response.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });

          return {
            statusCode: response.status,
            statusText: response.statusText,
            headers,
            body,
            contentType: headers["content-type"],
          };
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
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
}
