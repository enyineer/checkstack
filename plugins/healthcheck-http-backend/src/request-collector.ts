import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultJSONPath,
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
  body: z.string().optional().describe("Request body"),
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

const requestResultSchema = z.object({
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
  body: healthResultJSONPath({}),
  bodyLength: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Body Length",
    "x-chart-unit": "bytes",
  }),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Success",
  }),
});

export type RequestResult = z.infer<typeof requestResultSchema>;

const requestAggregatedSchema = z.object({
  avgResponseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
  }),
  successRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
});

export type RequestAggregatedResult = z.infer<typeof requestAggregatedSchema>;

// ============================================================================
// REQUEST COLLECTOR
// ============================================================================

/**
 * Built-in HTTP request collector.
 * Allows users to make HTTP requests and check responses.
 */
export class RequestCollector
  implements
    CollectorStrategy<
      HttpTransportClient,
      RequestConfig,
      RequestResult,
      RequestAggregatedResult
    >
{
  id = "request";
  displayName = "HTTP Request";
  description = "Make an HTTP request and check the response";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: requestConfigSchema });
  result = new Versioned({ version: 1, schema: requestResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: requestAggregatedSchema,
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

  aggregateResult(
    runs: HealthCheckRunForAggregation<RequestResult>[]
  ): RequestAggregatedResult {
    const times = runs
      .map((r) => r.metadata?.responseTimeMs)
      .filter((v): v is number => typeof v === "number");

    const successes = runs
      .map((r) => r.metadata?.success)
      .filter((v): v is boolean => typeof v === "boolean");

    const successCount = successes.filter(Boolean).length;

    return {
      avgResponseTimeMs:
        times.length > 0
          ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
          : 0,
      successRate:
        successes.length > 0
          ? Math.round((successCount / successes.length) * 100)
          : 0,
    };
  }
}
