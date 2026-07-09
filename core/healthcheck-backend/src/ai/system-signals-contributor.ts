import {
  deriveHealthcheckSignals,
  healthCheckAccess,
  HEALTHCHECK_SIGNAL_SOURCE_ID,
  type HealthcheckSignalStatuses,
} from "@checkstack/healthcheck-common";
import {
  createGatedSystemSignalsContributor,
  type SystemAccessResolver,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";

/**
 * The slice of `HealthCheckService` this contributor needs: the candidate set
 * for the global problem scan (systems with at least one enabled check
 * association). Narrowed to an interface so the contributor is unit-testable
 * without constructing the full service (or a database).
 */
export interface HealthcheckCandidateSource {
  getUnhealthyCandidateSystemIds(): Promise<string[]>;
}

/**
 * The slice of `HealthCheckCache` this contributor reads through: the per-entity
 * bulk status read. Routing the scan through the cache (rather than the service's
 * uncached N+1 `getAllUnhealthySystemStatuses`) means the AI signals poll reuses
 * the warm badge/dashboard cache and does not fan out one DB derivation per
 * system on every poll.
 */
export interface HealthcheckStatusCacheReader {
  readBulk(systemIds: string[]): Promise<HealthcheckSignalStatuses>;
}

/**
 * Build the healthcheck contributor for the AI `system.issues` aggregator. Scans
 * the candidate systems (durable, pod-independent) and resolves each one's status
 * through the SHARED cache, then runs the SAME deriver the dashboard filler uses
 * (problems only - healthy systems are dropped). The per-source access gate
 * (global `healthcheck.status` plus per-system team grants) is applied by
 * {@link createGatedSystemSignalsContributor}.
 */
export function createHealthcheckSignalsContributor({
  candidateSource,
  cache,
  resolver,
}: {
  candidateSource: HealthcheckCandidateSource;
  cache: HealthcheckStatusCacheReader;
  resolver: SystemAccessResolver;
}): SystemSignalsContributor {
  return createGatedSystemSignalsContributor({
    sourceId: HEALTHCHECK_SIGNAL_SOURCE_ID,
    accessRule: healthCheckAccess.status,
    resolver,
    readSignals: async () => {
      const systemIds = await candidateSource.getUnhealthyCandidateSystemIds();
      const all = await cache.readBulk(systemIds);
      // Keep only degraded/unhealthy systems (the same filter the uncached scan
      // applied); the deriver drops healthy/unknown anyway, but filtering here
      // keeps the payload small.
      const statuses: HealthcheckSignalStatuses = {};
      for (const [systemId, status] of Object.entries(all)) {
        if (status.status !== "healthy") statuses[systemId] = status;
      }
      return deriveHealthcheckSignals({ statuses });
    },
  });
}
