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
  healthResultArray,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { DnsTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const lookupConfigSchema = z.object({
  // Templatable: supports `{{ environment.hostname }}` so one config covers N
  // environments. Presence is enforced POST-RENDER in `execute` (an empty
  // render must not silently resolve nothing and look healthy).
  hostname: configString({ "x-templatable": true })
    .min(1)
    .describe(
      "Hostname to resolve. Supports templating, e.g. {{ environment.hostname }}",
    ),
  recordType: z
    .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS"])
    .default("A")
    .describe("DNS record type"),
  // Templatable: an empty render falls back to the system default resolver.
  nameserver: configString({ "x-templatable": true })
    .optional()
    .describe(
      "Custom nameserver (optional). Supports templating, e.g. {{ environment.nameserver }}",
    ),
});

export type LookupConfig = z.infer<typeof lookupConfigSchema>;

/**
 * Post-render validator for the required `hostname`. The stored value is a
 * templatable string, so presence cannot be checked at store time; the executor
 * renders `{{ environment.* }}` per environment, then this rejects a render that
 * collapsed to empty/whitespace. An empty hostname is a config error that
 * prevents the probe from running - transport-failure semantics - not a
 * "healthy" empty resolution.
 */
const renderedRequiredSchema = z.string().trim().min(1);

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const lookupResultSchema = healthResultSchema({
  values: healthResultArray({
    "x-chart-type": "text",
    "x-chart-label": "Resolved Values",
    "x-chart-priority": 50,
    "x-anomaly-enabled": false,
  }),
  recordCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Record Count",
    "x-chart-priority": 90,
    // Off by default: the number of records a name returns legitimately
    // varies run to run (round-robin A sets, CDN rotation, MX/NS changes),
    // so a learned baseline over it produces alert fatigue rather than real
    // problems. Failed lookups are already covered by success rate. Still
    // chartable; users can opt in for names they know are fixed-size.
    "x-anomaly-enabled": false,
  }),
  resolutionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Resolution Time",
    "x-chart-unit": "ms",
    "x-chart-priority": 10,
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
});

export type LookupResult = z.infer<typeof lookupResultSchema>;

// Aggregated result fields definition
const lookupAggregatedFields = {
  avgResolutionTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Resolution Time",
    "x-chart-unit": "ms",
    "x-chart-priority": 10,
    // Bucket-averaged latency. Wider band plus debounce keeps a single slow
    // bucket from paging; floors avoid alerting on small absolute drift.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-chart-priority": 20,
    // Availability percent: the primary real-problem signal. Debounce one
    // bucket of transient dips and require a few percent of real drop before
    // alerting.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
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

    // Post-render guard: `hostname` is a templatable string, so `.min(1)` cannot
    // meaningfully run at store time against a template. The executor has already
    // rendered `{{ environment.* }}` into `config.hostname`; reject a render that
    // collapsed to empty so the run fails clearly as a transport/config error
    // instead of returning a "healthy" empty resolution.
    const hostname = renderedRequiredSchema.safeParse(config.hostname);
    if (!hostname.success) {
      return {
        result: {
          values: [],
          recordCount: 0,
          resolutionTimeMs: Date.now() - startTime,
        },
        error:
          `Rendered hostname is empty: ${JSON.stringify(config.hostname)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      };
    }

    const response = await client.exec({
      hostname: hostname.data,
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
