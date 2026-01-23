/**
 * Type-safe aggregated result schema factories.
 *
 * These factories create aggregated result fields that automatically pair
 * display fields with their internal state, enabling proper merging when
 * combining buckets.
 */

import { z, type ZodTypeAny } from "zod";
import type { HealthResultMeta } from "@checkstack/common";
import { healthResultRegistry } from "@checkstack/healthcheck-common";
import {
  mergeAverageStates,
  mergeRateStates,
  mergeCounterStates,
  mergeMinMaxStates,
  type AverageState,
  type AverageStateInput,
  type RateState,
  type RateStateInput,
  type CounterState,
  type CounterStateInput,
  type MinMaxState,
  type MinMaxStateInput,
} from "./incremental-aggregation";
import { Versioned, type Migration } from "./config-versioning";

// =============================================================================
// AGGREGATION TYPE ENUM
// =============================================================================

/**
 * Types of aggregation supported by the system.
 * Each type has a corresponding internal state schema and merge function.
 */
export type AggregationType = "average" | "rate" | "counter" | "minmax";

// =============================================================================
// AGGREGATED FIELD TYPES
// =============================================================================

/** Base metadata for chart annotations (excludes x-jsonpath) */
type ChartMeta = Omit<HealthResultMeta, "x-jsonpath">;

/**
 * Base interface for aggregated field definitions.
 * TState is the output type (with _type), TStateInput is the input type (without _type).
 */
interface AggregatedFieldBase<TState, TStateInput> {
  type: AggregationType;
  stateSchema: ZodTypeAny;
  meta: ChartMeta;
  mergeStates: (a: TStateInput, b: TStateInput) => TState;
  getDisplayValue: (state: TStateInput) => number;
  getInitialState: () => TState;
}

export interface AggregatedAverageField extends AggregatedFieldBase<AverageState, AverageStateInput> {
  type: "average";
}

export interface AggregatedRateField extends AggregatedFieldBase<RateState, RateStateInput> {
  type: "rate";
}

export interface AggregatedCounterField extends AggregatedFieldBase<CounterState, CounterStateInput> {
  type: "counter";
}

export interface AggregatedMinMaxField extends AggregatedFieldBase<MinMaxState, MinMaxStateInput> {
  type: "minmax";
  getMinValue: (state: MinMaxStateInput) => number;
  getMaxValue: (state: MinMaxStateInput) => number;
}

export type AggregatedField =
  | AggregatedAverageField
  | AggregatedRateField
  | AggregatedCounterField
  | AggregatedMinMaxField;

// =============================================================================
// TYPE INFERENCE UTILITIES
// =============================================================================

/**
 * Get the internal state type for a field.
 */
type InferFieldState<T extends AggregatedField> =
  T extends AggregatedAverageField
    ? AverageState
    : T extends AggregatedRateField
      ? RateState
      : T extends AggregatedCounterField
        ? CounterState
        : T extends AggregatedMinMaxField
          ? MinMaxState
          : never;

/**
 * Infer the aggregated result type from field definitions.
 * Each field key maps directly to its state type.
 *
 * @example
 * ```typescript
 * const fields = {
 *   avgResponseTimeMs: aggregatedAverage({...}),
 *   successRate: aggregatedRate({...}),
 * };
 * type Result = InferAggregatedResult<typeof fields>;
 * // Result = {
 * //   avgResponseTimeMs: AverageState;
 * //   successRate: RateState;
 * // }
 * ```
 */
export type InferAggregatedResult<T extends AggregatedResultShape> = {
  [K in keyof T]: InferFieldState<T[K]>;
};

/**
 * Create an aggregated average field.
 *
 * @example
 * ```typescript
 * const fields = {
 *   avgResponseTimeMs: aggregatedAverage({
 *     "x-chart-type": "line",
 *     "x-chart-label": "Avg Response Time",
 *     "x-chart-unit": "ms",
 *   }),
 * };
 * ```
 */
export function aggregatedAverage(meta: ChartMeta): AggregatedAverageField {
  // Create fresh schema instance so each field gets its own chart metadata
  const stateSchema = z.object({
    _type: z.literal("average"),
    _sum: z.number(),
    _count: z.number(),
    avg: z.number(),
  });
  // Register chart metadata for this field
  stateSchema.register(healthResultRegistry, meta);

  return {
    type: "average",
    stateSchema,
    meta,
    mergeStates: mergeAverageStates,
    getDisplayValue: (state) => state.avg,
    getInitialState: () => ({
      _type: "average" as const,
      _sum: 0,
      _count: 0,
      avg: 0,
    }),
  };
}

