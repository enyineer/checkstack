/**
 * The `metricstream` health-check strategy. Like the log-stream strategy it
 * probes NOTHING: a metric stream's health is derived by the `metric-window`
 * collector from pre-aggregated buckets. `createClient` only resolves the
 * configured stream (a cheap existence check) and hands the collector a read
 * handle. The single failure mode is a config error - the referenced stream no
 * longer exists - which surfaces as a thrown "connection failure", exactly as
 * the executor expects for an unresolvable target.
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
  METRICSTREAM_STRATEGY_ID,
  METRICSTREAM_STREAM_OPTIONS_RESOLVER,
} from "@checkstack/metricstream-common";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import {
  createDbReader,
  loadStreamHandle,
  type MetricStreamHealthReader,
} from "./reader";

// ============================================================================
// CONFIG
// ============================================================================

export const metricStreamStrategyConfigSchema = baseStrategyConfigSchema.extend({
  streamId: configString({
    "x-options-resolver": METRICSTREAM_STREAM_OPTIONS_RESOLVER,
  })
    .min(1)
    .describe("The metric stream to evaluate"),
});

export type MetricStreamStrategyConfig = z.infer<
  typeof metricStreamStrategyConfigSchema
>;

// ============================================================================
// TRANSPORT CLIENT (a read handle, never a probe)
// ============================================================================

/**
 * The "client" the collector receives. It carries no socket - only the resolved
 * stream id and a windowed read handle. `exec` exists to satisfy the transport
 * contract but is never called (the metric-window collector reads via `reader`).
 */
export interface MetricStreamHealthClient extends TransportClient<never, never> {
  readonly streamId: string;
  readonly reader: MetricStreamHealthReader;
}

// ============================================================================
// RESULT / AGGREGATION (strategy-level; the metrics come from the collector)
// ============================================================================

const metricStreamResultSchema = healthResultSchema({
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type MetricStreamResult = z.infer<typeof metricStreamResultSchema>;

const metricStreamAggregatedFields = {
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Config Errors",
    "x-chart-good-direction": "down",
    "x-anomaly-enabled": false,
  }),
};

type MetricStreamAggregatedResult = InferAggregatedResult<
  typeof metricStreamAggregatedFields
>;

const SETUP_INSTRUCTIONS = `Select the **metric stream** to evaluate. This check does not probe anything -
it reads the stream's pre-aggregated metric buckets each tick.

Set the check **interval** to the cadence you want the metrics evaluated at
(60s is a good default). Add the **Metric window** collector, pick a metric
(and optionally exact-match label filters), and assert on its fields, e.g.
\`avgValue < 500\` over the window, \`ratePerSecond > 100\` for a counter, or
\`secondsSinceLastSample < 600\` to alert when a metric goes stale.`;

// ============================================================================
// STRATEGY
// ============================================================================

export class MetricStreamHealthStrategy
  implements
    HealthCheckStrategy<
      MetricStreamStrategyConfig,
      MetricStreamHealthClient,
      MetricStreamResult,
      typeof metricStreamAggregatedFields
    >
{
  id = METRICSTREAM_STRATEGY_ID;
  displayName = "Metric Stream";
  description = "Assert on windowed metrics derived from a metric stream";
  // MUST be a StrategyCategory enum VALUE (lowercase): the getStrategies
  // endpoint validates its output against StrategyCategorySchema, and a
  // non-enum string 500s the whole strategy picker (the v1 category regression).
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

  config: Versioned<MetricStreamStrategyConfig> = new Versioned({
    version: 1,
    schema: metricStreamStrategyConfigSchema,
  });

  result: Versioned<MetricStreamResult> = new Versioned({
    version: 1,
    schema: metricStreamResultSchema,
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: metricStreamAggregatedFields,
  });

  mergeResult(
    existing: MetricStreamAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<MetricStreamResult>,
  ): MetricStreamAggregatedResult {
    return {
      errorCount: mergeCounter(existing?.errorCount, !!newRun.metadata?.error),
    };
  }

  async createClient(
    config: unknown,
  ): Promise<ConnectedClient<MetricStreamHealthClient>> {
    const { streamId } = this.config.validate(config);

    const handle = await loadStreamHandle({ db: this.db, streamId });
    if (!handle) {
      // Config error: the referenced stream was deleted. Treated by the
      // executor as a connection failure (unhealthy) BEFORE assertions run.
      throw new Error(`Metric stream not found: ${streamId}`);
    }

    const reader = createDbReader({
      db: this.db,
      storage: this.storage,
      handle,
    });

    const client: MetricStreamHealthClient = {
      streamId,
      reader,
      exec(): Promise<never> {
        return Promise.reject(
          new Error("metricstream health client does not support exec()"),
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
