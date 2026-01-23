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
  }).optional(),
  hasBanner: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Has Banner",
  }),
  readTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Read Time",
    "x-chart-unit": "ms",
  }),
});

export type BannerResult = z.infer<typeof bannerResultSchema>;

// Aggregated result fields definition
const bannerAggregatedFields = {
  avgReadTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Read Time",
    "x-chart-unit": "ms",
  }),
  bannerRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Banner Rate",
    "x-chart-unit": "%",
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
