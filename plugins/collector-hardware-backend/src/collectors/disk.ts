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
import {
  healthResultNumber,
  healthResultString,
} from "@checkstack/healthcheck-common";
import {
  pluginMetadata as sshPluginMetadata,
  type SshTransportClient,
} from "@checkstack/healthcheck-ssh-common";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const diskConfigSchema = z.object({
  mountPoint: z
    .string()
    .default("/")
    .describe("Mount point to monitor (e.g., /, /home, /var)"),
});

export type DiskConfig = z.infer<typeof diskConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const diskResultSchema = z.object({
  filesystem: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Filesystem",
  }),
  totalGb: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Total Disk",
    "x-chart-unit": "GB",
  }),
  usedGb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Used Disk",
    "x-chart-unit": "GB",
  }),
  availableGb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Available Disk",
    "x-chart-unit": "GB",
  }),
  usedPercent: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Disk Usage",
    "x-chart-unit": "%",
  }),
  mountPoint: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Mount Point",
  }),
});

export type DiskResult = z.infer<typeof diskResultSchema>;

// Aggregated result fields definition
const diskAggregatedFields = {
  avgUsedPercent: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Disk Usage",
    "x-chart-unit": "%",
  }),
  maxUsedPercent: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Disk Usage",
    "x-chart-unit": "%",
  }),
};

// Type inferred from field definitions
export type DiskAggregatedResult = InferAggregatedResult<
  typeof diskAggregatedFields
>;

// ============================================================================
// DISK COLLECTOR
// ============================================================================

export class DiskCollector implements CollectorStrategy<
  SshTransportClient,
  DiskConfig,
  DiskResult,
  DiskAggregatedResult
> {
  id = "disk";
  displayName = "Disk Metrics";
  description = "Collects disk usage for a specific mount point via SSH";

  supportedPlugins = [sshPluginMetadata];

  config = new Versioned({ version: 1, schema: diskConfigSchema });
  result = new Versioned({ version: 1, schema: diskResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: diskAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: DiskConfig;
    client: SshTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<DiskResult>> {
    // Use df with specific mount point, output in 1G blocks
    const dfResult = await client.exec(`df -BG ${config.mountPoint} | tail -1`);
    const parsed = this.parseDfOutput(dfResult.stdout, config.mountPoint);

    return { result: parsed };
  }

  mergeResult(
    existing: DiskAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<DiskResult>,
  ): DiskAggregatedResult {
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
    };
  }

  // ============================================================================
  // PARSING HELPERS
  // ============================================================================

  private parseGb(val: string): number {
    // Remove 'G' suffix and parse
    return Number.parseInt(val.replace(/G$/i, ""), 10) || 0;
  }

  private parseDfOutput(output: string, mountPoint: string): DiskResult {
    // Format: Filesystem     1G-blocks  Used Available Use% Mounted on
    //         /dev/sda1          100G   45G       55G  45% /
    const parts = output.trim().split(/\s+/);

    const filesystem = parts[0] || "unknown";
    const totalGb = this.parseGb(parts[1]);
    const usedGb = this.parseGb(parts[2]);
    const availableGb = this.parseGb(parts[3]);
    const usedPercent = Number.parseInt(parts[4]?.replace(/%$/, ""), 10) || 0;

    return {
      filesystem,
      totalGb,
      usedGb,
      availableGb,
      usedPercent,
      mountPoint,
    };
  }

  private avg(nums: number[]): number {
    return (
      Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
    );
  }
}
