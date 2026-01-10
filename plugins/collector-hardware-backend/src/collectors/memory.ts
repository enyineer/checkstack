import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
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
  }),
  usedMb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Used Memory",
    "x-chart-unit": "MB",
  }),
  freeMb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Free Memory",
    "x-chart-unit": "MB",
  }),
  usedPercent: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Memory Usage",
    "x-chart-unit": "%",
  }),
  swapUsedMb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Swap Used",
    "x-chart-unit": "MB",
  }).optional(),
  swapTotalMb: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Swap Total",
    "x-chart-unit": "MB",
  }).optional(),
});

export type MemoryResult = z.infer<typeof memoryResultSchema>;

const memoryAggregatedSchema = z.object({
  avgUsedPercent: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Memory Usage",
    "x-chart-unit": "%",
  }),
  maxUsedPercent: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Max Memory Usage",
    "x-chart-unit": "%",
  }),
  avgUsedMb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Avg Memory Used",
    "x-chart-unit": "MB",
  }),
});

export type MemoryAggregatedResult = z.infer<typeof memoryAggregatedSchema>;

// ============================================================================
// MEMORY COLLECTOR
// ============================================================================

export class MemoryCollector
  implements
    CollectorStrategy<
      SshTransportClient,
      MemoryConfig,
      MemoryResult,
      MemoryAggregatedResult
    >
{
  id = "memory";
  displayName = "Memory Metrics";
  description = "Collects RAM and swap usage via SSH";

  supportedPlugins = [sshPluginMetadata];

  config = new Versioned({ version: 1, schema: memoryConfigSchema });
  result = new Versioned({ version: 1, schema: memoryResultSchema });
  aggregatedResult = new Versioned({
    version: 1,
    schema: memoryAggregatedSchema,
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

  aggregateResult(
    runs: HealthCheckRunForAggregation<MemoryResult>[]
  ): MemoryAggregatedResult {
    const usedPercents = runs
      .map((r) => r.metadata?.usedPercent)
      .filter((v): v is number => typeof v === "number");

    const usedMbs = runs
      .map((r) => r.metadata?.usedMb)
      .filter((v): v is number => typeof v === "number");

    return {
      avgUsedPercent: usedPercents.length > 0 ? this.avg(usedPercents) : 0,
      maxUsedPercent: usedPercents.length > 0 ? Math.max(...usedPercents) : 0,
      avgUsedMb: usedMbs.length > 0 ? this.avg(usedMbs) : 0,
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
