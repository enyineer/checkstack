import {
  Versioned,
  z,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeRate,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  configString,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import { pluginMetadata } from "./plugin-metadata";
import type { GrpcTransportClient } from "./transport-client";

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const healthConfigSchema = z.object({
  // Templatable and optional: an empty render legitimately means "check the
  // overall server health", so no post-render presence guard is applied.
  service: configString({ "x-templatable": true })
    .default("")
    .describe(
      "Service name to check (empty for overall). Supports templating, e.g. {{ environment.service }}",
    ),
});

export type HealthConfig = z.infer<typeof healthConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const grpcHealthResultSchema = healthResultSchema({
  // Informational echo of the gRPC status enum. Availability is already
  // captured by the `serving` boolean (dominance), so leaving anomaly on the
  // raw status text only adds a redundant, noisy categorical signal. Disabled
  // by default; still chartable and opt-in.
  status: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Status",
    "x-anomaly-enabled": false,
    "x-chart-priority": 20,
  }),
  // Canonical availability signal. Dominance flip (SERVING -> not) is the
  // real problem. A confirmation window debounces single-sample flaps so a
  // transient blip does not page.
  serving: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Serving",
    "x-chart-true-label": "serving",
    "x-chart-false-label": "not serving",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-anomaly-confirmation-window": 3,
    "x-chart-good-direction": "up",
    "x-chart-priority": 20,
  }),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
});

export type HealthResult = z.infer<typeof grpcHealthResultSchema>;

// Aggregated result fields definition
const healthAggregatedFields = {
  avgResponseTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  servingRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Serving Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 5,
  }),
};

// Type inferred from field definitions
export type HealthAggregatedResult = InferAggregatedResult<
  typeof healthAggregatedFields
>;

// ============================================================================
// HEALTH COLLECTOR
// ============================================================================

/**
 * Built-in gRPC health collector.
 * Checks gRPC health status using the standard Health Checking Protocol.
 */
export class HealthCollector implements CollectorStrategy<
  GrpcTransportClient,
  HealthConfig,
  HealthResult,
  HealthAggregatedResult
> {
  id = "health";
  displayName = "gRPC Health Check";
  description = "Check gRPC service health status";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: healthConfigSchema });
  result = new Versioned({ version: 1, schema: grpcHealthResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: healthAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: HealthConfig;
    client: GrpcTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<HealthResult>> {
    const startTime = Date.now();

    const response = await client.exec({
      service: config.service,
    });

    const responseTimeMs = Date.now() - startTime;
    // `serving` (and the raw `status` enum) are ASSERTABLE METRICS, not a
    // collector-failure signal. A completed health RPC that answers
    // NOT_SERVING / SERVICE_UNKNOWN / UNKNOWN is a SUCCESSFUL collection: the
    // server was reached and responded. Only a real transport failure (the RPC
    // could not complete - connection refused, deadline exceeded) sets
    // `response.error` in the transport client, and that is the only thing we
    // forward as a collector error. Whether a non-SERVING status makes the
    // check unhealthy is decided by the user's assertions (e.g. "serving is
    // true", or "status equals NOT_SERVING" when that is the wanted state).
    const serving = response.status === "SERVING";

    return {
      result: {
        status: response.status,
        serving,
        responseTimeMs,
      },
      error: response.error,
    };
  }

  mergeResult(
    existing: HealthAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<HealthResult>,
  ): HealthAggregatedResult {
    const metadata = run.metadata;

    return {
      avgResponseTimeMs: mergeAverage(
        existing?.avgResponseTimeMs,
        metadata?.responseTimeMs,
      ),
      servingRate: mergeRate(existing?.servingRate, metadata?.serving),
    };
  }
}
