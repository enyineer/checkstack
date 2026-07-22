import type { Logger } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import type { CatalogApi } from "@checkstack/catalog-common";
import type {
  HealthCheckApi,
  SystemHealthStatus,
} from "@checkstack/healthcheck-common";
import type { SystemStatus, SliceStatus } from "./warning-evaluation-service";

type HealthCheckStatus = "healthy" | "degraded" | "unhealthy";

/** Map a health-check status enum to the dependency status vocabulary. */
function toDependencyStatus(
  status: HealthCheckStatus,
): "operational" | "degraded" | "down" {
  if (status === "unhealthy") return "down";
  if (status === "degraded") return "degraded";
  return "operational";
}

function toSlice(source: {
  status: SystemHealthStatus;
  checkStatuses: Array<{ configurationId: string; status: SystemHealthStatus }>;
}): SliceStatus {
  return {
    // An UNMEASURED upstream must not raise a dependency warning: "we have not
    // measured this" is not evidence that a downstream is at risk, and treating
    // it as `down` would alarm on every newly-added system. It maps to
    // `operational` here purely so dependency alerting behaves exactly as it did
    // before `unknown` existed - deliberately NOT a claim that the system is
    // healthy, which is what the catalog and status page now report honestly.
    status:
      source.status === "unknown"
        ? "operational"
        : toDependencyStatus(source.status),
    // A check that has never run says nothing about the dependency, so it is
    // dropped rather than counted as passing.
    healthCheckStatuses: source.checkStatuses
      .filter(
        (cs): cs is typeof cs & { status: HealthCheckStatus } =>
          cs.status !== "unknown",
      )
      .map((cs) => ({
        healthCheckId: cs.configurationId,
        status: cs.status,
      })),
  };
}

/**
 * Build the `SystemStatus` map the warning evaluator consumes.
 *
 * Uses the per-(system, check, environment) health matrix so environment- and
 * check-scoped dependency cells can read the exact slice they target. Catalog
 * names are joined in. On any failure every requested system defaults to
 * operational (fail-safe: a health read outage must not manufacture warnings).
 *
 * Shared by the RPC router (`getWarnings`) and the notification sidecar so both
 * see identical per-environment data.
 */
export async function buildSystemStatuses({
  systemIds,
  catalogClient,
  healthCheckClient,
  logger,
}: {
  systemIds: string[];
  catalogClient: InferClient<typeof CatalogApi>;
  healthCheckClient: InferClient<typeof HealthCheckApi>;
  logger?: Logger;
}): Promise<Map<string, SystemStatus>> {
  const statuses = new Map<string, SystemStatus>();

  const { systems } = await catalogClient.getSystems();
  const systemMap = new Map(systems.map((s) => [s.id, s]));

  const setOperational = (systemId: string) => {
    const system = systemMap.get(systemId);
    if (!system) return;
    statuses.set(systemId, {
      systemId,
      systemName: system.name,
      status: "operational",
    });
  };

  try {
    const { statuses: matrix } =
      await healthCheckClient.getBulkSystemHealthMatrix({ systemIds });

    for (const systemId of systemIds) {
      const system = systemMap.get(systemId);
      if (!system) continue;

      const m = matrix[systemId];
      if (!m) {
        setOperational(systemId);
        continue;
      }

      const environments: Record<string, SliceStatus> = {};
      for (const [envId, envSlice] of Object.entries(m.environments)) {
        environments[envId] = toSlice(envSlice);
      }

      const rollup = toSlice(m);
      statuses.set(systemId, {
        systemId,
        systemName: system.name,
        status: rollup.status,
        healthCheckStatuses: rollup.healthCheckStatuses,
        environments,
      });
    }
  } catch (error) {
    logger?.debug(`Failed to fetch health matrix: ${String(error)}`);
    for (const systemId of systemIds) {
      setOperational(systemId);
    }
  }

  return statuses;
}
