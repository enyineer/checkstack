import {
  HealthCheckStrategy,
  HealthCheckResult,
  HealthCheckRunForAggregation,
  Versioned,
  z,
  numericField,
  timeThresholdField,
  evaluateAssertions,
} from "@checkmate-monitor/backend-api";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Assertion schema for Ping health checks using shared factories.
 */
const pingAssertionSchema = z.discriminatedUnion("field", [
  numericField("packetLoss", { min: 0, max: 100 }),
  timeThresholdField("avgLatency"),
  timeThresholdField("maxLatency"),
  timeThresholdField("minLatency"),
]);

export type PingAssertion = z.infer<typeof pingAssertionSchema>;

/**
 * Configuration schema for Ping health checks.
 */
export const pingConfigSchema = z.object({
  host: z.string().describe("Hostname or IP address to ping"),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe("Number of ping packets to send"),
  timeout: z
    .number()
    .min(100)
    .default(5000)
    .describe("Timeout in milliseconds"),
  assertions: z
    .array(pingAssertionSchema)
    .optional()
    .describe("Conditions that must pass for a healthy result"),
});

export type PingConfig = z.infer<typeof pingConfigSchema>;

/**
 * Per-run result metadata.
 */
const pingResultSchema = z.object({
  packetsSent: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Sent",
  }),
  packetsReceived: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Packets Received",
  }),
  packetLoss: z.number().meta({
    "x-chart-type": "gauge",
    "x-chart-label": "Packet Loss",
    "x-chart-unit": "%",
  }),
  minLatency: z.number().optional().meta({
    "x-chart-type": "line",
    "x-chart-label": "Min Latency",
    "x-chart-unit": "ms",
  }),
  avgLatency: z.number().optional().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
  }),
  maxLatency: z.number().optional().meta({
    "x-chart-type": "line",
    "x-chart-label": "Max Latency",
    "x-chart-unit": "ms",
  }),
  failedAssertion: pingAssertionSchema.optional(),
  error: z.string().optional().meta({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }),
});

export type PingResult = z.infer<typeof pingResultSchema>;

/**
 * Aggregated metadata for buckets.
 */
const pingAggregatedSchema = z.object({
  avgPacketLoss: z.number().meta({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Packet Loss",
    "x-chart-unit": "%",
  }),
  avgLatency: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Latency",
    "x-chart-unit": "ms",
  }),
  maxLatency: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Max Latency",
    "x-chart-unit": "ms",
  }),
  errorCount: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

export type PingAggregatedResult = z.infer<typeof pingAggregatedSchema>;

// ============================================================================
// STRATEGY
// ============================================================================

