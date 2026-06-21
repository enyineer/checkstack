import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  aggregatedCounter,
  mergeAverage,
  mergeCounter,
  mergeMinMax,
  z,
  type ConnectedClient,
  type InferAggregatedResult,
  baseStrategyConfigSchema,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import type {
  PingTransportClient,
  PingRequest,
  PingResult as PingResultType,
} from "./transport-client";
import { extractErrorMessage } from "@checkstack/common";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration schema for Ping health checks.
 * Global defaults only - action params moved to PingCollector.
 */
export const pingConfigSchema = baseStrategyConfigSchema.extend({});

export type PingConfig = z.infer<typeof pingConfigSchema>;

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

/**
 * Per-run result metadata.
 */
const pingResultSchema = healthResultSchema({
  // Echo of the configured probe count (`count`). A baseline over a near
  // constant is meaningless, so anomaly detection is off by default. Still
  // chartable; opt in if a probe count genuinely varies.
  packetsSent: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Sent",
    "x-anomaly-enabled": false,
  }),
  // Absolute twin of packetLoss. The percent form (packetLoss) is the better
  // signal because it is config independent, so this absolute count is off by
  // default to avoid duplicate, drift-prone alerts.
  packetsReceived: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Received",
    "x-anomaly-enabled": false,
  }),
  // Primary saturation signal: packet loss as a percent. Confirmation window
  // debounces single-sample blips; a few-percent absolute floor keeps tiny
  // jitter from alerting.
  packetLoss: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Packet Loss",
    "x-chart-unit": "%",
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
    "x-anomaly-enabled": false,
  }).optional(),
  // Representative latency signal. Wider band plus a confirmation window and
  // both floors so fast endpoints do not alert on small jitter.
  avgLatency: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
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
    "x-anomaly-enabled": false,
  }).optional(),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type PingResult = z.infer<typeof pingResultSchema>;

/** Aggregated field definitions for bucket merging */
const pingAggregatedFields = {
  avgPacketLoss: aggregatedAverage({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Packet Loss",
    "x-chart-unit": "%",
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
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  // Bucket max of per-run max latency: doubly spiky (max of maxes), so it is
  // off by default to avoid alert fatigue. Still chartable.
  maxLatency: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Latency",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": false,
  }),
  // Count of runs in the bucket that errored. Clear direction and a meaningful
  // distribution, kept enabled with a confirmation window and a small absolute
  // floor so a single transient error does not alert.
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 1,
  }),
};

type PingAggregatedResult = InferAggregatedResult<typeof pingAggregatedFields>;

// ============================================================================
// STRATEGY
// ============================================================================

export class PingHealthCheckStrategy implements HealthCheckStrategy<
  PingConfig,
  PingTransportClient,
  PingResult,
  typeof pingAggregatedFields
> {
  id = "ping";
  displayName = "Ping Health Check";
  description = "ICMP ping check for network reachability and latency";
  category = StrategyCategory.NETWORKING;

  config: Versioned<PingConfig> = new Versioned({
    version: 2,
    schema: pingConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Remove host/count (moved to PingCollector)",
        // IDEMPOTENT: only a genuine v1 blob still carries host/count. An
        // already-v2 blob (just `{ timeout }`) passes through untouched.
        migrate: (data: unknown): unknown => {
          if (isRecord(data) && ("host" in data || "count" in data)) {
            return { timeout: readTimeout(data) };
          }
          return data;
        },
      },
    ],
  });

  result: Versioned<PingResult> = new Versioned({
    version: 2,
    schema: pingResultSchema,
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
    fields: pingAggregatedFields,
  });

  mergeResult(
    existing: PingAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<PingResult>,
  ): PingAggregatedResult {
    const metadata = run.metadata;

    const avgPacketLoss = mergeAverage(
      existing?.avgPacketLoss,
      metadata?.packetLoss,
    );

    const avgLatency = mergeAverage(existing?.avgLatency, metadata?.avgLatency);

    const maxLatency = mergeMinMax(existing?.maxLatency, metadata?.maxLatency);

    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);

    return { avgPacketLoss, avgLatency, maxLatency, errorCount };
  }

  async createClient(
    config: PingConfig,
  ): Promise<ConnectedClient<PingTransportClient>> {
    const validatedConfig = this.config.validate(config);

    const client: PingTransportClient = {
      exec: async (request: PingRequest): Promise<PingResultType> => {
        return this.runPing(
          request.host,
          request.count,
          request.timeout ?? validatedConfig.timeout,
        );
      },
    };

    return {
      client,
      close: () => {
        // Ping is stateless, nothing to close
      },
    };
  }

  private async runPing(
    host: string,
    count: number,
    timeout: number,
  ): Promise<PingResultType> {
    const isMac = process.platform === "darwin";
    const args = isMac
      ? ["-c", String(count), "-W", String(Math.ceil(timeout / 1000)), host]
      : ["-c", String(count), "-W", String(Math.ceil(timeout / 1000)), host];

    try {
      const proc = Bun.spawn({
        cmd: ["ping", ...args],
        stdout: "pipe",
        stderr: "pipe",
        env: {
          // SECURITY: Only pass necessary env vars to subprocess
          PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: process.env.HOME ?? "/tmp",
          LANG: process.env.LANG ?? "en_US.UTF-8",
        },
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      return this.parsePingOutput(output, count, exitCode);
    } catch (error_) {
      const error = extractErrorMessage(error_);
      return {
        packetsSent: count,
        packetsReceived: 0,
        packetLoss: 100,
        error,
      };
    }
  }

  private parsePingOutput(
    output: string,
    expectedCount: number,
    _exitCode: number,
  ): PingResultType {
    // Parse packet statistics
    const statsMatch = output.match(
      /(\d+) packets transmitted, (\d+) (?:packets )?received/,
    );
    const packetsSent = statsMatch
      ? Number.parseInt(statsMatch[1], 10)
      : expectedCount;
    const packetsReceived = statsMatch ? Number.parseInt(statsMatch[2], 10) : 0;
    const packetLoss =
      packetsSent > 0
        ? Math.round(((packetsSent - packetsReceived) / packetsSent) * 100)
        : 100;

    // Parse latency statistics (format varies by OS)
    // macOS: round-trip min/avg/max/stddev = 0.043/0.059/0.082/0.016 ms
    // Linux: rtt min/avg/max/mdev = 0.039/0.049/0.064/0.009 ms
    const latencyMatch = output.match(
      /(?:round-trip|rtt) min\/avg\/max\/(?:stddev|mdev) = ([\d.]+)\/([\d.]+)\/([\d.]+)/,
    );

    let minLatency: number | undefined;
    let avgLatency: number | undefined;
    let maxLatency: number | undefined;

    if (latencyMatch) {
      minLatency = Number.parseFloat(latencyMatch[1]);
      avgLatency = Number.parseFloat(latencyMatch[2]);
      maxLatency = Number.parseFloat(latencyMatch[3]);
    }

    return {
      packetsSent,
      packetsReceived,
      packetLoss,
      minLatency,
      avgLatency,
      maxLatency,
      ...(packetLoss === 100 && {
        error: "Host unreachable or 100% packet loss",
      }),
    };
  }
}
