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
    .regex(/^[\w/.:-]+$/, "Mount point contains invalid characters")
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
    "x-anomaly-enabled": false,
  }),
  totalGb: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Total Disk",
    "x-chart-unit": "GB",
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
  }),
  usedGb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Used Disk",
    "x-chart-unit": "GB",
    // Off by default: absolute twin of usedPercent. Saturation is tracked via
    // the percent form; the absolute GB value drifts with normal growth
    // without being a problem. Kept chartable.
    "x-anomaly-enabled": false,
    "x-chart-priority": 30,
    "x-chart-good-direction": "down",
  }),
  availableGb: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Available Disk",
    "x-chart-unit": "GB",
    // Off by default: inverse of usedGb and therefore the same absolute twin
    // of usedPercent. Tracked via the percent form instead.
    "x-anomaly-enabled": false,
    "x-chart-priority": 40,
    "x-chart-good-direction": "up",
  }),
  usedPercent: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Disk Usage",
    "x-chart-unit": "%",
    // Percent saturation signal: the canonical disk-fill metric. Disk usage
    // is slow-moving and the best-behaved of the saturation signals, so a
    // sudden baseline jump is a genuine anomaly. Kept enabled and widened.
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
    "x-chart-priority": 10,
  }),
  mountPoint: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Mount Point",
    "x-anomaly-enabled": false,
  }),
});

export type DiskResult = z.infer<typeof diskResultSchema>;

// Aggregated result fields definition
const diskAggregatedFields = {
  avgUsedPercent: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Disk Usage",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-chart-priority": 10,
  }),
  maxUsedPercent: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Max Disk Usage",
    "x-chart-unit": "%",
    // Off by default: a max rollup alerts on the single peak sample per
    // window. The avg rollup is the stable signal; this stays chartable.
    "x-anomaly-enabled": false,
    "x-chart-priority": 90,
    "x-chart-good-direction": "down",
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
    // SECURITY: Validate mount point against shell injection
    const SAFE_MOUNT_POINT_REGEX = /^[\w/.:-]+$/;
    if (!SAFE_MOUNT_POINT_REGEX.test(config.mountPoint)) {
      return {
        result: {
          filesystem: "error",
          totalGb: 0,
          usedGb: 0,
          availableGb: 0,
          usedPercent: 0,
          mountPoint: config.mountPoint,
        },
        error: `Invalid mount point: contains unsafe characters`,
      };
    }

    // Use df with specific mount point, output in 1G blocks
    // SECURITY: Use shell-escaped single quotes to prevent injection
    const escapedMountPoint = config.mountPoint.replaceAll(
      "'",
      String.raw`'\''`,
    );
    const dfResult = await client.exec(
      `df -BG '${escapedMountPoint}' | tail -1`,
    );
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
