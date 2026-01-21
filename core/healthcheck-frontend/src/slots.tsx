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
