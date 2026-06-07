import { isAccessRuleSatisfied } from "@checkstack/common";
import {
  deriveHealthcheckSignals,
  healthCheckAccess,
  HEALTHCHECK_SIGNAL_SOURCE_ID,
  type HealthcheckSignalStatuses,
} from "@checkstack/healthcheck-common";
import {
  principalGrantedRuleIds,
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
 * Build the healthcheck contributor for the AI `system.issues` aggregator.
 *
 * PER-SOURCE access is enforced here: the principal must satisfy
 * `healthcheck.status`, otherwise `read` returns `{}` (never throws). When
 * allowed, it derives signals from the global durable scan so the answer is
 * identical on every pod, reusing the SAME pure deriver the dashboard filler
 * uses.
 */
export function createHealthcheckSignalsContributor({
  service,
}: {
  service: HealthcheckSignalsSource;
}): SystemSignalsContributor {
  return {
    sourceId: HEALTHCHECK_SIGNAL_SOURCE_ID,
    read: async ({ principal }) => {
      if (
        !isAccessRuleSatisfied(
          principalGrantedRuleIds(principal),
          healthCheckAccess.status,
        )
      ) {
        return {};
      }
      const statuses = await service.getAllUnhealthySystemStatuses();
      return deriveHealthcheckSignals({ statuses });
    },
  };
}
