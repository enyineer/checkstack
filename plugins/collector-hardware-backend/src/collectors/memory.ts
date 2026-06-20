import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeMinMax,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import { healthResultNumber } from "@checkstack/healthcheck-common";
import {
  pluginMetadata as sshPluginMetadata,
  type SshTransportClient,
} from "@checkstack/healthcheck-ssh-common";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const memoryConfigSchema = z.object({
  includeSwap: z
    .boolean()
    .default(true)
    .describe("Include swap usage in results"),
  includeBuffersCache: z
    .boolean()
    .default(false)
    .describe("Include buffers/cache breakdown"),
});

export type MemoryConfig = z.infer<typeof memoryConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const memoryResultSchema = z.object({
  totalMb: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Total Memory",
    "x-chart-unit": "MB",
    "x-anomaly-enabled": false,
  }),
  usedMb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Used Memory",
    "x-chart-unit": "MB",
    // Off by default: absolute twin of usedPercent. The percent form is the
    // saturation signal that maps to a real problem; the MB value drifts with
    // workload without being a problem. Kept chartable.
    "x-anomaly-enabled": false,
  }),
  freeMb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Free Memory",
    "x-chart-unit": "MB",
    // Off by default: inverse of usedMb and therefore the same absolute twin
    // of usedPercent. Tracked via the percent form instead.
    "x-anomaly-enabled": false,
  }),
  usedPercent: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Memory Usage",
    "x-chart-unit": "%",
    // Percent saturation signal: the canonical memory pressure metric. Kept
    // enabled and widened toward fewer false positives.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
  swapUsedMb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Swap Used",
    "x-chart-unit": "MB",
    // Off by default: swap-used is usually flat near zero, so a learned
    // baseline is degenerate and the tiniest jitter fires. Swap activity is a
    // real concern but is better expressed as a static threshold than a
    // baseline anomaly. Kept chartable for opt-in.
    "x-anomaly-enabled": false,
  }).optional(),
  swapTotalMb: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Swap Total",
    "x-chart-unit": "MB",
    "x-anomaly-enabled": false,
  }).optional(),
});

export type MemoryResult = z.infer<typeof memoryResultSchema>;

// Aggregated result fields definition
const memoryAggregatedFields = {
  avgUsedPercent: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Memory Usage",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
  }),
  maxUsedPercent: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Memory Usage",
    "x-chart-unit": "%",
    // Off by default: a max rollup alerts on the single peak sample per
    // window. The avg rollup is the stable signal; this stays chartable.
    "x-anomaly-enabled": false,
  }),
  avgUsedMb: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Memory Used",
    "x-chart-unit": "MB",
    // Off by default: absolute twin of avgUsedPercent. Tracked via the
    // percent rollup instead.
    "x-anomaly-enabled": false,
  }),
};

// Type inferred from field definitions
export type MemoryAggregatedResult = InferAggregatedResult<
  typeof memoryAggregatedFields
>;

// ============================================================================
// MEMORY COLLECTOR
// ============================================================================

export class MemoryCollector implements CollectorStrategy<
  SshTransportClient,
  MemoryConfig,
  MemoryResult,
  MemoryAggregatedResult
> {
  id = "memory";
  displayName = "Memory Metrics";
  description = "Collects RAM and swap usage via SSH";

  supportedPlugins = [sshPluginMetadata];

  config = new Versioned({ version: 1, schema: memoryConfigSchema });
  result = new Versioned({ version: 1, schema: memoryResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: memoryAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: MemoryConfig;
    client: SshTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<MemoryResult>> {
    // Use free -m for memory in megabytes
    const freeResult = await client.exec("free -m");
    const parsed = this.parseFreeOutput(freeResult.stdout);

    const result: MemoryResult = {
      totalMb: parsed.totalMb,
      usedMb: parsed.usedMb,
      freeMb: parsed.freeMb,
      usedPercent: parsed.usedPercent,
    };

    if (config.includeSwap && parsed.swapTotalMb > 0) {
      result.swapTotalMb = parsed.swapTotalMb;
      result.swapUsedMb = parsed.swapUsedMb;
    }

    return { result };
  }

  mergeResult(
    existing: MemoryAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<MemoryResult>,
  ): MemoryAggregatedResult {
    const metadata = run.metadata;

    return {
      avgUsedPercent: mergeAverage(
        existing?.avgUsedPercent,
        metadata?.usedPercent,
      ),
      maxUsedPercent: mergeMinMax(
        existing?.maxUsedPercent,
        metadata?.usedPercent,
      ),
      avgUsedMb: mergeAverage(existing?.avgUsedMb, metadata?.usedMb),
    };
  }

  // ============================================================================
  // PARSING HELPERS
  // ============================================================================

  private parseFreeOutput(output: string): {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    usedPercent: number;
    swapTotalMb: number;
    swapUsedMb: number;
  } {
    // Format:
    //               total        used        free      shared  buff/cache   available
    // Mem:          15896        5234        1234         123        9428       10234
    // Swap:          4096         512        3584

    const lines = output.trim().split("\n");
    const memLine = lines.find((l) => l.startsWith("Mem:"));
    const swapLine = lines.find((l) => l.startsWith("Swap:"));

    const memParts = memLine?.split(/\s+/).map(Number) ?? [];
    const swapParts = swapLine?.split(/\s+/).map(Number) ?? [];

    const totalMb = memParts[1] || 0;
    const usedMb = memParts[2] || 0;
    const freeMb = memParts[3] || 0;
    const usedPercent =
      totalMb > 0 ? Math.round((usedMb / totalMb) * 100 * 10) / 10 : 0;

    return {
      totalMb,
      usedMb,
      freeMb,
      usedPercent,
      swapTotalMb: swapParts[1] || 0,
      swapUsedMb: swapParts[2] || 0,
    };
  }

  private avg(nums: number[]): number {
    return (
      Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
    );
  }
}