/**
 * Create an aggregated rate/percentage field.
 *
 * @example
 * ```typescript
 * const fields = {
 *   successRate: aggregatedRate({
 *     "x-chart-type": "gauge",
 *     "x-chart-label": "Success Rate",
 *     "x-chart-unit": "%",
 *   }),
 * };
 * ```
 */
export function aggregatedRate(meta: ChartMeta): AggregatedRateField {
  // Create fresh schema instance so each field gets its own chart metadata
  const stateSchema = z.object({
    _type: z.literal("rate"),
    _success: z.number(),
    _total: z.number(),
    rate: z.number(),
  });
  // Register chart metadata for this field
  stateSchema.register(healthResultRegistry, meta);

  return {
    type: "rate",
    stateSchema,
    meta,
    mergeStates: mergeRateStates,
    getDisplayValue: (state) => state.rate,
    getInitialState: () => ({
      _type: "rate" as const,
      _success: 0,
      _total: 0,
      rate: 0,
    }),
  };
}

/**
 * Create an aggregated counter field.
 *
 * @example
 * ```typescript
 * const fields = {
 *   errorCount: aggregatedCounter({
 *     "x-chart-type": "counter",
 *     "x-chart-label": "Errors",
 *   }),
 * };
 * ```
 */
export function aggregatedCounter(meta: ChartMeta): AggregatedCounterField {
  // Create fresh schema instance so each field gets its own chart metadata
  const stateSchema = z.object({
    _type: z.literal("counter"),
    count: z.number(),
  });
  // Register chart metadata for this field
  stateSchema.register(healthResultRegistry, meta);

  return {
    type: "counter",
    stateSchema,
    meta,
    mergeStates: mergeCounterStates,
    getDisplayValue: (state) => state.count,
    getInitialState: () => ({ _type: "counter" as const, count: 0 }),
  };
}

/**
 * Create an aggregated min/max field.
 *
 * @example
 * ```typescript
 * const fields = {
 *   latencyRange: aggregatedMinMax({
 *     "x-chart-type": "line",
 *     "x-chart-label": "Latency Range",
 *     "x-chart-unit": "ms",
 *   }),
 * };
 * ```
 */
export function aggregatedMinMax(meta: ChartMeta): AggregatedMinMaxField {
  // Create fresh schema instance so each field gets its own chart metadata
  const stateSchema = z.object({
    _type: z.literal("minmax"),
    min: z.number(),
    max: z.number(),
  });
  // Register chart metadata for this field
  stateSchema.register(healthResultRegistry, meta);

  return {
    type: "minmax",
    stateSchema,
    meta,
    mergeStates: mergeMinMaxStates,
    getDisplayValue: (state) => state.max, // Default to max
    getMinValue: (state) => state.min,
    getMaxValue: (state) => state.max,
    getInitialState: () => ({ _type: "minmax" as const, min: 0, max: 0 }),
  };
}

// =============================================================================
// AGGREGATED RESULT SCHEMA BUILDER
// =============================================================================

/**
 * Definition for aggregated result schema.
 * Maps display field names to their aggregated field configurations.
 */
export type AggregatedResultShape = Record<string, AggregatedField>;

/**
 * Registry to store field definitions for lookup during merge operations.
 */
const fieldRegistry = new WeakMap<ZodTypeAny, AggregatedResultShape>();

/**
 * Build a Zod schema for aggregated results.
 * Each field key maps directly to its state type.
 *
 * @param fields - Map of field names to aggregated field definitions
 * @returns Object containing schema, fields, and merge function
 *
 * @example
 * ```typescript
 * const { schema, mergeAggregatedResults } = buildAggregatedResultSchema({
 *   avgResponseTimeMs: aggregatedAverage({ ... }),
 *   successRate: aggregatedRate({ ... }),
 * });
 * ```
 */
