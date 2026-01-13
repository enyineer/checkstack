import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
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

const bannerAggregatedSchema = healthResultSchema({
  avgReadTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Read Time",
    "x-chart-unit": "ms",
  }),
  bannerRate: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Banner Rate",
    "x-chart-unit": "%",
  }),
});

export type BannerAggregatedResult = z.infer<typeof bannerAggregatedSchema>;

// ============================================================================
// BANNER COLLECTOR
// ============================================================================

/**
 * Built-in TCP banner collector.
 * Reads the initial banner/greeting from a TCP server.
 */
export class BannerCollector
  implements
    CollectorStrategy<
      TcpTransportClient,
      BannerConfig,
      BannerResult,
      BannerAggregatedResult
    >
{
  id = "banner";
  displayName = "TCP Banner";
  description = "Read the initial banner/greeting from the server";

  supportedPlugins = [pluginMetadata];

  allowMultiple = false;

  config = new Versioned({ version: 1, schema: bannerConfigSchema });
  result = new Versioned({ version: 1, schema: bannerResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: bannerAggregatedSchema,
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

  aggregateResult(
    runs: HealthCheckRunForAggregation<BannerResult>[]
  ): BannerAggregatedResult {
    const times = runs
      .map((r) => r.metadata?.readTimeMs)
      .filter((v): v is number => typeof v === "number");

    const hasBanners = runs
      .map((r) => r.metadata?.hasBanner)
      .filter((v): v is boolean => typeof v === "boolean");

    const bannerCount = hasBanners.filter(Boolean).length;

    return {
      avgReadTimeMs:
        times.length > 0
          ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
          : 0,
      bannerRate:
        hasBanners.length > 0
          ? Math.round((bannerCount / hasBanners.length) * 100)
          : 0,
    };
  }
}
