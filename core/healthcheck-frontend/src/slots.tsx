import { createSlot, createSlotExtension } from "@checkmate/frontend-api";
import type { PluginMetadata } from "@checkmate/common";
import type {
  HealthCheckRun,
  AggregatedBucket,
} from "@checkmate/healthcheck-common";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Extends HealthCheckRun with typed result instead of Record<string, unknown>.
 */
export type TypedHealthCheckRun<TResult> = Omit<HealthCheckRun, "result"> & {
  result: TResult;
};

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
 * Context for raw per-run data visualization.
 */
export interface RawDiagramContext<TResult = unknown> {
  type: "raw";
  systemId: string;
  configurationId: string;
  strategyId: string;
  runs: TypedHealthCheckRun<TResult>[];
}

/**
 * Context for aggregated bucket data visualization.
 */
export interface AggregatedDiagramContext<TAggregatedResult = unknown> {
  type: "aggregated";
  systemId: string;
  configurationId: string;
  strategyId: string;
  buckets: TypedAggregatedBucket<TAggregatedResult>[];
}

/**
 * Discriminated union context for diagram slots.
 * Platform provides either raw runs or aggregated buckets based on date range.
 */
export type HealthCheckDiagramSlotContext =
  | RawDiagramContext
  | AggregatedDiagramContext;

// =============================================================================
// SLOT DEFINITION
// =============================================================================

/**
 * Extension slot for custom health check diagrams.
 * Strategy plugins can contribute their own visualizations for check results.
 */
export const HealthCheckDiagramSlot = createSlot<HealthCheckDiagramSlotContext>(
  "healthcheck.diagram"
);

// =============================================================================
// FALLBACK COMPONENT
// =============================================================================

/**
 * Fallback shown when a strategy doesn't provide an aggregated component.
 */
function AggregatedFallback() {
  return (
    <div className="text-sm text-muted-foreground p-4 text-center border border-dashed rounded-md">
      Strategy does not support aggregated visualization.
      <br />
      Select a shorter time range for detailed per-run data.
    </div>
  );
}

// =============================================================================
// DIAGRAM EXTENSION FACTORY
// =============================================================================

/**
 * Factory that creates a pre-typed diagram extension helper for a strategy.
 * Strategies call this once in their common package to get a typed helper.
 *
 * @example
 * ```tsx
 * // In @checkmate/healthcheck-http-common
 * export const createHttpDiagramExtension = createDiagramExtensionFactory<
 *   HttpResult,
 *   HttpAggregatedResult
 * >(httpCheckMetadata);
 *
 * // In @checkmate/healthcheck-http-frontend
 * createHttpDiagramExtension({
 *   id: "http-check.response-chart",
 *   rawComponent: HttpRunsChart,
 *   aggregatedComponent: HttpAggregatedChart, // optional
 * });
 * ```
 */
export function createDiagramExtensionFactory<
  TResult = unknown,
  TAggregatedResult = unknown
>(strategyMetadata: PluginMetadata) {
  return function createDiagramExtension(options: {
    id: string;
    /** Component for raw per-run data (required) */
    rawComponent: React.ComponentType<RawDiagramContext<TResult>>;
    /** Component for aggregated bucket data (optional) */
    aggregatedComponent?: React.ComponentType<
      AggregatedDiagramContext<TAggregatedResult>
    >;
  }) {
    return createSlotExtension(HealthCheckDiagramSlot, {
      id: options.id,
      component: (ctx: HealthCheckDiagramSlotContext) => {
        // Only render for matching strategy
        if (ctx.strategyId !== strategyMetadata.pluginId) {
          return;
        }

        if (ctx.type === "raw") {
          const RawComponent = options.rawComponent;
          return <RawComponent {...(ctx as RawDiagramContext<TResult>)} />;
        }

        if (options.aggregatedComponent) {
          const AggComponent = options.aggregatedComponent;
          return (
            <AggComponent
              {...(ctx as AggregatedDiagramContext<TAggregatedResult>)}
            />
          );
        }

        // Fallback if no aggregated component provided
        return <AggregatedFallback />;
      },
    });
  };
}

// =============================================================================
// LEGACY API (for backwards compatibility)
// =============================================================================

/**
 * @deprecated Use createDiagramExtensionFactory instead for typed metadata.
 *
 * Legacy helper for creating strategy-specific diagram extensions.
 * Wraps the component with strategy ID filtering.
 */
export function createStrategyDiagramExtension(options: {
  id: string;
  forStrategies: PluginMetadata | PluginMetadata[];
  component: React.ComponentType<HealthCheckDiagramSlotContext>;
}) {
  const strategyIds = Array.isArray(options.forStrategies)
    ? options.forStrategies.map((m) => m.pluginId)
    : [options.forStrategies.pluginId];

  return createSlotExtension(HealthCheckDiagramSlot, {
    id: options.id,
    component: (ctx: HealthCheckDiagramSlotContext) => {
      if (!strategyIds.includes(ctx.strategyId)) {
        return;
      }
      return <options.component {...ctx} />;
    },
  });
}
