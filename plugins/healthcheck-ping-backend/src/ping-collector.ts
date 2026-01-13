import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
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
  }),
  packetsReceived: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Received",
  }),
  packetLoss: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Packet Loss",
    "x-chart-unit": "%",
  }),
  minLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Min Latency",
    "x-chart-unit": "ms",
  }).optional(),
  avgLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
  }).optional(),
  maxLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max Latency",
    "x-chart-unit": "ms",
  }).optional(),
});

export type PingResult = z.infer<typeof pingResultSchema>;

const pingAggregatedSchema = healthResultSchema({
  avgPacketLoss: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Packet Loss",
    "x-chart-unit": "%",
  }),
  avgLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
  }),
});

export type PingAggregatedResult = z.infer<typeof pingAggregatedSchema>;

// ============================================================================
// PING COLLECTOR
// ============================================================================

/**
 * Built-in Ping collector.
 * Performs ICMP ping and checks latency.
 */
export class PingCollector
  implements
    CollectorStrategy<
      PingTransportClient,
      PingConfig,
      PingResult,
      PingAggregatedResult
    >
{
  id = "ping";
  displayName = "ICMP Ping";
  description = "Ping a host and check latency";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: pingConfigSchema });
  result = new Versioned({ version: 1, schema: pingResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: pingAggregatedSchema,
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

  aggregateResult(
    runs: HealthCheckRunForAggregation<PingResult>[]
  ): PingAggregatedResult {
    const losses = runs
      .map((r) => r.metadata?.packetLoss)
      .filter((v): v is number => typeof v === "number");

    const latencies = runs
      .map((r) => r.metadata?.avgLatency)
      .filter((v): v is number => typeof v === "number");

    return {
      avgPacketLoss:
        losses.length > 0
          ? Math.round(
              (losses.reduce((a, b) => a + b, 0) / losses.length) * 10
            ) / 10
          : 0,
      avgLatency:
        latencies.length > 0
          ? Math.round(
              (latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10
            ) / 10
          : 0,
    };
  }
}
