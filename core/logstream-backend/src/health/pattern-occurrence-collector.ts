/**
 * `pattern-occurrence` collector: assert on a single Drain pattern's activity
 * within a window - e.g. `occurrenceCount >= 3` for a known error template, or
 * `minutesSinceLastSeen > 60` to notice a pattern going quiet.
 *
 * Collector rule: a read failure throws (transport failure); a zero count / an
 * unseen pattern are metrics assertions decide on.
 */

import {
  Versioned,
  z,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedMinMax,
  mergeAverage,
  mergeMinMax,
  configString,
  configNumber,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  type CollectorRunContext,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import {
  pluginMetadata,
  LOGSTREAM_PATTERN_OPTIONS_RESOLVER,
} from "@checkstack/logstream-common";
import type { LogStreamHealthClient } from "./strategy";
import {
  computeWindowBounds,
  buildPatternOccurrence,
  MIN_WINDOW_SECONDS,
} from "./window";

export const PATTERN_OCCURRENCE_COLLECTOR_ID = "pattern-occurrence";

/**
 * Resolver name for the pattern picker. The pattern list is stream-scoped and
 * `streamId` lives in the STRATEGY config (a different form). The health-check
 * editor bridges that: it builds the collector-form resolvers with the strategy
 * config as context, so the frontend resolver reads the chosen `streamId` and
 * lists that stream's patterns. The shared name lives in `logstream-common` so
 * the frontend resolver cannot drift from this annotation; re-exported for
 * existing local references.
 */
export const PATTERN_OPTIONS_RESOLVER = LOGSTREAM_PATTERN_OPTIONS_RESOLVER;

// ============================================================================
// CONFIG
// ============================================================================

const patternOccurrenceConfigSchema = z.object({
  patternId: configString({
    "x-options-resolver": PATTERN_OPTIONS_RESOLVER,
  })
    .min(1)
    .describe(
      "The log pattern (Drain template) to count. Select the log stream " +
        "under General first - this list offers the patterns discovered on " +
        "that stream (it is empty until the stream has received logs).",
    ),
  windowSeconds: configNumber({})
    .int()
    .min(MIN_WINDOW_SECONDS)
    .optional()
    .describe(
      "Window to evaluate, in seconds (floored to whole minutes; min 60). Defaults to the check interval.",
    ),
});

export type PatternOccurrenceConfig = z.infer<
  typeof patternOccurrenceConfigSchema
>;

// ============================================================================
// RESULT
// ============================================================================

const patternOccurrenceResultSchema = healthResultSchema({
  occurrenceCount: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Occurrences",
    "x-chart-priority": 10,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 3,
  }).describe(
    "Times this pattern matched a line over the evaluation window (0 when it did not occur).",
  ),
  minutesSinceLastSeen: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Minutes since last seen",
    "x-chart-unit": "min",
    "x-chart-priority": 20,
    "x-anomaly-enabled": false,
  }).describe(
    "Whole minutes since this pattern last matched a line; counts from stream " +
      "creation when the pattern has never been seen, so an assertion like " +
      "`minutesSinceLastSeen > 60` (pattern went quiet) is meaningful from creation.",
  ),
});

export type PatternOccurrenceResultShape = z.infer<
  typeof patternOccurrenceResultSchema
>;

// ============================================================================
// AGGREGATION
// ============================================================================

const patternOccurrenceAggregatedFields = {
  avgOccurrenceCount: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg occurrences",
    "x-chart-priority": 10,
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-min-absolute-delta": 3,
  }),
  minutesSinceLastSeen: aggregatedMinMax({
    "x-chart-type": "line",
    "x-chart-label": "Minutes since last seen",
    "x-chart-unit": "min",
    "x-chart-priority": 20,
    "x-anomaly-enabled": false,
  }),
};

export type PatternOccurrenceAggregatedResult = InferAggregatedResult<
  typeof patternOccurrenceAggregatedFields
>;

// ============================================================================
// COLLECTOR
// ============================================================================

export class PatternOccurrenceCollector
  implements
    CollectorStrategy<
      LogStreamHealthClient,
      PatternOccurrenceConfig,
      PatternOccurrenceResultShape,
      PatternOccurrenceAggregatedResult
    >
{
  id = PATTERN_OCCURRENCE_COLLECTOR_ID;
  displayName = "Pattern Occurrence";
  description = "Count occurrences of one log pattern over a window (assertable)";

  supportedPlugins = [pluginMetadata];
  allowMultiple = true;

  config = new Versioned({ version: 1, schema: patternOccurrenceConfigSchema });
  result = new Versioned({ version: 1, schema: patternOccurrenceResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: patternOccurrenceAggregatedFields,
  });

  constructor(private readonly now: () => Date = () => new Date()) {}

  async execute({
    config,
    client,
    runContext,
  }: {
    config: PatternOccurrenceConfig;
    client: LogStreamHealthClient;
    pluginId: string;
    runContext?: CollectorRunContext;
  }): Promise<CollectorResult<PatternOccurrenceResultShape>> {
    const now = this.now();
    const intervalSeconds =
      runContext?.check.intervalSeconds ?? MIN_WINDOW_SECONDS;
    const { from, readTo } = computeWindowBounds({
      now,
      windowSeconds: config.windowSeconds,
      intervalSeconds,
    });

    const { reader } = client;
    // Include the in-progress minute (`readTo`) so a pattern burst seconds into
    // the current minute counts immediately (see WindowBounds).
    const [occurrenceCount, lastSeenAt] = await Promise.all([
      reader.readPatternOccurrence({
        patternId: config.patternId,
        from,
        to: readTo,
      }),
      reader.readPatternLastSeenAt({ patternId: config.patternId }),
    ]);

    const result = buildPatternOccurrence({
      occurrenceCount,
      now,
      lastSeenAt,
      streamCreatedAt: reader.streamCreatedAt,
    });

    return { result };
  }

  mergeResult(
    existing: PatternOccurrenceAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<PatternOccurrenceResultShape>,
  ): PatternOccurrenceAggregatedResult {
    const m = newRun.metadata;
    return {
      avgOccurrenceCount: mergeAverage(
        existing?.avgOccurrenceCount,
        m?.occurrenceCount,
      ),
      minutesSinceLastSeen: mergeMinMax(
        existing?.minutesSinceLastSeen,
        m?.minutesSinceLastSeen,
      ),
    };
  }
}
