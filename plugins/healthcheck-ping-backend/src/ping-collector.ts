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
  // Echo of the configured probe count (`count`). A baseline over a near
  // constant is meaningless, so anomaly detection is off by default. Still
  // chartable; opt in if a probe count genuinely varies.
  packetsSent: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Sent",
    "x-chart-priority": 90,
    "x-anomaly-enabled": false,
  }),
  // Absolute twin of packetLoss. The percent form (packetLoss) is the better
  // signal because it is config independent, so this absolute count is off by
  // default to avoid duplicate, drift-prone alerts.
  packetsReceived: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Received",
    "x-chart-priority": 90,
    "x-anomaly-enabled": false,
  }),
  // Primary saturation signal: packet loss as a percent. Confirmation window
  // debounces single-sample blips; a few-percent absolute floor keeps tiny
  // jitter from alerting.
  packetLoss: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Packet Loss",
    "x-chart-unit": "%",
    "x-chart-priority": 20,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
  // Min latency barely moves and is the least operationally meaningful of the
  // three latency stats, so it is off by default. avgLatency is the kept signal.
  minLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Min Latency",
    "x-chart-unit": "ms",
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }).optional(),
  // Representative latency signal. Wider band plus a confirmation window and
  // both floors so fast endpoints do not alert on small jitter.
  avgLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
    "x-chart-priority": 10,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }).optional(),
  // Max latency is the spikiest of the three stats (single slow packet drives
  // it) and is a frequent false-positive source, so it is off by default.
  maxLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max Latency",
    "x-chart-unit": "ms",
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }).optional(),
});

export type PingResult = z.infer<typeof pingResultSchema>;

// Aggregated result fields definition
const pingAggregatedFields = {
  avgPacketLoss: aggregatedAverage({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Packet Loss",
    "x-chart-unit": "%",
    "x-chart-priority": 20,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
  avgLatency: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
    "x-chart-priority": 10,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
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
