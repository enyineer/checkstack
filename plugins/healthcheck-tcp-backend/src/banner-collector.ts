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
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { TcpTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const bannerConfigSchema = z.object({
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Timeout for banner read in milliseconds"),
});

export type BannerConfig = z.infer<typeof bannerConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const bannerResultSchema = healthResultSchema({
  banner: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Banner",
    "x-anomaly-enabled": false,
  }).optional(),
  hasBanner: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Has Banner",
    "x-chart-true-label": "present",
    "x-chart-false-label": "absent",
    // Whether a server emits a banner is protocol/configuration dependent and
    // can legitimately flip run-to-run (timing, quiet protocols, partial
    // reads). It does not map to a real availability problem on its own, so a
    // dominance flip here is an alert-fatigue source. Charting stays available;
    // alerting is off by default.
    "x-anomaly-enabled": false,
  }),
  readTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Read Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
});

export type BannerResult = z.infer<typeof bannerResultSchema>;

// Aggregated result fields definition
const bannerAggregatedFields = {
  avgReadTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Read Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Latency aggregate: widen the band and require practical-significance
    // floors so fast banner reads do not alert on small jitter.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  bannerRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Banner Rate",
    "x-chart-unit": "%",
    // Banner presence is protocol/configuration dependent and varies legitimately
    // run-to-run; its rate is not a real health signal and would alert on benign
    // fluctuation. Charting stays available; alerting is off by default.
    "x-anomaly-enabled": false,
  }),
};

// Type inferred from field definitions
export type BannerAggregatedResult = InferAggregatedResult<
  typeof bannerAggregatedFields
>;

// ============================================================================
// BANNER COLLECTOR
// ============================================================================

/**
 * Built-in TCP banner collector.
 * Reads the initial banner/greeting from a TCP server.
 */
export class BannerCollector implements CollectorStrategy<
  TcpTransportClient,
  BannerConfig,
  BannerResult,
  BannerAggregatedResult
> {
  id = "banner";
  displayName = "TCP Banner";
  description = "Read the initial banner/greeting from the server";

  supportedPlugins = [pluginMetadata];

  allowMultiple = false;

  config = new Versioned({ version: 1, schema: bannerConfigSchema });
  result = new Versioned({ version: 1, schema: bannerResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: bannerAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: BannerConfig;
    client: TcpTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<BannerResult>> {
    const startTime = Date.now();

    const response = await client.exec({
      type: "read",
      timeout: config.timeout,
    });

    const readTimeMs = Date.now() - startTime;

    return {
      result: {
        banner: response.banner,
        hasBanner: !!response.banner,
        readTimeMs,
      },
    };
  }

  mergeResult(
    existing: BannerAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<BannerResult>,
  ): BannerAggregatedResult {
    const metadata = run.metadata;

    return {
      avgReadTimeMs: mergeAverage(
        existing?.avgReadTimeMs,
        metadata?.readTimeMs,
      ),
      bannerRate: mergeRate(existing?.bannerRate, metadata?.hasBanner),
    };
  }
}
