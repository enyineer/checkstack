import {
  Versioned,
  z,
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
  healthResultArray,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { DnsTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const lookupConfigSchema = z.object({
  hostname: z.string().min(1).describe("Hostname to resolve"),
  recordType: z
    .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS"])
    .default("A")
    .describe("DNS record type"),
  nameserver: z.string().optional().describe("Custom nameserver (optional)"),
});

export type LookupConfig = z.infer<typeof lookupConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const lookupResultSchema = healthResultSchema({
  values: healthResultArray({
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
});

export type LookupResult = z.infer<typeof lookupResultSchema>;

// Aggregated result fields definition
const lookupAggregatedFields = {
  avgResolutionTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Resolution Time",
    "x-chart-unit": "ms",
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
};

// Type inferred from field definitions
export type LookupAggregatedResult = InferAggregatedResult<
  typeof lookupAggregatedFields
>;

// ============================================================================
// LOOKUP COLLECTOR
// ============================================================================

/**
 * Built-in DNS lookup collector.
 * Resolves DNS records and checks results.
 */
export class LookupCollector implements CollectorStrategy<
  DnsTransportClient,
  LookupConfig,
  LookupResult,
  LookupAggregatedResult
> {
  id = "lookup";
  displayName = "DNS Lookup";
  description = "Resolve DNS records and check the results";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: lookupConfigSchema });
  result = new Versioned({ version: 1, schema: lookupResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: lookupAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: LookupConfig;
    client: DnsTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<LookupResult>> {
    const startTime = Date.now();

    const response = await client.exec({
      hostname: config.hostname,
      recordType: config.recordType,
    });

    const resolutionTimeMs = Date.now() - startTime;

    return {
      result: {
        values: response.values,
        recordCount: response.values.length,
        resolutionTimeMs,
      },
      error: response.error,
    };
  }

  mergeResult(
    existing: LookupAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<LookupResult>,
  ): LookupAggregatedResult {
    const metadata = run.metadata;

    // Merge success rate (recordCount > 0 means success)
    const isSuccess = (metadata?.recordCount ?? 0) > 0;

    return {
      avgResolutionTimeMs: mergeAverage(
        existing?.avgResolutionTimeMs,
        metadata?.resolutionTimeMs,
      ),
      successRate: mergeRate(existing?.successRate, isSuccess),
    };
  }
}
