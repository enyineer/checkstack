import * as dns from "node:dns/promises";
import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedCounter,
  aggregatedAverage,
  mergeAverage,
  mergeCounter,
  z,
  type ConnectedClient,
  type TransportTimings,
  type InferAggregatedResult,
  baseStrategyConfigSchema,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultArray,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import type {
  DnsTransportClient,
  DnsLookupRequest,
  DnsLookupResult,
} from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for DNS health checks.
 * Resolver configuration only - action params moved to LookupCollector.
 */
export const dnsConfigSchema = baseStrategyConfigSchema.extend({
  nameserver: z.string().optional().describe("Custom nameserver (optional)"),
});

export type DnsConfig = z.infer<typeof dnsConfigSchema>;

// The migrate input is `unknown` per the versioning chain, so narrowing is
// done with `typeof`/`in` guards (no casts).

/** Type guard: the migrate input is a plain object whose keys can be probed. */
function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

/** Read a numeric `timeout` field from a legacy/current config blob. */
function readTimeout(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  const value = data.timeout;
  return typeof value === "number" ? value : undefined;
}

/** Read an optional string `nameserver` field from a config blob. */
function readNameserver(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const value = data.nameserver;
  return typeof value === "string" ? value : undefined;
}

/**
 * Per-run result metadata.
 */
const dnsResultSchema = healthResultSchema({
  resolvedValues: healthResultArray({
    "x-chart-type": "text",
    "x-chart-label": "Resolved Values",
    "x-anomaly-enabled": false,
  }),
  recordCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Record Count",
    // Off by default: the number of records a name returns legitimately
    // varies run to run (round-robin A sets, CDN rotation, MX/NS changes),
    // so a learned baseline over it produces alert fatigue rather than real
    // problems. Failed lookups are already covered by failure/error counts.
    // Still chartable; users can opt in for names they know are fixed-size.
    "x-anomaly-enabled": false,
  }),
  resolutionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Resolution Time",
    "x-chart-unit": "ms",
    // Latency is a stable, baseline-able signal. Err wider and debounce so a
    // single slow lookup does not page; floors keep fast resolvers from
    // alerting on small absolute jitter.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type DnsResult = z.infer<typeof dnsResultSchema>;

/** Aggregated field definitions for bucket merging */
const dnsAggregatedFields = {
  avgResolutionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Resolution Time",
    "x-chart-unit": "ms",
    // Bucket-averaged latency. Wider band plus debounce keeps a single slow
    // bucket from paging; floors avoid alerting on small absolute drift.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  failureCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Failures",
    // Failed lookups per bucket map to a real availability problem. Debounce
    // a single bucket and require at least one failure above baseline so
    // healthy buckets stay quiet.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 1,
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Resolver errors per bucket map to a real problem. Debounce a single
    // bucket and require at least one error above baseline.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 1,
  }),
};

type DnsAggregatedResult = InferAggregatedResult<typeof dnsAggregatedFields>;

// ============================================================================
// RESOLVER INTERFACE (for testability)
// ============================================================================

export interface DnsResolver {
  setServers(servers: string[]): void;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  resolveCname(hostname: string): Promise<string[]>;
  resolveMx(
    hostname: string,
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

export class DnsHealthCheckStrategy implements HealthCheckStrategy<
  DnsConfig,
  DnsTransportClient,
  DnsResult,
  typeof dnsAggregatedFields
> {
  id = "dns";
  displayName = "DNS Health Check";
  description = "DNS record resolution with response validation";
  category = StrategyCategory.NETWORKING;

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
        // IDEMPOTENT: only a genuine v1 blob still carries hostname/recordType.
        // An already-v2 blob (`{ nameserver?, timeout }`) passes through.
        migrate: (data: unknown): unknown => {
          if (isRecord(data) && ("hostname" in data || "recordType" in data)) {
            return {
              nameserver: readNameserver(data),
              timeout: readTimeout(data),
            };
          }
          return data;
        },
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

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: dnsAggregatedFields,
  });

  mergeResult(
    existing: DnsAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<DnsResult>,
  ): DnsAggregatedResult {
    const metadata = run.metadata;

    // Merge resolution time average
    const avgResolutionTime = mergeAverage(
      existing?.avgResolutionTime,
      metadata?.resolutionTimeMs,
    );

    // Merge failure count
    const isFailure = metadata?.recordCount === 0;
    const failureCount = mergeCounter(existing?.failureCount, isFailure);

    // Merge error count
    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    return { avgResolutionTime, failureCount, errorCount };
  }

  async createClient(
    config: DnsConfig,
  ): Promise<ConnectedClient<DnsTransportClient>> {
    const validatedConfig = this.config.validate(config);
    const resolver = this.resolverFactory();

    if (validatedConfig.nameserver) {
      resolver.setServers([validatedConfig.nameserver]);
    }

    // Mutable holder: the DNS lookup happens per-exec (no persistent
    // connection), so the resolution time is measured there and surfaced as
    // the `dnsMs` phase for the executor (last-request-wins).
    const timings: TransportTimings = {};

    const client: DnsTransportClient = {
      exec: async (request: DnsLookupRequest): Promise<DnsLookupResult> => {
        const timeout = validatedConfig.timeout;
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("DNS resolution timeout")),
            timeout,
          ),
        );

        const start = performance.now();
        try {
          const resolvePromise = this.resolveRecords(
            resolver,
            request.hostname,
            request.recordType,
          );

          const values = await Promise.race([resolvePromise, timeoutPromise]);
          timings.dnsMs = Math.max(0, Math.round(performance.now() - start));
          return { values };
        } catch (error) {
          // A failed lookup still took time; record it so a slow-then-failing
          // resolver still surfaces a DNS phase.
          timings.dnsMs = Math.max(0, Math.round(performance.now() - start));
          return {
            values: [],
            error: extractErrorMessage(error),
          };
        }
      },
    };

    return {
      client,
      timings,
      close: () => {
        // DNS resolver is stateless, nothing to close
      },
    };
  }

  private async resolveRecords(
    resolver: DnsResolver,
    hostname: string,
    recordType: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS",
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
