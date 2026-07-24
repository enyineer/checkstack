import type {
  SatelliteAssignment,
  ResultMessage,
  SatelliteEnvironment,
} from "@checkstack/satellite-common";
import type {
  CollectorRunContext,
  HealthCheckRegistry,
  CollectorRegistry,
  Logger,
} from "@checkstack/backend-api";
import { runHealthCheckCollection } from "@checkstack/healthcheck-execution";
import { buildRunContext } from "./run-context";
import {
  hasUnresolvedConfigSecrets,
  assertConfigSecretsResolved,
  applyConfigSecretValues,
} from "./config-secrets";

/** Whether a collector config declares a non-empty secretEnv mapping. */
function declaresSecretEnv(config: Record<string, unknown>): boolean {
  const se = config.secretEnv;
  return (
    typeof se === "object" &&
    se !== null &&
    Object.keys(se as Record<string, unknown>).length > 0
  );
}

export async function executeAssignment(
  assignment: SatelliteAssignment,
  environment: SatelliteEnvironment | null,
  deps: {
    /**
     * Request a collector run's resolved secret env from core (JIT). Throws
     * on delivery/resolution failure so the collector fails clearly.
     */
    requestRunSecrets: (input: {
      configId: string;
      collectorId: string;
      runId: string;
    }) => Promise<Record<string, string>>;
    /**
     * Request the assignment's resolved CONFIG secrets from core (JIT):
     * `x-secret` strategy/collector config fields the relayed assignment
     * carries only as markers / `${{ secrets.* }}` references. Throws on
     * delivery/resolution failure so the run fails clearly.
     */
    requestConfigSecrets: (input: {
      configId: string;
      runId: string;
    }) => Promise<{
      strategy: Record<string, string>;
      collectors: Record<string, Record<string, string>>;
    }>;
  },
  runtime: {
    healthCheckRegistry: HealthCheckRegistry;
    collectorRegistry: CollectorRegistry;
    logger: Logger;
  },
): Promise<ResultMessage> {
  const { healthCheckRegistry, collectorRegistry, logger } = runtime;
  const strategy = healthCheckRegistry.getStrategy(assignment.strategyId);
  if (!strategy) {
    return {
      type: "result",
      configId: assignment.configId,
      systemId: assignment.systemId,
      environmentId: environment?.id ?? null,
      status: "unhealthy",
      latencyMs: 0,
      executedAt: new Date().toISOString(),
      result: {
        status: "unhealthy",
        latencyMs: 0,
        message: `Strategy ${assignment.strategyId} not found in satellite`,
        metadata: {
          connected: false,
          error: `Strategy ${assignment.strategyId} not found in satellite`,
        },
      },
    };
  }

  // Curated, read-only run-context metadata exposed to collectors.
  // Mirrors the core queue-executor; falls back to IDs when the optional
  // name fields are absent (version-skew safety).
  const runContext: CollectorRunContext = buildRunContext({
    assignment,
    environment,
  });

  try {
    // 0. JIT config-secret delivery: if any `x-secret` field of the strategy
    // or a collector config still holds a marker / reference, fetch the
    // resolved values from core and apply them onto in-memory copies. The
    // persisted assignment keeps only the markers; legacy bare literals need
    // no round-trip (and stay compatible with an older core).
    let strategyConfig = assignment.config;
    const collectorConfigOverrides = new Map<string, Record<string, unknown>>();
    // Schema-free detection catches a marker/reference anywhere in the config -
    // including inside a Zod union, which a schema walk missed.
    const needsConfigSecrets =
      hasUnresolvedConfigSecrets({ config: assignment.config }) ||
      (assignment.collectors ?? []).some((entry) =>
        hasUnresolvedConfigSecrets({ config: entry.config }),
      );
    if (needsConfigSecrets) {
      const resolved = await deps.requestConfigSecrets({
        configId: assignment.configId,
        runId: crypto.randomUUID(),
      });
      strategyConfig = applyConfigSecretValues({
        config: assignment.config,
        values: resolved.strategy,
      });
      for (const entry of assignment.collectors ?? []) {
        const values = resolved.collectors[entry.id];
        if (values && Object.keys(values).length > 0) {
          collectorConfigOverrides.set(
            entry.id,
            applyConfigSecretValues({ config: entry.config, values }),
          );
        }
      }
    }

    // Fail CLOSED before the config is used: if any marker/reference survived
    // resolution (core lacked a schema, a value was undeliverable), refuse the
    // run rather than probe the target with the opaque marker as a credential.
    assertConfigSecretsResolved({
      config: strategyConfig,
      label: `Health check ${assignment.configId} strategy`,
    });
    for (const entry of assignment.collectors ?? []) {
      assertConfigSecretsResolved({
        config: collectorConfigOverrides.get(entry.id) ?? entry.config,
        label: `Health check ${assignment.configId} collector ${entry.id}`,
      });
    }

    // Build the client, render `{{ ... }}` templates, and run the collectors
    // through the SHARED engine - the SAME code path the core queue executor
    // uses. This is what makes `{{ system.metadata.* }}` / `{{ environment.* }}`
    // expand on a satellite exactly as they do locally (previously the satellite
    // had its own copy of the loop that never grew the templating pass, so
    // custom-field templates silently rendered to nothing here).
    //
    // The satellite's own edges are the JIT secret fetch and the RAW,
    // assertion-free result mapping: the satellite reports the received result
    // and the core evaluates the assignment's assertions on ingest.
    const outcome = await runHealthCheckCollection<
      NonNullable<SatelliteAssignment["collectors"]>[number]
    >({
      strategy,
      strategyConfig,
      collectors: assignment.collectors ?? [],
      runContext,
      pluginId: assignment.strategyId,
      logger,
      hooks: {
        getCollector: (entry) =>
          collectorRegistry.getCollector(entry.collectorId),
        storageKeyOf: (entry) => entry.id,
        // JIT run-secret (secretEnv) fetch, only for collectors that declare
        // one. Held in memory for this run; never persisted.
        resolveSecretEnv: async (entry) =>
          declaresSecretEnv(entry.config)
            ? deps.requestRunSecrets({
                configId: assignment.configId,
                collectorId: entry.id,
                runId: crypto.randomUUID(),
              })
            : undefined,
        // Config secrets were resolved up front; hand the engine the resolved
        // override (or the raw entry) as the pre-template config.
        prepareCollectorConfig: async (entry) =>
          collectorConfigOverrides.get(entry.id) ?? entry.config,
        mapResult: ({ entry, collectorResult }) => ({
          storageKey: entry.id,
          success: !collectorResult.error,
          error: collectorResult.error,
          storedResult: {
            _collectorId: entry.collectorId,
            // Annotate the collector's transport-level error the SAME way the
            // core executor does, so a satellite run's stored result carries
            // `_collectorError` like a local one (the core evaluates assertions
            // on ingest and sets `_assertionFailed` there). Without this the
            // satellite silently dropped the error annotation.
            _collectorError: collectorResult.error,
            ...(collectorResult.result as Record<string, unknown>),
          },
        }),
        mapError: ({ entry, error }) => ({
          storageKey: entry.id,
          success: false,
          error: String(error),
          storedResult: {
            _collectorId: entry.collectorId,
            error: String(error),
          },
        }),
      },
    });

    const status = outcome.hasCollectorError ? "unhealthy" : "healthy";
    const latencyMs = outcome.latencyMs;

    if (!outcome.connected) {
      // The transport client could not be built: a genuine connection failure,
      // not an application result. Mirrors the pre-extraction catch-path shape.
      const message = outcome.errorMessage ?? "Connection failed";
      return {
        type: "result",
        configId: assignment.configId,
        systemId: assignment.systemId,
        environmentId: environment?.id ?? null,
        status: "unhealthy",
        latencyMs,
        executedAt: new Date().toISOString(),
        result: {
          status: "unhealthy",
          latencyMs,
          message,
          metadata: { connected: false, error: message },
        },
      };
    }

    // 3. Build result — matches the local queue-executor structure so the
    //    frontend auto-charts and history detail page work identically.
    return {
      type: "result",
      configId: assignment.configId,
      systemId: assignment.systemId,
      environmentId: environment?.id ?? null,
      status,
      latencyMs,
      executedAt: new Date().toISOString(),
      result: {
        status,
        latencyMs,
        message: outcome.errorMessage
          ? `Check failed: ${outcome.errorMessage}`
          : `Completed in ${latencyMs}ms`,
        metadata: {
          connected: true,
          connectionTimeMs: outcome.connectionTimeMs,
          // Transport sub-phase timings measured HERE, at the satellite - the
          // core cannot derive the timing of a probe it did not run (and may
          // have no route to the target), so the satellite surfaces them and
          // the core persists them as-is. The shared engine already filtered
          // them to present phases, so both sides store an identical shape.
          ...(outcome.clientTimings ? { timings: outcome.clientTimings } : {}),
          collectors: outcome.collectorResults,
        },
      },
    };
  } catch (error) {
    // A PRE-run failure (config-secret delivery, or a fail-closed assertion).
    // The engine itself never throws - it returns an outcome - so reaching here
    // means the probe never started.
    return {
      type: "result",
      configId: assignment.configId,
      systemId: assignment.systemId,
      environmentId: environment?.id ?? null,
      status: "unhealthy",
      latencyMs: 0,
      executedAt: new Date().toISOString(),
      result: {
        status: "unhealthy",
        latencyMs: 0,
        message: String(error),
        metadata: {
          connected: false,
          error: String(error),
        },
      },
    };
  }
}
