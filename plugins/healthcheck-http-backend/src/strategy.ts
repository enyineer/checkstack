import { JSONPath } from "jsonpath-plus";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
} from "@checkmate-monitor/backend-api";

export const httpHealthCheckAssertionSchema = z.object({
  path: z.string().describe("JSONPath to extract value (e.g. $.status)"),
  operator: z.enum(["equals", "contains", "matches", "exists", "notEquals"]),
  expectedValue: z.string().optional(),
});

export const httpHealthCheckConfigSchema = z.object({
  url: z.string().url().describe("The full URL of the endpoint to check."),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "HEAD"])
    .default("GET")
    .describe("The HTTP method to use for the request."),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Custom HTTP headers to send with the request (JSON object)."),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Maximum time in milliseconds to wait for a response."),
  expectedStatus: z
    .number()
    .int()
    .default(200)
    .describe("The HTTP status code that indicates a healthy service."),
  body: z
    .string()
    .optional()
    .describe(
      "Optional request payload body (e.g. JSON for POST requests). [textarea]"
    ),
  assertions: z
    .array(httpHealthCheckAssertionSchema)
    .optional()
    .describe("A list of rules to validate the response body content."),
});

export type HttpHealthCheckConfig = z.infer<typeof httpHealthCheckConfigSchema>;

/** Per-run result metadata */
const httpResultMetadataSchema = z.object({
  statusCode: z.number().optional(),
  contentType: z.string().optional(),
  assertion: httpHealthCheckAssertionSchema.optional(),
  error: z.string().optional(),
});

export type HttpResultMetadata = z.infer<typeof httpResultMetadataSchema>;

/** Aggregated metadata for buckets */
const httpAggregatedMetadataSchema = z.object({
  statusCodeCounts: z.record(z.string(), z.number()),
  errorCount: z.number(),
});

export type HttpAggregatedMetadata = z.infer<
  typeof httpAggregatedMetadataSchema
>;

export class HttpHealthCheckStrategy
  implements
    HealthCheckStrategy<
      HttpHealthCheckConfig,
      HttpResultMetadata,
      HttpAggregatedMetadata
    >
{
  id = "http";
  displayName = "HTTP Health Check";
  description = "Performs HTTP requests to check endpoint health";

  config: Versioned<HttpHealthCheckConfig> = new Versioned({
    version: 1,
    schema: httpHealthCheckConfigSchema,
  });

  result: Versioned<HttpResultMetadata> = new Versioned({
    version: 1,
    schema: httpResultMetadataSchema,
  });

  aggregatedResult: Versioned<HttpAggregatedMetadata> = new Versioned({
    version: 1,
    schema: httpAggregatedMetadataSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<HttpResultMetadata>[]
  ): HttpAggregatedMetadata {
    const statusCodeCounts: Record<string, number> = {};
    let errorCount = 0;

    for (const run of runs) {
      if (run.metadata?.statusCode) {
        const code = String(run.metadata.statusCode);
        statusCodeCounts[code] = (statusCodeCounts[code] || 0) + 1;
      }
      if (run.metadata?.error) {
        errorCount++;
      }
    }

    return { statusCodeCounts, errorCount };
  }

  async execute(
    config: HttpHealthCheckConfig
  ): Promise<HealthCheckResult<HttpResultMetadata>> {
    // Validate and apply defaults from schema
    const validatedConfig = this.config.validate(config);

    const start = performance.now();
    try {
      const response = await fetch(validatedConfig.url, {
        method: validatedConfig.method,
        headers: validatedConfig.headers,
        body: validatedConfig.body,
        signal: AbortSignal.timeout(validatedConfig.timeout),
      });
      const end = performance.now();
      const latency = Math.round(end - start);

      if (response.status !== validatedConfig.expectedStatus) {
        return {
          status: "unhealthy",
          latencyMs: latency,
          message: `Unexpected status code: ${response.status}. Expected: ${validatedConfig.expectedStatus}`,
          metadata: { statusCode: response.status },
        };
      }

      if (validatedConfig.assertions && validatedConfig.assertions.length > 0) {
        let responseData: unknown;
        const contentType = response.headers.get("content-type") || "";

        try {
          if (contentType.includes("application/json")) {
            responseData = await response.json();
          } else {
            const text = await response.text();
            try {
              responseData = JSON.parse(text);
            } catch {
              return {
                status: "unhealthy",
                latencyMs: latency,
                message:
                  "Response is not valid JSON, but assertions are configured",
                metadata: { statusCode: response.status, contentType },
              };
            }
          }
        } catch (error_: unknown) {
          return {
            status: "unhealthy",
            latencyMs: latency,
            message: `Failed to parse response body: ${
              (error_ as Error).message
            }`,
            metadata: { statusCode: response.status },
          };
        }

        for (const assertion of validatedConfig.assertions) {
          const results = JSONPath({
            path: assertion.path,
            json: responseData as object,
            wrap: false,
          });

          const actualValue =
            results === undefined ? undefined : String(results);
          const expectedValue = assertion.expectedValue;

          let passed = false;
          switch (assertion.operator) {
            case "exists": {
              passed = results !== undefined;
              break;
            }
            case "equals": {
              passed = actualValue === expectedValue;
              break;
            }
            case "notEquals": {
              passed = actualValue !== expectedValue;
              break;
            }
            case "contains": {
              passed = actualValue?.includes(expectedValue || "") ?? false;
              break;
            }
            case "matches": {
              passed = new RegExp(expectedValue || "").test(actualValue || "");
              break;
            }
          }

          if (!passed) {
            return {
              status: "unhealthy",
              latencyMs: latency,
              message: `Assertion failed: [${assertion.path}] ${
                assertion.operator
              } ${expectedValue || ""}. Actual: ${actualValue}`,
              metadata: { statusCode: response.status, assertion },
            };
          }
        }
      }

      return {
        status: "healthy",
        latencyMs: latency,
        message: `Respond with ${response.status}${
          validatedConfig.assertions?.length
            ? ` and passed ${validatedConfig.assertions.length} assertions`
            : ""
        }`,
        metadata: { statusCode: response.status },
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "Request failed",
        metadata: { error: isError ? error.name : "UnknownError" },
      };
    }
  }
}
