import { JSONPath } from "jsonpath-plus";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  z,
} from "@checkmate/backend-api";

export const httpHealthCheckAssertionSchema = z.object({
  path: z.string().describe("JSONPath to extract value (e.g. $.status)"),
  operator: z.enum(["equals", "contains", "matches", "exists", "notEquals"]),
  expectedValue: z.string().optional(),
});

export const httpHealthCheckConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "HEAD"]).default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().min(100).default(5000), // ms
  expectedStatus: z.number().int().default(200),
  body: z.string().optional(),
  assertions: z.array(httpHealthCheckAssertionSchema).optional(),
});

export type HttpHealthCheckConfig = z.infer<typeof httpHealthCheckConfigSchema>;

export class HttpHealthCheckStrategy
  implements HealthCheckStrategy<HttpHealthCheckConfig>
{
  id = "http";
  displayName = "HTTP Health Check";
  description = "Checks a HTTP(S) endpoint for status code and body assertions";

  configSchema = httpHealthCheckConfigSchema;

  async execute(config: HttpHealthCheckConfig): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      const response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        body: config.body,
        signal: AbortSignal.timeout(config.timeout),
      });
      const end = performance.now();
      const latency = Math.round(end - start);

      if (response.status !== config.expectedStatus) {
        return {
          status: "unhealthy",
          latency,
          message: `Unexpected status code: ${response.status}. Expected: ${config.expectedStatus}`,
          metadata: { statusCode: response.status },
        };
      }

      if (config.assertions && config.assertions.length > 0) {
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
                latency,
                message:
                  "Response is not valid JSON, but assertions are configured",
                metadata: { statusCode: response.status, contentType },
              };
            }
          }
        } catch (error_: unknown) {
          return {
            status: "unhealthy",
            latency,
            message: `Failed to parse response body: ${
              (error_ as Error).message
            }`,
            metadata: { statusCode: response.status },
          };
        }

        for (const assertion of config.assertions) {
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
              latency,
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
        latency,
        message: `Respond with ${response.status}${
          config.assertions?.length
            ? ` and passed ${config.assertions.length} assertions`
            : ""
        }`,
        metadata: { statusCode: response.status },
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latency: Math.round(end - start),
        message: isError ? error.message : "Request failed",
        metadata: { error: isError ? error.name : "UnknownError" },
      };
    }
  }
}
