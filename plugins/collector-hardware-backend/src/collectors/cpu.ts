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

const cpuConfigSchema = z.object({
  includeLoadAverage: z
    .boolean()
    .default(true)
    .describe("Include 1m, 5m, 15m load averages"),
  includeCoreCount: z
    .boolean()
    .default(true)
    .describe("Include number of CPU cores"),
});

export type CpuConfig = z.infer<typeof cpuConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const cpuResultSchema = z.object({
  usagePercent: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "CPU Usage",
    "x-chart-unit": "%",
  }),
  loadAvg1m: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Load (1m)",
  }).optional(),
  loadAvg5m: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Load (5m)",
  }).optional(),
  loadAvg15m: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Load (15m)",
  }).optional(),
  coreCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "CPU Cores",
  }).optional(),
});

export type CpuResult = z.infer<typeof cpuResultSchema>;

// Aggregated result fields definition
const cpuAggregatedFields = {
  avgUsagePercent: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg CPU Usage",
    "x-chart-unit": "%",
  }),
  maxUsagePercent: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max CPU Usage",
    "x-chart-unit": "%",
  }),
  avgLoadAvg1m: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Load (1m)",
  }),
};

// Type inferred from field definitions
export type CpuAggregatedResult = InferAggregatedResult<
  typeof cpuAggregatedFields
>;

// ============================================================================
// CPU COLLECTOR
// ============================================================================

export class CpuCollector implements CollectorStrategy<
  SshTransportClient,
  CpuConfig,
  CpuResult,
  CpuAggregatedResult
> {
  id = "cpu";
  displayName = "CPU Metrics";
  description = "Collects CPU usage, load averages, and core count via SSH";

  supportedPlugins = [sshPluginMetadata];

  config = new Versioned({ version: 1, schema: cpuConfigSchema });
  result = new Versioned({ version: 1, schema: cpuResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: cpuAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: CpuConfig;
    client: SshTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<CpuResult>> {
    // Get CPU usage from /proc/stat (two samples to calculate delta)
    const stat1 = await client.exec("cat /proc/stat | head -1");
    await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms sample
    const stat2 = await client.exec("cat /proc/stat | head -1");

    const usagePercent = this.calculateCpuUsage(stat1.stdout, stat2.stdout);

    const result: CpuResult = { usagePercent };

    // Get load averages
    if (config.includeLoadAverage) {
      const uptime = await client.exec("cat /proc/loadavg");
      const loads = this.parseLoadAvg(uptime.stdout);
      result.loadAvg1m = loads.load1m;
      result.loadAvg5m = loads.load5m;
      result.loadAvg15m = loads.load15m;
    }

    // Get core count
    if (config.includeCoreCount) {
      const nproc = await client.exec("nproc");
      result.coreCount = Number.parseInt(nproc.stdout.trim(), 10) || undefined;
    }

    return { result };
  }

  mergeResult(
    existing: CpuAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<CpuResult>,
  ): CpuAggregatedResult {
    const metadata = run.metadata;

    return {
      avgUsagePercent: mergeAverage(
        existing?.avgUsagePercent,
        metadata?.usagePercent,
      ),
      maxUsagePercent: mergeMinMax(
        existing?.maxUsagePercent,
        metadata?.usagePercent,
      ),
      avgLoadAvg1m: mergeAverage(existing?.avgLoadAvg1m, metadata?.loadAvg1m),
    };
  }

  // ============================================================================
  // PARSING HELPERS
  // ============================================================================

  private parseCpuStat(line: string): { idle: number; total: number } {
    // Format: cpu user nice system idle iowait irq softirq steal guest guest_nice
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + parts[4]; // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  }

  private calculateCpuUsage(stat1: string, stat2: string): number {
    const s1 = this.parseCpuStat(stat1);
    const s2 = this.parseCpuStat(stat2);

    const idleDelta = s2.idle - s1.idle;
    const totalDelta = s2.total - s1.total;

    if (totalDelta === 0) return 0;

    return Math.round(((totalDelta - idleDelta) / totalDelta) * 100 * 10) / 10;
  }

  private parseLoadAvg(output: string): {
    load1m?: number;
    load5m?: number;
    load15m?: number;
  } {
    // Format: 0.00 0.01 0.05 1/234 5678
    const parts = output.trim().split(/\s+/);
    return {
      load1m: Number.parseFloat(parts[0]) || undefined,
      load5m: Number.parseFloat(parts[1]) || undefined,
      load15m: Number.parseFloat(parts[2]) || undefined,
    };
  }

  private avg(nums: number[]): number {
    return (
      Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
    );
  }
}
