import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  aggregatedCounter,
  mergeAverage,
  mergeRate,
  mergeCounter,
  z,
  configString,
  type ConnectedClient,
  type TransportTimings,
  type InferAggregatedResult,
  baseStrategyConfigSchema,
} from "@checkstack/backend-api";
import {
  healthResultBoolean,
  healthResultNumber,
  healthResultString,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import type {
  ContainerCommand,
  ContainerCommandResult,
  ContainerTransportClient,
} from "@checkstack/healthcheck-container-common";
import { createRuntimeApi, type ContainerFetch } from "./runtime-api";
import { containerSetupInstructions } from "./setup-instructions";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Configuration for a Container health check. Connection parameters only - the
 * per-container metrics live on the container-status / container-stats
 * collectors.
 */
export const containerConfigSchema = baseStrategyConfigSchema.extend({
  // Templatable: supports `{{ environment.endpoint }}` so one config covers N
  // environments. Presence is enforced POST-RENDER in `createClient` (an empty
  // render must not silently probe an empty endpoint).
  endpoint: configString({ "x-templatable": true })
    .min(1)
    .default("http://socket-proxy:2375")
    .describe(
      "URL of your read-only socket-proxy (e.g. http://socket-proxy:2375) or a runtime socket path (e.g. unix:///run/user/1000/podman/podman.sock). Never point this at the raw Docker socket - see the setup guide. Supports templating, e.g. {{ environment.endpoint }}",
    ),
  // Templatable: supports `{{ environment.container }}` so one config covers N
  // environments. Presence is enforced POST-RENDER in `createClient`.
  container: configString({ "x-templatable": true })
    .min(1)
    .describe(
      "Container name or ID to monitor. Supports templating, e.g. {{ environment.container }}",
    ),
});

/**
 * Post-render validator for the required `endpoint` / `container`. The stored
 * values are templatable strings, so `.min(1)` cannot meaningfully run at store
 * time against a template; the executor renders `{{ environment.* }}` per
 * environment, then this rejects a render that collapsed to empty/whitespace. An
 * empty value is a config error - transport-failure semantics - not a "healthy"
 * empty probe.
 */
const renderedRequiredSchema = z.string().trim().min(1);

export type ContainerConfig = z.infer<typeof containerConfigSchema>;

/** Per-run result: did we reach the runtime API, and how fast. */
const containerResultSchema = healthResultSchema({
  connected: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "Runtime Reachable",
    "x-chart-true-label": "reachable",
    "x-chart-false-label": "unreachable",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
    "x-chart-good-direction": "up",
  }),
  connectionTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type ContainerResult = z.infer<typeof containerResultSchema>;

const containerAggregatedFields = {
  avgConnectionTime: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
    "x-chart-priority": 10,
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Reachable Rate",
    "x-chart-unit": "%",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    "x-anomaly-confirmation-window": 3,
  }),
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Redundant with successRate for alerting (same failures as a rate); keep
    // chartable but let successRate own alerting to avoid duplicate noise.
    "x-anomaly-enabled": false,
    "x-chart-good-direction": "down",
    "x-chart-priority": 90,
  }),
};

type ContainerAggregatedResult = InferAggregatedResult<
  typeof containerAggregatedFields
>;

// ============================================================================
// STRATEGY
// ============================================================================

export class ContainerHealthCheckStrategy
  implements
    HealthCheckStrategy<
      ContainerConfig,
      ContainerTransportClient,
      ContainerResult,
      typeof containerAggregatedFields
    >
{
  id = "container";
  displayName = "Container";
  description =
    "Monitor a Docker or Podman container via a read-only socket-proxy (no raw socket exposure)";
  category = StrategyCategory.CONTAINERIZATION;
  setupInstructions = containerSetupInstructions;

  private fetchImpl?: ContainerFetch;

  constructor(fetchImpl?: ContainerFetch) {
    this.fetchImpl = fetchImpl;
  }

  config: Versioned<ContainerConfig> = new Versioned({
    version: 1,
    schema: containerConfigSchema,
  });

  result: Versioned<ContainerResult> = new Versioned({
    version: 1,
    schema: containerResultSchema,
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: containerAggregatedFields,
  });

  mergeResult(
    existing: ContainerAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<ContainerResult>,
  ): ContainerAggregatedResult {
    const metadata = run.metadata;
    const avgConnectionTime = mergeAverage(
      existing?.avgConnectionTime,
      metadata?.connectionTimeMs,
    );
    const isSuccess = metadata?.connected ?? false;
    const successRate = mergeRate(existing?.successRate, isSuccess);
    const hasError = metadata?.error !== undefined;
    const errorCount = mergeCounter(existing?.errorCount, hasError);
    return { avgConnectionTime, successRate, errorCount };
  }

  async createClient(
    config: ContainerConfig,
  ): Promise<ConnectedClient<ContainerTransportClient>> {
    const validated = this.config.validate(config);

    // Post-render guards: `endpoint` and `container` are templatable strings, so
    // presence cannot be checked at store time. The executor has already
    // rendered `{{ environment.* }}` into them; reject a render that collapsed to
    // empty so the run fails clearly instead of probing an empty target.
    const endpoint = renderedRequiredSchema.safeParse(validated.endpoint);
    if (!endpoint.success) {
      throw new Error(
        `Rendered endpoint is empty: ${JSON.stringify(validated.endpoint)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      );
    }
    const container = renderedRequiredSchema.safeParse(validated.container);
    if (!container.success) {
      throw new Error(
        `Rendered container is empty: ${JSON.stringify(validated.container)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      );
    }

    const api = createRuntimeApi({
      endpoint: endpoint.data,
      container: container.data,
      timeoutMs: validated.timeout,
      fetchImpl: this.fetchImpl,
    });

    // Connectivity check: reaching the runtime API is the transport. A failure
    // here (proxy down, socket unreachable, denied) THROWS and the executor
    // treats the run as unhealthy before collectors run.
    const connectStart = performance.now();
    await api.ping();
    const timings: TransportTimings = {
      connectMs: Math.max(0, Math.round(performance.now() - connectStart)),
    };

    const client: ContainerTransportClient = {
      async exec(command: ContainerCommand): Promise<ContainerCommandResult> {
        if (command.type === "inspect") {
          return { type: "inspect", ...(await api.inspect()) };
        }
        return { type: "stats", ...(await api.stats()) };
      },
    };

    return {
      client,
      timings,
      close: () => {
        // Stateless HTTP transport: nothing to close.
      },
    };
  }
}
