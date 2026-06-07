import type { Logger } from "@checkstack/backend-api";
import {
  createGatedSystemSignalsContributor,
  type SystemAccessResolver,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";
import type { InferClient } from "@checkstack/common";
import { CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  dependencyAccess,
  deriveDependencySignals,
  DEPENDENCY_SIGNAL_SOURCE_ID,
  type DependencyWarning,
} from "@checkstack/dependency-common";
import type { DependencyService } from "../services/dependency-service";
import type {
  SystemStatus,
  WarningEvaluationService,
} from "../services/warning-evaluation-service";

/**
 * Build the dependency plugin's `system.issues` contributor.
 *
 * It evaluates dependency warnings for ALL systems globally from the shared,
 * durable `dependencies` table (so the answer is identical on every pod) and
 * runs the SHARED {@link deriveDependencySignals} deriver. The per-source access
 * gate (global `dependency.read` plus per-system team grants) is applied by
 * {@link createGatedSystemSignalsContributor}.
 */
export function createDependencySystemSignalsContributor({
  service,
  warningService,
  catalogClient,
  healthCheckClient,
  resolver,
  logger,
}: {
  service: DependencyService;
  warningService: WarningEvaluationService;
  catalogClient: InferClient<typeof CatalogApi>;
  healthCheckClient: InferClient<typeof HealthCheckApi>;
  resolver: SystemAccessResolver;
  logger: Logger;
}): SystemSignalsContributor {
  /**
   * Build system statuses for warning evaluation across the given systems.
   * Mirrors the router/afterPluginsReady `fetchSystemStatuses` helpers: it
   * combines catalog system names with bulk health status, defaulting to
   * operational when health data is unavailable.
   */
  async function fetchSystemStatuses(
    systemIds: string[],
  ): Promise<Map<string, SystemStatus>> {
    const statuses = new Map<string, SystemStatus>();
    const { systems } = await catalogClient.getSystems();
    const systemMap = new Map(systems.map((s) => [s.id, s]));

    try {
      const { statuses: healthStatuses } =
        await healthCheckClient.getBulkSystemHealthStatus({ systemIds });

      for (const systemId of systemIds) {
        const system = systemMap.get(systemId);
        if (!system) continue;

        const healthStatus = healthStatuses[systemId];
        if (healthStatus) {
          let overallStatus: "operational" | "degraded" | "down" =
            "operational";
          if (healthStatus.status === "unhealthy") {
            overallStatus = "down";
          } else if (healthStatus.status === "degraded") {
            overallStatus = "degraded";
          }

          statuses.set(systemId, {
            systemId,
            systemName: system.name,
            status: overallStatus,
            healthCheckStatuses: healthStatus.checkStatuses.map((cs) => ({
              healthCheckId: cs.configurationId,
              status: cs.status,
            })),
          });
        } else {
          statuses.set(systemId, {
            systemId,
            systemName: system.name,
            status: "operational",
          });
        }
      }
    } catch (error) {
      logger.debug(
        `Failed to bulk-fetch health statuses for system signals: ${String(error)}`,
      );
      for (const systemId of systemIds) {
        const system = systemMap.get(systemId);
        if (!system) continue;
        statuses.set(systemId, {
          systemId,
          systemName: system.name,
          status: "operational",
        });
      }
    }

    return statuses;
  }

  /**
   * Evaluate dependency warnings for EVERY system that participates in a
   * dependency edge. There is no per-system input here: the contributor reports
   * problems globally, and only systems with an actual warning end up in the
   * result (healthy/empty systems are dropped by the evaluation engine).
   */
  async function evaluateGlobalWarnings(): Promise<
    Record<string, DependencyWarning>
  > {
    const allDeps = await service.getAllDependencies();
    if (allDeps.length === 0) return {};

    // Every system referenced by any edge is both an evaluation target and a
    // status source - source systems can carry a warning, target systems
    // supply the upstream status that drives it.
    const allSystemIds = new Set<string>();
    for (const dep of allDeps) {
      allSystemIds.add(dep.sourceSystemId);
      allSystemIds.add(dep.targetSystemId);
    }
    const systemIds = [...allSystemIds];

    const statuses = await fetchSystemStatuses(systemIds);
    const warningMap = warningService.evaluateWarnings({
      systemIds,
      allDependencies: allDeps,
      systemStatuses: statuses,
    });

    const warnings: Record<string, DependencyWarning> = {};
    for (const [systemId, warning] of warningMap) {
      warnings[systemId] = warning;
    }
    return warnings;
  }

  return createGatedSystemSignalsContributor({
    sourceId: DEPENDENCY_SIGNAL_SOURCE_ID,
    accessRule: dependencyAccess.dependency.read,
    resolver,
    readSignals: async () =>
      deriveDependencySignals({ warnings: await evaluateGlobalWarnings() }),
  });
}
