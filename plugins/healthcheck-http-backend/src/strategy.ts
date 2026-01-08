import { JSONPath } from "jsonpath-plus";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  numericField,
  timeThresholdField,
  stringField,
  evaluateAssertions,
} from "@checkmate-monitor/backend-api";
import {
  healthResultNumber,
  healthResultString,
} from "@checkmate-monitor/healthcheck-common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Header configuration for custom HTTP headers.
 */
export const httpHeaderSchema = z.object({
  name: z.string().min(1).describe("Header name"),
  value: z.string().describe("Header value"),
});

/**
 * JSONPath assertion for response body validation.
 * Supports dynamic operators with runtime type coercion.
 */
const jsonPathAssertionSchema = z.object({
  field: z.literal("jsonPath"),
  path: z
    .string()
    .describe("JSONPath expression (e.g. $.status, $.data[0].id)"),
  operator: z.enum([
    "equals",
    "notEquals",
    "contains",
    "startsWith",
    "endsWith",
    "matches",
    "exists",
    "notExists",
    "lessThan",
    "lessThanOrEqual",
    "greaterThan",
    "greaterThanOrEqual",
  ]),
  value: z
    .string()
    .optional()
    .describe("Expected value (not needed for exists/notExists)"),
});

/**
 * Response header assertion schema.
 * Check for specific header values in the response.
 */
const headerAssertionSchema = z.object({
  field: z.literal("header"),
  headerName: z.string().describe("Response header name to check"),
  operator: z.enum([
    "equals",
    "notEquals",
    "contains",
    "startsWith",
    "endsWith",
    "exists",
  ]),
  value: z.string().optional().describe("Expected header value"),
});

/**
 * HTTP health check assertion schema using discriminated union.
 *
 * Assertions validate the result of a check:
 * - statusCode: Validate HTTP status code
 * - responseTime: Validate response latency
 * - contentType: Validate Content-Type header
 * - header: Validate any response header
 * - jsonPath: Validate JSON response body content
 */
const httpAssertionSchema = z.discriminatedUnion("field", [
  numericField("statusCode", { min: 100, max: 599 }),
  timeThresholdField("responseTime"),
  stringField("contentType"),
  headerAssertionSchema,
  jsonPathAssertionSchema,
]);

export type HttpAssertion = z.infer<typeof httpAssertionSchema>;

/**
 * HTTP health check configuration schema.
 *
 * Config defines HOW to run the check (connection details, request setup).
 * Assertions define WHAT to validate in the result.
 */
export const httpHealthCheckConfigSchema = z.object({
  url: z.string().url().describe("The full URL of the endpoint to check."),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "HEAD"])
    .default("GET")
    .describe("The HTTP method to use for the request."),
  headers: z
    .array(httpHeaderSchema)
    .optional()
    .describe("Custom HTTP headers to send with the request."),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Maximum time in milliseconds to wait for a response."),
  body: z
    .string()
    .optional()
    .describe(
      "Optional request payload body (e.g. JSON for POST requests). [textarea]"
    ),
  assertions: z
    .array(httpAssertionSchema)
    .optional()
    .describe("Validation conditions for the response."),
});

export type HttpHealthCheckConfig = z.infer<typeof httpHealthCheckConfigSchema>;

/** Per-run result metadata */
const httpResultMetadataSchema = z.object({
  statusCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Status Code",
  }).optional(),
  contentType: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Content Type",
  }).optional(),
  failedAssertion: httpAssertionSchema.optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

export type HttpResultMetadata = z.infer<typeof httpResultMetadataSchema>;

