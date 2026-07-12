import { createSlot, createSlotExtension } from "@checkstack/frontend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { AggregatedBucket } from "@checkstack/healthcheck-common";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Extends AggregatedBucket with typed aggregatedResult.
 */
export type TypedAggregatedBucket<TAggregatedResult> = Omit<
  AggregatedBucket,
  "aggregatedResult"
> & {
  aggregatedResult?: TAggregatedResult;
};

/**
 * Context for health check diagram visualization.
 * Always contains aggregated bucket data for consistent chart rendering.
 */
export interface HealthCheckDiagramSlotContext<TAggregatedResult = unknown> {
  systemId: string;
  configurationId: string;
  strategyId: string;
  buckets: TypedAggregatedBucket<TAggregatedResult>[];
}

// =============================================================================
// SLOT DEFINITION
// =============================================================================

/**
 * Extension slot for custom health check diagrams.
 * Strategy plugins can contribute their own visualizations for check results.
 *
 * The context always contains aggregated bucket data. The platform's
 * cross-tier aggregation engine automatically selects the appropriate
 * data source (raw, hourly, or daily) and aggregates it to a fixed
 * number of target points for consistent chart rendering.
 */
export const HealthCheckDiagramSlot = createSlot<HealthCheckDiagramSlotContext>(
  "healthcheck.diagram",
);

export interface AssignmentIDEContext {
  systemId: string;
  configurationId: string;
  selectedNode: string | undefined;
  onSelectNode: (nodeId: string) => void;
  isLocked?: boolean;
}

/**
 * Extension slot for adding per-assignment items to the check editor's
 * Assignment section (one slot mount per assigned system). The context keeps
 * the historic `(systemId, configurationId)` pair; `selectedNode` /
 * `onSelectNode` are ADAPTED per system - an extension sees its own node ids
 * unchanged (e.g. `anomaly:<configId>`), while the editor namespaces them by
 * system so identical extension ids under different systems don't collide.
 * See `components/assignments/assignment-node.logic.ts`.
 */
export const AssignmentIDENodeSlot = createSlot<AssignmentIDEContext>(
  "healthcheck.assignment.ide.node"
);

/**
 * Panel counterpart of {@link AssignmentIDENodeSlot}: rendered when a
 * per-system extension node is selected, with the same adapted context.
 */
export const AssignmentIDEPanelSlot = createSlot<AssignmentIDEContext>(
  "healthcheck.assignment.ide.panel"
);

export interface HealthCheckConfigIDEContext {
  configurationId: string;
  strategyId: string;
  selectedNode: string | undefined;
  onSelectNode: (nodeId: string) => void;
  isLocked?: boolean;
}

/**
 * Extension slot for adding items to the Health Check Configuration IDE tree
 */
export const HealthCheckConfigIDENodeSlot = createSlot<HealthCheckConfigIDEContext>(
  "healthcheck.config.ide.node"
);

/**
 * Extension slot for rendering the panel of a Health Check Configuration IDE item
 */
export const HealthCheckConfigIDEPanelSlot = createSlot<HealthCheckConfigIDEContext>(
  "healthcheck.config.ide.panel"
);

// =============================================================================
// DIAGRAM EXTENSION FACTORY
// =============================================================================

/**
 * Factory that creates a pre-typed diagram extension helper for a strategy.
 * Strategies call this once in their common package to get a typed helper.
 *
 * @example
 * ```tsx
 * // In @checkstack/healthcheck-http-common
 * export const createHttpDiagramExtension = createDiagramExtensionFactory<
 *   HttpAggregatedResult
 * >(httpCheckMetadata);
 *
 * // In @checkstack/healthcheck-http-frontend
 * createHttpDiagramExtension({
 *   id: "http-check.response-chart",
 *   component: HttpAggregatedChart,
 * });
 * ```
 */
export function createDiagramExtensionFactory<TAggregatedResult = unknown>(
  strategyMetadata: PluginMetadata,
) {
  return function createDiagramExtension(options: {
    id: string;
    /** Component for aggregated bucket data visualization */
    component: React.ComponentType<
      HealthCheckDiagramSlotContext<TAggregatedResult>
    >;
  }) {
    return createSlotExtension(HealthCheckDiagramSlot, {
      id: options.id,
      component: (ctx: HealthCheckDiagramSlotContext) => {
        // Only render for matching strategy
        if (ctx.strategyId !== strategyMetadata.pluginId) {
          return;
        }

        const Component = options.component;
        return (
          <Component
            {...(ctx as HealthCheckDiagramSlotContext<TAggregatedResult>)}
          />
        );
      },
    });
  };
}
