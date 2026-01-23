import { z } from "zod";

/**
 * Incremental aggregation utilities for real-time metrics.
 * These utilities enable O(1) memory aggregation without storing raw data.
 *
 * Each pattern provides:
 * - A Zod schema for validation/serialization (with required _type)
 * - TypeScript types: State (with _type) and StateInput (without _type)
 * - A merge function that always outputs the _type discriminator
 *
 * Strategy/collector implementations provide data WITHOUT _type.
 * The merge functions add _type automatically.
 */

// =============================================================================
// COUNTER PATTERN
// =============================================================================

/**
 * Zod schema for accumulated counter state.
 * _type is required for reliable type detection.
 */
export const counterStateSchema = z.object({
  _type: z.literal("counter"),
  count: z.number(),
});

/**
 * Counter state with required _type discriminator (derived from schema).
 */
export type CounterState = z.infer<typeof counterStateSchema>;

/**
 * Counter state input type - without _type (for strategy/collector implementations).
 */
export type CounterStateInput = Omit<CounterState, "_type">;

/**
 * Incrementally merge a counter.
 * Use for tracking occurrences (errorCount, requestCount, etc.)
 *
 * @param existing - Previous counter state (undefined for first run)
 * @param increment - Value to add (boolean true = 1, false = 0, or direct number)
 */
export function mergeCounter(
  existing: CounterStateInput | undefined,
  increment: boolean | number,
): CounterState {
  const value =
    typeof increment === "boolean" ? (increment ? 1 : 0) : increment;
  return {
    _type: "counter",
    count: (existing?.count ?? 0) + value,
  };
}

// =============================================================================
// AVERAGE PATTERN
// =============================================================================

/**
 * Zod schema for accumulated average state.
 * Internal `_sum` and `_count` fields enable accurate averaging.
 * _type is required for reliable type detection.
 */
export const averageStateSchema = z.object({
  _type: z.literal("average"),
  /** Internal: sum of all values */
  _sum: z.number(),
  /** Internal: count of values */
  _count: z.number(),
  /** Computed average (rounded) */
  avg: z.number(),
});

/**
 * Average state with required _type discriminator (derived from schema).
 */
export type AverageState = z.infer<typeof averageStateSchema>;

/**
 * Average state input type - without _type (for strategy/collector implementations).
 */
export type AverageStateInput = Omit<AverageState, "_type">;

/**
 * Incrementally merge an average.
 * Use for tracking averages (avgResponseTimeMs, avgExecutionTimeMs, etc.)
 *
 * @param existing - Previous average state (undefined for first run)
 * @param value - New value to incorporate (undefined skipped)
 */
export function mergeAverage(
  existing: AverageStateInput | undefined,
  value: number | undefined,
): AverageState {
  if (value === undefined) {
    // No new value, return existing with _type or initial state
    return {
      _type: "average",
      _sum: existing?._sum ?? 0,
      _count: existing?._count ?? 0,
      avg: existing?.avg ?? 0,
    };
  }

  const sum = (existing?._sum ?? 0) + value;
  const count = (existing?._count ?? 0) + 1;

  return {
    _type: "average",
    _sum: sum,
    _count: count,
    // Round to 1 decimal place to preserve precision for float metrics (e.g., load averages)
    avg: Math.round((sum / count) * 10) / 10,
  };
}

// =============================================================================
// RATE PATTERN
// =============================================================================

/**
 * Zod schema for accumulated rate state (percentage).
 * Internal `_success` and `_total` fields enable accurate rate calculation.
 * _type is required for reliable type detection.
 */
export const rateStateSchema = z.object({
  _type: z.literal("rate"),
  /** Internal: count of successes */
  _success: z.number(),
  /** Internal: total count */
  _total: z.number(),
  /** Computed rate as percentage (0-100, rounded) */
  rate: z.number(),
});

/**
 * Rate state with required _type discriminator (derived from schema).
 */
export type RateState = z.infer<typeof rateStateSchema>;

/**
 * Rate state input type - without _type (for strategy/collector implementations).
 */