/** Aggregated metadata for buckets */
const httpAggregatedMetadataSchema = z.object({
  statusCodeCounts: z.record(z.string(), z.number()).meta({
    "x-chart-type": "bar",
    "x-chart-label": "Status Code Distribution",
  }),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
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
  displayName = "HTTP/HTTPS Health Check";
  description = "HTTP endpoint health monitoring with flexible assertions";

  config: Versioned<HttpHealthCheckConfig> = new Versioned({
    version: 2, // Bumped for breaking change
    schema: httpHealthCheckConfigSchema,
  });

  result: Versioned<HttpResultMetadata> = new Versioned({
    version: 2,
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
      if (run.metadata?.error) {
        errorCount++;
      }

      if (run.metadata?.statusCode !== undefined) {
        const key = String(run.metadata.statusCode);
        statusCodeCounts[key] = (statusCodeCounts[key] || 0) + 1;
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
      // Convert headers array to Record for fetch API
      const headersRecord: Record<string, string> = {};
      if (validatedConfig.headers) {
        for (const header of validatedConfig.headers) {
          headersRecord[header.name] = header.value;
        }
      }

      const response = await fetch(validatedConfig.url, {
        method: validatedConfig.method,
        headers: headersRecord,
        body: validatedConfig.body,
        signal: AbortSignal.timeout(validatedConfig.timeout),
      });
      const end = performance.now();
      const latencyMs = Math.round(end - start);

      // Collect response data for assertions
      const statusCode = response.status;
      const contentType = response.headers.get("content-type") || "";

      // Collect response headers for header assertions
      // Note: We get headers directly in the assertion loop, not pre-collected

      // Build values object for standard assertions
      const assertionValues: Record<string, unknown> = {
        statusCode,
        responseTime: latencyMs,
        contentType,
      };

      // Separate assertions by type
      const standardAssertions: Array<{
        field: string;
        operator: string;
        value?: unknown;
      }> = [];
      const headerAssertions: Array<z.infer<typeof headerAssertionSchema>> = [];
      const jsonPathAssertions: Array<z.infer<typeof jsonPathAssertionSchema>> =
        [];

      for (const assertion of validatedConfig.assertions || []) {
        if (assertion.field === "header") {
          headerAssertions.push(
            assertion as z.infer<typeof headerAssertionSchema>
          );
        } else if (assertion.field === "jsonPath") {
          jsonPathAssertions.push(
            assertion as z.infer<typeof jsonPathAssertionSchema>
          );
        } else {
          standardAssertions.push(assertion);
        }
      }

      // Evaluate standard assertions (statusCode, responseTime, contentType)
      const failedStandard = evaluateAssertions(
        standardAssertions,
        assertionValues
      );
      if (failedStandard) {
        return {
          status: "unhealthy",
          latencyMs,
          message: `Assertion failed: ${failedStandard.field} ${
            failedStandard.operator
          } ${"value" in failedStandard ? failedStandard.value : ""}`,
          metadata: {
            statusCode,
            contentType,
            failedAssertion: failedStandard as HttpAssertion,
          },
        };
      }

      // Evaluate header assertions
      for (const headerAssertion of headerAssertions) {
        // Get header value directly from the response
        const headerValue =
          response.headers.get(headerAssertion.headerName) ?? undefined;
        const passed = this.evaluateHeaderAssertion(
          headerAssertion.operator,
          headerValue,
          headerAssertion.value
        );

        if (!passed) {
          return {
            status: "unhealthy",
            latencyMs,
            message: `Header assertion failed: ${headerAssertion.headerName} ${
              headerAssertion.operator
            } ${headerAssertion.value || ""}. Actual: ${
              headerValue ?? "(missing)"
            }`,
            metadata: {
              statusCode,
              contentType,
              failedAssertion: headerAssertion,
            },
          };
        }
      }

      // Evaluate JSONPath assertions (only if present)
      if (jsonPathAssertions.length > 0) {
        let responseData: unknown;

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
                latencyMs,
                message:
                  "Response is not valid JSON, but JSONPath assertions are configured",
                metadata: { statusCode, contentType },
              };
            }
          }
        } catch (error_: unknown) {
          return {
            status: "unhealthy",
            latencyMs,
            message: `Failed to parse response body: ${
              (error_ as Error).message
            }`,
            metadata: { statusCode },
          };
        }

        const extractPath = (path: string, json: unknown) =>
          JSONPath({ path, json: json as object, wrap: false });

        for (const jsonPathAssertion of jsonPathAssertions) {
          const actualValue = extractPath(jsonPathAssertion.path, responseData);
          const passed = this.evaluateJsonPathAssertion(
            jsonPathAssertion.operator,
            actualValue,
            jsonPathAssertion.value
          );

          if (!passed) {
            return {
              status: "unhealthy",
              latencyMs,
              message: `JSONPath assertion failed: [${
                jsonPathAssertion.path
              }] ${jsonPathAssertion.operator} ${
                jsonPathAssertion.value || ""
              }. Actual: ${JSON.stringify(actualValue)}`,
              metadata: {
                statusCode,
                contentType,
                failedAssertion: jsonPathAssertion,
              },
            };
          }
        }
      }

      const assertionCount = validatedConfig.assertions?.length || 0;
      return {
        status: "healthy",
        latencyMs,
        message: `HTTP ${statusCode}${
          assertionCount > 0 ? ` - passed ${assertionCount} assertion(s)` : ""
        }`,
        metadata: { statusCode, contentType },
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

  private evaluateHeaderAssertion(
    operator: string,
    actual: string | undefined,
    expected = ""
  ): boolean {
    if (operator === "exists") return actual !== undefined;

    if (actual === undefined) return false;

    switch (operator) {
      case "equals": {
        return actual === expected;
      }
      case "notEquals": {
        return actual !== expected;
      }
      case "contains": {
        return actual.includes(expected);
      }
      case "startsWith": {
        return actual.startsWith(expected);
      }
      case "endsWith": {
        return actual.endsWith(expected);
      }
      default: {
        return false;
      }
    }
  }

  private evaluateJsonPathAssertion(
    operator: string,
    actual: unknown,
    expected: string | undefined
  ): boolean {
    // Existence checks

    if (operator === "exists") return actual !== undefined && actual !== null;

    if (operator === "notExists")
      return actual === undefined || actual === null;

    // Numeric operators
    if (
      [
        "lessThan",
        "lessThanOrEqual",
        "greaterThan",
        "greaterThanOrEqual",
      ].includes(operator)
    ) {
      const numActual = Number(actual);
      const numExpected = Number(expected);
      if (Number.isNaN(numActual) || Number.isNaN(numExpected)) return false;

      switch (operator) {
        case "lessThan": {
          return numActual < numExpected;
        }
        case "lessThanOrEqual": {
          return numActual <= numExpected;
        }
        case "greaterThan": {
          return numActual > numExpected;
        }
        case "greaterThanOrEqual": {
          return numActual >= numExpected;
        }
      }
    }

    // String operators
    const strActual = String(actual ?? "");
    const strExpected = expected || "";

    switch (operator) {
      case "equals": {
        return actual === expected || strActual === strExpected;
      }
      case "notEquals": {
        return actual !== expected && strActual !== strExpected;
      }
      case "contains": {
        return strActual.includes(strExpected);
      }
      case "startsWith": {
        return strActual.startsWith(strExpected);
      }
      case "endsWith": {
        return strActual.endsWith(strExpected);
      }
      case "matches": {
        try {
          return new RegExp(strExpected).test(strActual);
        } catch {
          return false;
        }
      }
      default: {
        return false;
      }
    }
  }
}
