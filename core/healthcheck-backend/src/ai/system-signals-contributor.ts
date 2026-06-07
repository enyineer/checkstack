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
 * The slice of `HealthCheckService` this contributor needs: a global,
 * pod-independent scan of every currently-degraded/unhealthy system. Narrowed
 * to an interface so the contributor is unit-testable without constructing the
 * full service (or a database).
 */
export interface HealthcheckSignalsSource {
  getAllUnhealthySystemStatuses(): Promise<HealthcheckSignalStatuses>;
}

/**
 * Build the healthcheck contributor for the AI `system.issues` aggregator. Reads
 * the global durable scan of unhealthy systems and runs the SAME deriver the
 * dashboard filler uses. The per-source access gate (global `healthcheck.status`
 * plus per-system team grants) is applied by
 * {@link createGatedSystemSignalsContributor}.
 */
export function createHealthcheckSignalsContributor({
  service,
  resolver,
}: {
  service: HealthcheckSignalsSource;
  resolver: SystemAccessResolver;
}): SystemSignalsContributor {
  return createGatedSystemSignalsContributor({
    sourceId: HEALTHCHECK_SIGNAL_SOURCE_ID,
    accessRule: healthCheckAccess.status,
    resolver,
    readSignals: async () =>
      deriveHealthcheckSignals({
        statuses: await service.getAllUnhealthySystemStatuses(),
      }),
  });
}
