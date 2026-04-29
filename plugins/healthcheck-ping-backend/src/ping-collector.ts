import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  VersionedAggregated,
  aggregatedAverage,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { PingTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const pingConfigSchema = z.object({
  host: z.string().min(1).describe("Hostname or IP address to ping"),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe("Number of ping packets"),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Timeout in milliseconds"),
});

export type PingConfig = z.infer<typeof pingConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const pingResultSchema = healthResultSchema({
  packetsSent: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Sent",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "deviation",
  }),
  packetsReceived: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Received",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
  }),
  packetLoss: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Packet Loss",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
  minLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Min Latency",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }).optional(),
  avgLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }).optional(),
  maxLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max Latency",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }).optional(),
});

export type PingResult = z.infer<typeof pingResultSchema>;

// Aggregated result fields definition
const pingAggregatedFields = {
  avgPacketLoss: aggregatedAverage({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Packet Loss",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
  avgLatency: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
};

// Type inferred from field definitions
export type PingAggregatedResult = InferAggregatedResult<
  typeof pingAggregatedFields
>;

// ============================================================================
// PING COLLECTOR
// ============================================================================

/**
 * Built-in Ping collector.
 * Performs ICMP ping and checks latency.
 */
export class PingCollector implements CollectorStrategy<
  PingTransportClient,
  PingConfig,
  PingResult,
  PingAggregatedResult
> {
  id = "ping";
  displayName = "ICMP Ping";
  description = "Ping a host and check latency";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: pingConfigSchema });
  result = new Versioned({ version: 1, schema: pingResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: pingAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: PingConfig;
    client: PingTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<PingResult>> {
    const response = await client.exec({
      host: config.host,
      count: config.count,
      timeout: config.timeout,
    });

    return {
      result: {
        packetsSent: response.packetsSent,
        packetsReceived: response.packetsReceived,
        packetLoss: response.packetLoss,
        minLatency: response.minLatency,
        avgLatency: response.avgLatency,
        maxLatency: response.maxLatency,
      },
      error: response.error,
    };
  }

  mergeResult(
    existing: PingAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<PingResult>,
  ): PingAggregatedResult {
    const metadata = run.metadata;

    return {
      avgPacketLoss: mergeAverage(
        existing?.avgPacketLoss,
        metadata?.packetLoss,
      ),
      avgLatency: mergeAverage(existing?.avgLatency, metadata?.avgLatency),
    };
  }
}
