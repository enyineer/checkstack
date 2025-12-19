import {
  HealthCheckStrategy,
  HealthCheckResult,
  z,
} from "@checkmate/backend-api";

export const httpHealthCheckConfigSchema = z.object({
  url: z.url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "HEAD"]).default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().min(100).default(5000), // ms
  expectedStatus: z.number().int().default(200),
  body: z.string().optional(),
});

export type HttpHealthCheckConfig = z.infer<typeof httpHealthCheckConfigSchema>;

export class HttpHealthCheckStrategy
  implements HealthCheckStrategy<HttpHealthCheckConfig>
{
  id = "http";

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

      return response.status === config.expectedStatus
        ? {
            status: "healthy",
            latency,
            message: `Respond with ${response.status}`,
            metadata: { statusCode: response.status },
          }
        : {
            status: "unhealthy",
            latency,
            message: `Unexpected status code: ${response.status}. Expected: ${config.expectedStatus}`,
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
