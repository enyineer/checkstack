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
  healthResultJSONPath,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { HttpTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const requestConfigSchema = z.object({
  url: z.string().url().describe("Full URL to request"),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "HEAD"])
    .default("GET")
    .describe("HTTP method"),
  headers: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional()
    .describe("Request headers"),
  body: configString({
    "x-editor-types": ["none", "raw", "json", "yaml", "xml", "formdata"],
  })
    .optional()
    .describe("Request body"),
  timeout: z
    .number()
    .min(100)
    .default(30_000)
    .describe("Timeout in milliseconds"),
});

export type RequestConfig = z.infer<typeof requestConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const requestResultSchema = healthResultSchema({
  statusCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Status Code",
  }),
  statusText: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Status",
  }),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
  }),
  body: healthResultJSONPath({ "x-ephemeral": true }),
  bodyLength: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Body Length",
    "x-chart-unit": "bytes",
  }),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "HTTP Success",
  }),
});

export type RequestResult = z.infer<typeof requestResultSchema>;

// Aggregated result fields definition
const requestAggregatedFields = {
  avgResponseTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
};

// Type inferred automatically from field definitions
export type RequestAggregatedResult = InferAggregatedResult<
  typeof requestAggregatedFields
>;

// ============================================================================
// REQUEST COLLECTOR
// ============================================================================

/**
 * Built-in HTTP request collector.
 * Allows users to make HTTP requests and check responses.
 */
export class RequestCollector implements CollectorStrategy<
  HttpTransportClient,
  RequestConfig,
  RequestResult,
  RequestAggregatedResult
> {
  id = "request";
  displayName = "HTTP Request";
  description = "Make an HTTP request and check the response";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: requestConfigSchema });
  result = new Versioned({ version: 1, schema: requestResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: requestAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: RequestConfig;
    client: HttpTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<RequestResult>> {
    const startTime = Date.now();

    // Convert headers array to record
    const headers: Record<string, string> = {};
    for (const h of config.headers ?? []) {
      headers[h.name] = h.value;
    }

    const response = await client.exec({
      url: config.url,
      method: config.method,
      headers,
      body: config.body,
      timeout: config.timeout,
    });

    const responseTimeMs = Date.now() - startTime;
    const success = response.statusCode >= 200 && response.statusCode < 400;

    return {
      result: {
        statusCode: response.statusCode,
        statusText: response.statusText,
        responseTimeMs,
        body: response.body ?? "",
        bodyLength: response.body?.length ?? 0,
        success,
      },
      error: success
        ? undefined
        : `HTTP ${response.statusCode}: ${response.statusText}`,
    };
  }

  mergeResult(
    existing: RequestAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<RequestResult>,
  ): RequestAggregatedResult {
    return {
      avgResponseTimeMs: mergeAverage(
        existing?.avgResponseTimeMs,
        newRun.metadata?.responseTimeMs,
      ),
      successRate: mergeRate(existing?.successRate, newRun.metadata?.success),
    };
  }
}
