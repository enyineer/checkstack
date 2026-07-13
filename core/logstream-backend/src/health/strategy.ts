/**
 * The `logstream` health-check strategy. Unlike a network strategy it probes
 * NOTHING: a log stream's health is derived by the collectors from
 * pre-aggregated buckets. `createClient` only resolves the configured stream
 * (a cheap existence check) and hands the collectors a read handle. The single
 * failure mode is a config error - the referenced stream no longer exists -
 * which surfaces as a thrown "connection failure", exactly as the executor
 * expects for an unresolvable target.
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
  type SafeDatabase,
  type TransportClient,
} from "@checkstack/backend-api";
import {
  healthResultString,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import {
  LOGSTREAM_STRATEGY_ID as LOGSTREAM_STRATEGY_ID_SHARED,
  LOGSTREAM_STREAM_OPTIONS_RESOLVER,
} from "@checkstack/logstream-common";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import {
  createDbReader,
  loadStreamHandle,
  type LogStreamHealthReader,
} from "./reader";

/** Strategy id (unqualified). Registered as `logstream.logstream`. */
export const LOGSTREAM_STRATEGY_ID = LOGSTREAM_STRATEGY_ID_SHARED;

/**
 * Resolver name the config's `streamId` field references for dynamic dropdown
 * options (a stream picker). DynamicForm renders it as a plain input until the
 * host editor supplies a matching resolver, so the annotation is safe. The
 * shared name lives in `logstream-common` so the frontend resolver cannot drift
 * from this annotation; re-exported for existing local references.
 */
export const STREAM_OPTIONS_RESOLVER = LOGSTREAM_STREAM_OPTIONS_RESOLVER;

// ============================================================================
// CONFIG
// ============================================================================

export const logStreamStrategyConfigSchema = baseStrategyConfigSchema.extend({
  streamId: configString({
    "x-options-resolver": STREAM_OPTIONS_RESOLVER,
  })
    .min(1)
    .describe("The log stream to evaluate"),
});

export type LogStreamStrategyConfig = z.infer<
  typeof logStreamStrategyConfigSchema
>;

// ============================================================================
// TRANSPORT CLIENT (a read handle, never a probe)
// ============================================================================

/**
 * The "client" the collectors receive. It carries no socket - only the
 * resolved stream id and a windowed read handle. `exec` exists to satisfy the
 * transport contract but is never called (log-stream collectors read via
 * `reader`).
 */
export interface LogStreamHealthClient extends TransportClient<never, never> {
  readonly streamId: string;
  readonly reader: LogStreamHealthReader;
}

// ============================================================================
// RESULT / AGGREGATION (strategy-level; metrics come from collectors)
// ============================================================================

const logStreamResultSchema = healthResultSchema({
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type LogStreamResult = z.infer<typeof logStreamResultSchema>;

const logStreamAggregatedFields = {
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Config Errors",
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }),
};

type LogStreamAggregatedResult = InferAggregatedResult<
  typeof logStreamAggregatedFields
>;

const SETUP_INSTRUCTIONS = `Select the **log stream** to evaluate. This check does not probe anything -
it reads the stream's pre-aggregated log metrics each tick.

Set the check **interval** to the cadence you want the log metrics evaluated
at (60s is a good default). Add the **Window metrics** collector and assert on
its fields, e.g. \`errorCount >= 5\` over the window, or \`secondsSinceLastLog
< 600\` to alert when a stream goes silent. A debounced fast-path also
re-evaluates within seconds of an error burst.`;

// ============================================================================
// STRATEGY
// ============================================================================

export class LogStreamHealthStrategy
  implements
    HealthCheckStrategy<
      LogStreamStrategyConfig,
      LogStreamHealthClient,
      LogStreamResult,
      typeof logStreamAggregatedFields
    >
{
  id = LOGSTREAM_STRATEGY_ID;
  displayName = "Log Stream";
  description = "Assert on windowed metrics derived from a log stream";
  // MUST be a StrategyCategory enum VALUE (lowercase): the getStrategies
  // endpoint validates its output against StrategyCategorySchema, and a
  // non-enum string 500s the whole strategy picker. The base interface types
  // `category` as a bare string, so only the enum constant keeps this safe.
  category: StrategyCategory = StrategyCategory.OBSERVABILITY;
  setupInstructions = SETUP_INSTRUCTIONS;

  private readonly db: SafeDatabase<typeof schema>;
  private readonly storage: Storage;

  constructor({
    db,
    storage,
  }: {
    db: SafeDatabase<typeof schema>;
    storage: Storage;
  }) {
    this.db = db;
    this.storage = storage;
  }

  config: Versioned<LogStreamStrategyConfig> = new Versioned({
    version: 1,
    schema: logStreamStrategyConfigSchema,
  });

  result: Versioned<LogStreamResult> = new Versioned({
    version: 1,
    schema: logStreamResultSchema,
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: logStreamAggregatedFields,
  });

  mergeResult(
    existing: LogStreamAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<LogStreamResult>,
  ): LogStreamAggregatedResult {
    return {
      errorCount: mergeCounter(existing?.errorCount, !!newRun.metadata?.error),
    };
  }

  async createClient(
    config: unknown,
  ): Promise<ConnectedClient<LogStreamHealthClient>> {
    const { streamId } = this.config.validate(config);

    const handle = await loadStreamHandle({ db: this.db, streamId });
    if (!handle) {
      // Config error: the referenced stream was deleted. Treated by the
      // executor as a connection failure (unhealthy) BEFORE assertions run.
      throw new Error(`Log stream not found: ${streamId}`);
    }

    const reader = createDbReader({
      db: this.db,
      storage: this.storage,
      handle,
    });

    const client: LogStreamHealthClient = {
      streamId,
      reader,
      exec(): Promise<never> {
        // Log-stream collectors read via `reader`; there is no command to run.
        return Promise.reject(
          new Error("logstream health client does not support exec()"),
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
