/**
 * The `tracestream` health-check strategy. Unlike a network strategy it probes
 * NOTHING: a trace stream's health is derived by the collectors from
 * pre-aggregated buckets / summaries. `createClient` only resolves the configured
 * stream (a cheap existence check) and hands the collectors a read handle. The
 * single failure mode is a config error - the referenced stream no longer exists
 * - which surfaces as a thrown "connection failure", exactly as the executor
 * expects for an unresolvable target. Mirrors logstream's health strategy.
 */

import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedCounter,
  mergeCounter,
  z,
  configString,
  baseStrategyConfigSchema,
  type ConnectedClient,
  type InferAggregatedResult,
  type TransportClient,
} from "@checkstack/backend-api";
import {
  healthResultString,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import {
  TRACESTREAM_STRATEGY_ID as TRACESTREAM_STRATEGY_ID_SHARED,
  TRACESTREAM_STREAM_OPTIONS_RESOLVER,
} from "@checkstack/tracestream-common";
import type { Storage } from "../storage";
import {
  createStorageReader,
  loadStreamHandle,
  type TraceStreamHealthReader,
} from "./reader";

/** Strategy id (unqualified). Registered as `tracestream.tracestream`. */
export const TRACESTREAM_STRATEGY_ID = TRACESTREAM_STRATEGY_ID_SHARED;

/**
 * Resolver name the config's `streamId` field references for dynamic dropdown
 * options (a stream picker). DynamicForm renders it as a plain input until the
 * host editor supplies a matching resolver, so the annotation is safe. The shared
 * name lives in `tracestream-common` so the frontend resolver cannot drift from
 * this annotation.
 */
export const STREAM_OPTIONS_RESOLVER = TRACESTREAM_STREAM_OPTIONS_RESOLVER;

// ============================================================================
// CONFIG
// ============================================================================

export const traceStreamStrategyConfigSchema = baseStrategyConfigSchema.extend({
  streamId: configString({
    "x-options-resolver": STREAM_OPTIONS_RESOLVER,
  })
    .min(1)
    .describe("The trace stream to evaluate"),
});

export type TraceStreamStrategyConfig = z.infer<
  typeof traceStreamStrategyConfigSchema
>;

// ============================================================================
// TRANSPORT CLIENT (a read handle, never a probe)
// ============================================================================

/**
 * The "client" the collectors receive. It carries no socket - only the resolved
 * stream id and a windowed read handle. `exec` exists to satisfy the transport
 * contract but is never called (trace-stream collectors read via `reader`).
 */
export interface TraceStreamHealthClient extends TransportClient<never, never> {
  readonly streamId: string;
  readonly reader: TraceStreamHealthReader;
}

// ============================================================================
// RESULT / AGGREGATION (strategy-level; metrics come from collectors)
// ============================================================================

const traceStreamResultSchema = healthResultSchema({
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type TraceStreamResult = z.infer<typeof traceStreamResultSchema>;

const traceStreamAggregatedFields = {
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Config Errors",
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }),
};

type TraceStreamAggregatedResult = InferAggregatedResult<
  typeof traceStreamAggregatedFields
>;

const SETUP_INSTRUCTIONS = `Select the **trace stream** to evaluate. This check does not probe anything -
it reads the stream's pre-aggregated trace metrics each tick.

Set the check **interval** to the cadence you want the trace metrics evaluated
at (60s is a good default). Add the **Window metrics** collector and assert on
its fields, e.g. \`errorSpanCount >= 5\` over the window, or
\`secondsSinceLastSpan < 600\` to alert when a stream goes silent. Add an
**Operation latency** collector to assert on a service/operation's \`p95Ms\`. A
debounced fast-path also re-evaluates within seconds of an error burst.`;

// ============================================================================
// STRATEGY
// ============================================================================

export class TraceStreamHealthStrategy
  implements
    HealthCheckStrategy<
      TraceStreamStrategyConfig,
      TraceStreamHealthClient,
      TraceStreamResult,
      typeof traceStreamAggregatedFields
    >
{
  id = TRACESTREAM_STRATEGY_ID;
  displayName = "Trace Stream";
  description = "Assert on windowed metrics derived from a trace stream";
  // MUST be a StrategyCategory enum VALUE (lowercase): the getStrategies
  // endpoint validates its output against StrategyCategorySchema, and a non-enum
  // string 500s the whole strategy picker. The base interface types `category`
  // as a bare string, so only the enum constant keeps this safe.
  category: StrategyCategory = StrategyCategory.OBSERVABILITY;
  setupInstructions = SETUP_INSTRUCTIONS;

  private readonly storage: Storage;

  constructor({ storage }: { storage: Storage }) {
    this.storage = storage;
  }

  config: Versioned<TraceStreamStrategyConfig> = new Versioned({
    version: 1,
    schema: traceStreamStrategyConfigSchema,
  });

  result: Versioned<TraceStreamResult> = new Versioned({
    version: 1,
    schema: traceStreamResultSchema,
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: traceStreamAggregatedFields,
  });

  mergeResult(
    existing: TraceStreamAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<TraceStreamResult>,
  ): TraceStreamAggregatedResult {
    return {
      errorCount: mergeCounter(existing?.errorCount, !!newRun.metadata?.error),
    };
  }

  async createClient(
    config: unknown,
  ): Promise<ConnectedClient<TraceStreamHealthClient>> {
    const { streamId } = this.config.validate(config);

    const handle = await loadStreamHandle({ storage: this.storage, streamId });
    if (!handle) {
      // Config error: the referenced stream was deleted. Treated by the executor
      // as a connection failure (unhealthy) BEFORE assertions run.
      throw new Error(`Trace stream not found: ${streamId}`);
    }

    const reader = createStorageReader({ storage: this.storage, handle });

    const client: TraceStreamHealthClient = {
      streamId,
      reader,
      exec(): Promise<never> {
        // Trace-stream collectors read via `reader`; there is no command to run.
        return Promise.reject(
          new Error("tracestream health client does not support exec()"),
        );
      },
    };

    return {
      client,
      close: () => {
        // Read handle over a shared pool; nothing to release.
      },
    };
  }
}