export function buildAggregatedResultSchema<T extends AggregatedResultShape>(
  fields: T,
): {
  schema: z.ZodType<InferAggregatedResult<T>>;
  fields: T;
  mergeAggregatedResults: (
    a: InferAggregatedResult<T> | undefined,
    b: InferAggregatedResult<T>,
  ) => InferAggregatedResult<T>;
} {
  // Build schema shape - each field key maps to its state schema
  // Schema instances are already registered with chart metadata by the factory functions
  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, field] of Object.entries(fields)) {
    shape[key] = field.stateSchema;
  }

  const schema = z.object(shape);

  // Store field definitions for later lookup
  fieldRegistry.set(schema, fields);

  // Create merge function
  const mergeAggregatedResults = (
    a: Record<string, unknown> | undefined,
    b: Record<string, unknown>,
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = {};

    for (const [key, field] of Object.entries(fields)) {
      // Get states from both results using the field key
      const stateA = a?.[key] as Record<string, unknown> | undefined;
      const stateB = b[key] as Record<string, unknown> | undefined;

      let mergedState: Record<string, unknown>;

      if (stateA && stateB) {
        // Both exist, merge based on type
        switch (field.type) {
          case "average": {
            mergedState = mergeAverageStates(
              stateA as AverageState,
              stateB as AverageState,
            );
            break;
          }
          case "rate": {
            mergedState = mergeRateStates(
              stateA as RateState,
              stateB as RateState,
            );
            break;
          }
          case "counter": {
            mergedState = mergeCounterStates(
              stateA as CounterState,
              stateB as CounterState,
            );
            break;
          }
          case "minmax": {
            mergedState = mergeMinMaxStates(
              stateA as MinMaxState,
              stateB as MinMaxState,
            );
            break;
          }
        }
      } else if (stateA) {
        // Only A exists
        mergedState = stateA;
      } else if (stateB) {
        // Only B exists
        mergedState = stateB as Record<string, unknown>;
      } else {
        // Both missing, use initial state
        mergedState = field.getInitialState() as Record<string, unknown>;
      }

      // Store state directly at field key
      result[key] = mergedState;
    }

    return result;
  };

  return {
    schema: schema as unknown as z.ZodType<InferAggregatedResult<T>>,
    fields,
    mergeAggregatedResults: mergeAggregatedResults as (
      a: InferAggregatedResult<T> | undefined,
      b: InferAggregatedResult<T>,
    ) => InferAggregatedResult<T>,
  };
}

/**
 * Get field definitions from a schema.
 */
export function getAggregatedFields(
  schema: ZodTypeAny,
): AggregatedResultShape | undefined {
  return fieldRegistry.get(schema);
}

// =============================================================================
// VERSIONED AGGREGATED
// =============================================================================

/**
 * Options for creating a VersionedAggregated instance.
 */
export interface VersionedAggregatedOptions<T extends AggregatedResultShape> {
  /** Current schema version */
  version: number;
  /** Aggregated result field definitions */
  fields: T;
  /** Optional migrations for backward compatibility */
  migrations?: Migration<unknown, unknown>[];
}

/**
 * Versioned schema for aggregated results that bundles the merge function.
 * Use this instead of Versioned for collector aggregatedResult fields.
 *
 * @example
 * ```typescript
 * const aggregatedResult = new VersionedAggregated({
 *   version: 1,
 *   fields: {
 *     avgResponseTimeMs: aggregatedAverage("_responseTime", {...}),
 *     successRate: aggregatedRate("_success", {...}),
 *   },
 * });
 * ```
 */
export class VersionedAggregated<
  T extends AggregatedResultShape,
> extends Versioned<Record<string, unknown>> {
  readonly fields: T;
  private readonly _mergeAggregatedStates: (
    a: Record<string, unknown> | undefined,
    b: Record<string, unknown>,
  ) => Record<string, unknown>;

  constructor(options: VersionedAggregatedOptions<T>) {
    const { schema, mergeAggregatedResults } = buildAggregatedResultSchema(
      options.fields,
    );

    super({
      version: options.version,
      schema: schema as z.ZodType<Record<string, unknown>>,
      migrations: options.migrations,
    });

    this.fields = options.fields;
    this._mergeAggregatedStates = mergeAggregatedResults as (
      a: Record<string, unknown> | undefined,
      b: Record<string, unknown>,
    ) => Record<string, unknown>;
  }

  /**
   * Merge two pre-aggregated states.
   * Used when combining buckets (e.g., during re-aggregation for chart display).
   */
  mergeAggregatedStates(
    a: Record<string, unknown> | undefined,
    b: Record<string, unknown>,
  ): Record<string, unknown> {
    return this._mergeAggregatedStates(a, b);
  }
}