export class PingHealthCheckStrategy
  implements HealthCheckStrategy<PingConfig, PingResult, PingAggregatedResult>
{
  id = "ping";
  displayName = "Ping Health Check";
  description = "ICMP ping check for network reachability and latency";

  config: Versioned<PingConfig> = new Versioned({
    version: 1,
    schema: pingConfigSchema,
  });

  result: Versioned<PingResult> = new Versioned({
    version: 1,
    schema: pingResultSchema,
  });

  aggregatedResult: Versioned<PingAggregatedResult> = new Versioned({
    version: 1,
    schema: pingAggregatedSchema,
  });

  aggregateResult(
    runs: HealthCheckRunForAggregation<PingResult>[]
  ): PingAggregatedResult {
    let totalPacketLoss = 0;
    let totalLatency = 0;
    let maxLatency = 0;
    let errorCount = 0;
    let validRuns = 0;

    for (const run of runs) {
      if (run.metadata?.error) {
        errorCount++;
        continue;
      }
      if (run.metadata) {
        totalPacketLoss += run.metadata.packetLoss ?? 0;
        if (run.metadata.avgLatency !== undefined) {
          totalLatency += run.metadata.avgLatency;
          validRuns++;
        }
        if (
          run.metadata.maxLatency !== undefined &&
          run.metadata.maxLatency > maxLatency
        ) {
          maxLatency = run.metadata.maxLatency;
        }
      }
    }

    return {
      avgPacketLoss: runs.length > 0 ? totalPacketLoss / runs.length : 0,
      avgLatency: validRuns > 0 ? totalLatency / validRuns : 0,
      maxLatency,
      errorCount,
    };
  }

  async execute(config: PingConfig): Promise<HealthCheckResult<PingResult>> {
    const validatedConfig = this.config.validate(config);
    const start = performance.now();

    try {
      const result = await this.runPing(
        validatedConfig.host,
        validatedConfig.count,
        validatedConfig.timeout
      );

      const latencyMs =
        result.avgLatency ?? Math.round(performance.now() - start);

      // Evaluate assertions using shared utility
      const failedAssertion = evaluateAssertions(validatedConfig.assertions, {
        packetLoss: result.packetLoss,
        avgLatency: result.avgLatency,
        maxLatency: result.maxLatency,
        minLatency: result.minLatency,
      });

      if (failedAssertion) {
        return {
          status: "unhealthy",
          latencyMs,
          message: `Assertion failed: ${failedAssertion.field} ${failedAssertion.operator} ${failedAssertion.value}`,
          metadata: { ...result, failedAssertion },
        };
      }

      // Check for packet loss without explicit assertion
      if (result.packetLoss === 100) {
        return {
          status: "unhealthy",
          latencyMs,
          message: `Host ${validatedConfig.host} is unreachable (100% packet loss)`,
          metadata: result,
        };
      }

      return {
        status: "healthy",
        latencyMs,
        message: `Ping to ${validatedConfig.host}: ${result.packetsReceived}/${
          result.packetsSent
        } packets, avg ${result.avgLatency?.toFixed(1)}ms`,
        metadata: result,
      };
    } catch (error: unknown) {
      const end = performance.now();
      const isError = error instanceof Error;
      return {
        status: "unhealthy",
        latencyMs: Math.round(end - start),
        message: isError ? error.message : "Ping failed",
        metadata: {
          packetsSent: validatedConfig.count,
          packetsReceived: 0,
          packetLoss: 100,
          error: isError ? error.name : "UnknownError",
        },
      };
    }
  }

  /**
   * Execute ping using Bun subprocess.
   * Uses system ping command for cross-platform compatibility.
   */
  private async runPing(
    host: string,
    count: number,
    timeout: number
  ): Promise<Omit<PingResult, "failedAssertion" | "error">> {
    const isMac = process.platform === "darwin";
    const args = isMac
      ? ["-c", String(count), "-W", String(Math.ceil(timeout / 1000)), host]
      : ["-c", String(count), "-W", String(Math.ceil(timeout / 1000)), host];

    const proc = Bun.spawn(["ping", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    // Parse ping output
    return this.parsePingOutput(output, count, exitCode);
  }

  /**
   * Parse ping command output to extract statistics.
   */
  private parsePingOutput(
    output: string,
    expectedCount: number,
    _exitCode: number
  ): Omit<PingResult, "failedAssertion" | "error"> {
    // Match statistics line: "X packets transmitted, Y received"
    const statsMatch = output.match(
      /(\d+) packets transmitted, (\d+) (?:packets )?received/
    );
    const packetsSent = statsMatch
      ? Number.parseInt(statsMatch[1], 10)
      : expectedCount;
    const packetsReceived = statsMatch ? Number.parseInt(statsMatch[2], 10) : 0;
    const packetLoss =
      packetsSent > 0
        ? Math.round(((packetsSent - packetsReceived) / packetsSent) * 100)
        : 100;

    // Match latency line: "min/avg/max" or "min/avg/max/mdev"
    const latencyMatch = output.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)/);

    const minLatency = latencyMatch
      ? Number.parseFloat(latencyMatch[1])
      : undefined;
    const avgLatency = latencyMatch
      ? Number.parseFloat(latencyMatch[2])
      : undefined;
    const maxLatency = latencyMatch
      ? Number.parseFloat(latencyMatch[3])
      : undefined;

    return {
      packetsSent,
      packetsReceived,
      packetLoss,
      minLatency,
      avgLatency,
      maxLatency,
    };
  }
}
