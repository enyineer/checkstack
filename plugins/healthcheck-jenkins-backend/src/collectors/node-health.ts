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
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "../plugin-metadata";
import type { JenkinsTransportClient } from "../transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const nodeHealthConfigSchema = z.object({
  nodeName: z
    .string()
    .optional()
    .describe("Specific node name to check (leave empty for all nodes)"),
});

export type NodeHealthConfig = z.infer<typeof nodeHealthConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const nodeHealthResultSchema = z.object({
  // Near-constant echo of cluster size. A baseline over a constant is
  // meaningless and only fires on the tiniest jitter (e.g. a node added).
  totalNodes: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Total Nodes",
    "x-anomaly-enabled": false,
  }),
  // Cluster-wide online/offline counts drift with scaling and sit on a
  // near-constant (often near-zero) baseline, which is a poor fit for
  // learned anomaly detection. Node-down is surfaced via the per-node
  // nodeOffline dominance signal and the run-level error instead.
  onlineNodes: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Online Nodes",
    "x-anomaly-enabled": false,
  }),
  offlineNodes: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Offline Nodes",
    "x-anomaly-enabled": false,
  }),
  // Raw executor work counts swing with load and cluster size; the
  // utilization percentage below is the stable saturation signal.
  busyExecutors: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Busy Executors",
    "x-anomaly-enabled": false,
  }),
  idleExecutors: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Idle Executors",
    "x-anomaly-enabled": false,
  }),
  // Echo of provisioned capacity; near-constant, no meaningful baseline.
  totalExecutors: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Total Executors",
    "x-anomaly-enabled": false,
  }),
  // Saturation expressed as a percentage: stable, bounded, maps to a real
  // capacity problem. Kept enabled with a confirmation window and an
  // absolute floor of a few percent.
  executorUtilization: healthResultNumber({
    "x-chart-type": "gauge",
    "x-chart-label": "Executor Utilization",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
  // For single node mode
  nodeDisplayName: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Node Name",
    "x-anomaly-enabled": false,
  }).optional(),
  nodeOffline: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Node Offline",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }).optional(),
  nodeOfflineReason: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Offline Reason",
    "x-anomaly-enabled": false,
  }).optional(),
});

export type NodeHealthResult = z.infer<typeof nodeHealthResultSchema>;

// Aggregated result fields definition
const nodeHealthAggregatedFields = {
  // Online-node counts drift with cluster scaling and have no stable
  // baseline; node availability is covered by the per-node dominance signal.
  avgOnlineNodes: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Online Nodes",
    "x-anomaly-enabled": false,
  }),
  avgUtilization: aggregatedAverage({
    "x-chart-type": "gauge",
    "x-chart-label": "Avg Utilization",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 1.5,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
  minOnlineNodes: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Min Online Nodes",
    "x-anomaly-enabled": false,
  }),
};

// Type inferred from field definitions
export type NodeHealthAggregatedResult = InferAggregatedResult<
  typeof nodeHealthAggregatedFields
>;

// ============================================================================
// NODE HEALTH COLLECTOR
// ============================================================================

/**
 * Collector for Jenkins node/agent health.
 * Monitors node availability and executor utilization.
 */
export class NodeHealthCollector implements CollectorStrategy<
  JenkinsTransportClient,
  NodeHealthConfig,
  NodeHealthResult,
  NodeHealthAggregatedResult
