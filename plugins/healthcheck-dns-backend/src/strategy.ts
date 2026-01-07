import * as dns from "node:dns/promises";
import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  booleanField,
  stringField,
  numericField,
  timeThresholdField,
  evaluateAssertions,
} from "@checkmate-monitor/backend-api";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Assertion schema for DNS health checks using shared factories.
 */
const dnsAssertionSchema = z.discriminatedUnion("field", [
  booleanField("recordExists"),
  stringField("recordValue"),
  numericField("recordCount", { min: 0 }),
  timeThresholdField("resolutionTime"),
]);

export type DnsAssertion = z.infer<typeof dnsAssertionSchema>;

/**
 * Configuration schema for DNS health checks.
 */
export const dnsConfigSchema = z.object({
  hostname: z.string().describe("Hostname to resolve"),
  recordType: z
    .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS"])
    .default("A")
    .describe("DNS record type to query"),
  nameserver: z
    .string()
    .optional()
    .describe("Custom nameserver (optional, uses system default)"),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Timeout in milliseconds"),
  assertions: z
    .array(dnsAssertionSchema)
    .optional()
    .describe("Conditions for validation"),
});

export type DnsConfig = z.infer<typeof dnsConfigSchema>;

/**
 * Per-run result metadata.
 */
const dnsResultSchema = z.object({
  resolvedValues: z.array(z.string()),
  recordCount: z.number(),
  nameserver: z.string().optional(),
  resolutionTimeMs: z.number(),
  failedAssertion: dnsAssertionSchema.optional(),
  error: z.string().optional(),
});

export type DnsResult = z.infer<typeof dnsResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const dnsAggregatedSchema = z.object({
  avgResolutionTime: z.number(),
  failureCount: z.number(),
  errorCount: z.number(),
});

export type DnsAggregatedResult = z.infer<typeof dnsAggregatedSchema>;

// ============================================================================
// RESOLVER INTERFACE (for testability)
// ============================================================================

export interface DnsResolver {
  setServers(servers: string[]): void;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  resolveCname(hostname: string): Promise<string[]>;
  resolveMx(
    hostname: string
  ): Promise<{ priority: number; exchange: string }[]>;
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveNs(hostname: string): Promise<string[]>;
}

export type ResolverFactory = () => DnsResolver;

// Default factory using Node.js dns module
const defaultResolverFactory: ResolverFactory = () =>
  new dns.Resolver() as DnsResolver;

// ============================================================================
// STRATEGY
// ============================================================================

export class DnsHealthCheckStrategy
  implements HealthCheckStrategy<DnsConfig, DnsResult, DnsAggregatedResult>
{
  id = "dns";
  displayName = "DNS Health Check";
  description = "DNS record resolution with response validation";

  // Injected resolver factory for testing
  private resolverFactory: ResolverFactory;

  constructor(resolverFactory: ResolverFactory = defaultResolverFactory) {
    this.resolverFactory = resolverFactory;
  }

  config: Versioned<DnsConfig> = new Versioned({
    version: 1,
    schema: dnsConfigSchema,
  });

  result: Versioned<DnsResult> = new Versioned({
    version: 1,
    schema: dnsResultSchema,
  });

  aggregatedResult: Versioned<DnsAggregatedResult> = new Versioned({
    version: 1,
    schema: dnsAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<DnsResult>[]
  ): DnsAggregatedResult {
    let totalResolutionTime = 0;
    let failureCount = 0;
    let errorCount = 0;
    let validRuns = 0;

    for (const run of runs) {
      if (run.metadata?.error) {
        errorCount++;
        continue;
      }
      if (run.status === "unhealthy") {
        failureCount++;
      }
      if (run.metadata) {
        totalResolutionTime += run.metadata.resolutionTimeMs;
        validRuns++;
      }
    }

    return {
      avgResolutionTime: validRuns > 0 ? totalResolutionTime / validRuns : 0,
      failureCount,
      errorCount,
    };
  }

  async execute(config: DnsConfig): Promise<HealthCheckResult<DnsResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    try {
      // Configure resolver with custom nameserver if provided
      const resolver = this.resolverFactory();
      if (validatedConfig.nameserver) {
        resolver.setServers([validatedConfig.nameserver]);
      }

      // Perform DNS lookup based on record type
      const resolvedValues = await this.resolveRecords(
        resolver,
        validatedConfig.hostname,
        validatedConfig.recordType,
        validatedConfig.timeout
      );

      const end = performance.now();
      const resolutionTimeMs = Math.round(end - start);

      const result: Omit<DnsResult, "failedAssertion" | "error"> = {
        resolvedValues,
        recordCount: resolvedValues.length,
        nameserver: validatedConfig.nameserver,
        resolutionTimeMs,
      };

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        recordExists: resolvedValues.length > 0,
        recordValue: resolvedValues[0] ?? "",
        recordCount: resolvedValues.length,
        resolutionTime: resolutionTimeMs,
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs: resolutionTimeMs,
          message: `Assertion failed: ${failedAssertion.field} ${
            failedAssertion.operator
          }${"value" in failedAssertion ? ` ${failedAssertion.value}` : ""}`,
          metadata: { ...result, failedAssertion },
        };
      }

      return {
        status: "healthy",
        latencyMs: resolutionTimeMs,
        message: `Resolved ${validatedConfig.hostname} (${
          validatedConfig.recordType
        }): ${resolvedValues.slice(0, 3).join(", ")}${
          resolvedValues.length > 3 ? "..." : ""
        }`,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "DNS resolution failed",
        metadata: {
          resolvedValues: [],
          recordCount: 0,
          nameserver: validatedConfig.nameserver,
          resolutionTimeMs: Math.round(end - start),
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }

  /**
   * Resolve DNS records based on type.
   */
  private async resolveRecords(
    resolver: DnsResolver,
    hostname: string,
    recordType: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS",
    timeout: number
  ): Promise<string[]> {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("DNS resolution timeout")), timeout);
    });

    // Resolve based on record type
    const resolvePromise = (async () => {
      switch (recordType) {
        case "A": {
          return await resolver.resolve4(hostname);
        }
        case "AAAA": {
          return await resolver.resolve6(hostname);
        }
        case "CNAME": {
          return await resolver.resolveCname(hostname);
        }
        case "MX": {
          const records = await resolver.resolveMx(hostname);
          return records.map((r) => `${r.priority} ${r.exchange}`);
        }
        case "TXT": {
          const records = await resolver.resolveTxt(hostname);
          return records.map((r) => r.join(""));
        }
        case "NS": {
          return await resolver.resolveNs(hostname);
        }
      }
    })();

    return Promise.race([resolvePromise, timeoutPromise]);
  }
}
