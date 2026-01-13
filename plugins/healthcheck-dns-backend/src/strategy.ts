import * as dns from "node:dns/promises";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  type ConnectedClient,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultArray,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import type {
  DnsTransportClient,
  DnsLookupRequest,
  DnsLookupResult,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for DNS health checks.
 * Resolver configuration only - action params moved to LookupCollector.
 */
export const dnsConfigSchema = z.object({
  nameserver: z.string().optional().describe("Custom nameserver (optional)"),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Timeout in milliseconds"),
});

export type DnsConfig = z.infer<typeof dnsConfigSchema>;

// Legacy config type for migrations
interface DnsConfigV1 {
  hostname: string;
  recordType: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS";
  nameserver?: string;
  timeout: number;
}

/**
 * Per-run result metadata.
 */
const dnsResultSchema = healthResultSchema({
  resolvedValues: healthResultArray({
    "x-chart-type": "text",
    "x-chart-label": "Resolved Values",
  }),
  recordCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Record Count",
  }),
  resolutionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Resolution Time",
    "x-chart-unit": "ms",
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }).optional(),
});

type DnsResult = z.infer<typeof dnsResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const dnsAggregatedSchema = healthResultSchema({
  avgResolutionTime: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Resolution Time",
    "x-chart-unit": "ms",
  }),
  failureCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Failures",
  }),
  errorCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

type DnsAggregatedResult = z.infer<typeof dnsAggregatedSchema>;

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
const defaultResolverFactory: ResolverFactory = () => new dns.Resolver();

// ============================================================================
// STRATEGY
// ============================================================================

export class DnsHealthCheckStrategy
  implements
    HealthCheckStrategy<
      DnsConfig,
      DnsTransportClient,
      DnsResult,
      DnsAggregatedResult
    >
{
  id = "dns";
  displayName = "DNS Health Check";
  description = "DNS record resolution with response validation";

  private resolverFactory: ResolverFactory;

  constructor(resolverFactory: ResolverFactory = defaultResolverFactory) {
    this.resolverFactory = resolverFactory;
  }

  config: Versioned<DnsConfig> = new Versioned({
    version: 2,
    schema: dnsConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Remove hostname/recordType (moved to LookupCollector)",
        migrate: (data: DnsConfigV1): DnsConfig => ({
          nameserver: data.nameserver,
          timeout: data.timeout,
        }),
      },
    ],
  });

  result: Versioned<DnsResult> = new Versioned({
    version: 2,
    schema: dnsResultSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no result changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  aggregatedResult: Versioned<DnsAggregatedResult> = new Versioned({
    version: 1,
    schema: dnsAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<DnsResult>[]
  ): DnsAggregatedResult {
    const validRuns = runs.filter((r) => r.metadata);

    if (validRuns.length === 0) {
      return { avgResolutionTime: 0, failureCount: 0, errorCount: 0 };
    }

    const resolutionTimes = validRuns
      .map((r) => r.metadata?.resolutionTimeMs)
      .filter((t): t is number => typeof t === "number");

    const avgResolutionTime =
      resolutionTimes.length > 0
        ? Math.round(
            resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
          )
        : 0;

    const failureCount = validRuns.filter(
      (r) => r.metadata?.recordCount === 0
    ).length;

    const errorCount = validRuns.filter(
      (r) => r.metadata?.error !== undefined
    ).length;

    return { avgResolutionTime, failureCount, errorCount };
  }

  async createClient(
    config: DnsConfig
  ): Promise<ConnectedClient<DnsTransportClient>> {
    const validatedConfig = this.config.validate(config);
    const resolver = this.resolverFactory();

    if (validatedConfig.nameserver) {
      resolver.setServers([validatedConfig.nameserver]);
    }

    const client: DnsTransportClient = {
      exec: async (request: DnsLookupRequest): Promise<DnsLookupResult> => {
        const timeout = validatedConfig.timeout;
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DNS resolution timeout")), timeout)
        );

        try {
          const resolvePromise = this.resolveRecords(
            resolver,
            request.hostname,
            request.recordType
          );

          const values = await Promise.race([resolvePromise, timeoutPromise]);
          return { values };
        } catch (error) {
          return {
            values: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };

    return {
      client,
      close: () => {
        // DNS resolver is stateless, nothing to close
      },
    };
  }

  private async resolveRecords(
    resolver: DnsResolver,
    hostname: string,
    recordType: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS"
  ): Promise<string[]> {
    switch (recordType) {
      case "A": {
        return resolver.resolve4(hostname);
      }
      case "AAAA": {
        return resolver.resolve6(hostname);
      }
      case "CNAME": {
        return resolver.resolveCname(hostname);
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
        return resolver.resolveNs(hostname);
      }
    }
  }
}