export type RateStateInput = Omit<RateState, "_type">;

/**
 * Incrementally merge a rate (percentage).
 * Use for tracking success rates, availability percentages, etc.
 *
 * @param existing - Previous rate state (undefined for first run)
 * @param success - Whether this run was successful (undefined skipped)
 */
export function mergeRate(
  existing: RateStateInput | undefined,
  success: boolean | undefined,
): RateState {
  if (success === undefined) {
    // No new value, return existing with _type or initial state
    return {
      _type: "rate",
      _success: existing?._success ?? 0,
      _total: existing?._total ?? 0,
      rate: existing?.rate ?? 0,
    };
  }

  const successCount = (existing?._success ?? 0) + (success ? 1 : 0);
  const total = (existing?._total ?? 0) + 1;

  return {
    _type: "rate",
    _success: successCount,
    _total: total,
    rate: Math.round((successCount / total) * 100),
  };
}

// =============================================================================
// MINMAX PATTERN
// =============================================================================

/**
 * Zod schema for accumulated min/max state.
 * _type is required for reliable type detection.
 */
export const minMaxStateSchema = z.object({
  _type: z.literal("minmax"),
  min: z.number(),
  max: z.number(),
});

/**
 * MinMax state with required _type discriminator (derived from schema).
 */
export type MinMaxState = z.infer<typeof minMaxStateSchema>;

/**
 * MinMax state input type - without _type (for strategy/collector implementations).
 */
export type MinMaxStateInput = Omit<MinMaxState, "_type">;

/**
 * Incrementally merge min/max values.
 * Use for tracking min/max latency, memory, etc.
 *
 * @param existing - Previous min/max state (undefined for first run)
 * @param value - New value to incorporate (undefined skipped)
 */
export function mergeMinMax(
  existing: MinMaxStateInput | undefined,
  value: number | undefined,
): MinMaxState {
  if (value === undefined) {
    // No new value, return existing with _type or initial state
    return {
      _type: "minmax",
      min: existing?.min ?? 0,
      max: existing?.max ?? 0,
    };
  }

  if (existing === undefined) {
    // First value
    return { _type: "minmax", min: value, max: value };
  }

  return {
    _type: "minmax",
    min: Math.min(existing.min, value),
    max: Math.max(existing.max, value),
  };
}

// =============================================================================
// STATE-MERGE UTILITIES - For merging two pre-aggregated states
// =============================================================================

/**
 * Merge two CounterStates.
 * Used when combining pre-aggregated buckets (e.g., in combineBuckets).
 * Always includes _type discriminator for reliable type detection.
 */
export function mergeCounterStates(
  a: CounterStateInput,
  b: CounterStateInput,
): CounterState {
  return {
    _type: "counter",
    count: a.count + b.count,
  };
}

/**
 * Merge two AverageStates.
 * Used when combining pre-aggregated buckets.
 * Always includes _type discriminator for reliable type detection.
 */
export function mergeAverageStates(
  a: AverageStateInput,
  b: AverageStateInput,
): AverageState {
  const sum = a._sum + b._sum;
  const count = a._count + b._count;
  return {
    _type: "average",
    _sum: sum,
    _count: count,
    avg: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
  };
}

/**
 * Merge two RateStates.
 * Used when combining pre-aggregated buckets.
 * Always includes _type discriminator for reliable type detection.
 */
export function mergeRateStates(
  a: RateStateInput,
  b: RateStateInput,
): RateState {
  const success = a._success + b._success;
  const total = a._total + b._total;
  return {
    _type: "rate",
    _success: success,
    _total: total,
    rate: total > 0 ? Math.round((success / total) * 100) : 0,
  };
}

/**
 * Merge two MinMaxStates.
 * Used when combining pre-aggregated buckets.
 * Always includes _type discriminator for reliable type detection.
 */
export function mergeMinMaxStates(
  a: MinMaxStateInput,
  b: MinMaxStateInput,
): MinMaxState {
  return {
    _type: "minmax",
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
  };
}