> {
  id = "node-health";
  displayName = "Node Health";
  description = "Monitor Jenkins agent/node availability and executor usage";

  supportedPlugins = [pluginMetadata];
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: nodeHealthConfigSchema });
  result = new Versioned({ version: 1, schema: nodeHealthResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: nodeHealthAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: NodeHealthConfig;
    client: JenkinsTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<NodeHealthResult>> {
    // If checking a specific node
    if (config.nodeName) {
      return this.executeForSingleNode(config.nodeName, client);
    }

    // Otherwise, get all nodes
    return this.executeForAllNodes(client);
  }

  private async executeForSingleNode(
    nodeName: string,
    client: JenkinsTransportClient,
  ): Promise<CollectorResult<NodeHealthResult>> {
    const encodedName = encodeURIComponent(nodeName);
    const response = await client.exec({
      path: `/computer/${encodedName}/api/json`,
      query: {
        tree: "displayName,offline,offlineCauseReason,numExecutors,idle,temporarilyOffline",
      },
    });

    if (response.error) {
      return {
        result: {
          totalNodes: 0,
          onlineNodes: 0,
          offlineNodes: 0,
          busyExecutors: 0,
          idleExecutors: 0,
          totalExecutors: 0,
          executorUtilization: 0,
        },
        error: response.error,
      };
    }

    const data = response.data as {
      displayName?: string;
      offline?: boolean;
      offlineCauseReason?: string;
      numExecutors?: number;
      idle?: boolean;
      temporarilyOffline?: boolean;
    };

    const isOffline = data.offline ?? false;
    const numExecutors = data.numExecutors ?? 0;
    const busyExecutors = isOffline ? 0 : data.idle ? 0 : numExecutors;
    const idleExecutors = numExecutors - busyExecutors;

    const result: NodeHealthResult = {
      totalNodes: 1,
      onlineNodes: isOffline ? 0 : 1,
      offlineNodes: isOffline ? 1 : 0,
      busyExecutors,
      idleExecutors,
      totalExecutors: numExecutors,
      executorUtilization:
        numExecutors > 0 ? Math.round((busyExecutors / numExecutors) * 100) : 0,
      nodeDisplayName: data.displayName,
      nodeOffline: isOffline,
      nodeOfflineReason: data.offlineCauseReason,
    };

    return {
      result,
    };
  }

  private async executeForAllNodes(
    client: JenkinsTransportClient,
  ): Promise<CollectorResult<NodeHealthResult>> {
    const response = await client.exec({
      path: "/computer/api/json",
      query: {
        tree: "busyExecutors,computer[displayName,offline,numExecutors,idle],totalExecutors",
      },
    });

    if (response.error) {
      return {
        result: {
          totalNodes: 0,
          onlineNodes: 0,
          offlineNodes: 0,
          busyExecutors: 0,
          idleExecutors: 0,
          totalExecutors: 0,
          executorUtilization: 0,
        },
        error: response.error,
      };
    }

    const data = response.data as {
      busyExecutors?: number;
      totalExecutors?: number;
      computer?: Array<{
        displayName?: string;
        offline?: boolean;
        numExecutors?: number;
        idle?: boolean;
      }>;
    };

    const nodes = data.computer || [];
    const onlineNodes = nodes.filter((n) => !n.offline).length;
    const offlineNodes = nodes.filter((n) => n.offline).length;
    const totalExecutors = data.totalExecutors ?? 0;
    const busyExecutors = data.busyExecutors ?? 0;
    const idleExecutors = totalExecutors - busyExecutors;

    const result: NodeHealthResult = {
      totalNodes: nodes.length,
      onlineNodes,
      offlineNodes,
      busyExecutors,
      idleExecutors,
      totalExecutors,
      executorUtilization:
        totalExecutors > 0
          ? Math.round((busyExecutors / totalExecutors) * 100)
          : 0,
    };

    // Offline nodes are an ASSERTABLE METRIC (`offlineNodes`, `onlineNodes`),
    // NOT a collector failure: the request to Jenkins completed successfully
    // and we got the node list back. Whether some nodes being offline makes the
    // check unhealthy is the user's decision via assertions (e.g.
    // "offlineNodes equals 0"). Only a real transport failure (the request to
    // Jenkins could not complete - handled in the `response.error` branch
    // above) fails the collector.
    return {
      result,
    };
  }

  mergeResult(
    existing: NodeHealthAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<NodeHealthResult>,
  ): NodeHealthAggregatedResult {
    const metadata = run.metadata;

    return {
      avgOnlineNodes: mergeAverage(
        existing?.avgOnlineNodes,
        metadata?.onlineNodes,
      ),
      avgUtilization: mergeAverage(
        existing?.avgUtilization,
        metadata?.executorUtilization,
      ),
      minOnlineNodes: mergeMinMax(
        existing?.minOnlineNodes,
        metadata?.onlineNodes,
      ),
    };
  }
}
