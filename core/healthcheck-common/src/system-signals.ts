import { resolveRoute } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalsMap,
} from "@checkstack/catalog-common";

import { healthCheckAccess } from "./access";
import { healthcheckRoutes } from "./routes";
import type { SystemHealthStatusResponse } from "./rpc-contract";

/**
 * Stable source id for every health-derived {@link SystemSignal}. Shared by the
 * frontend dashboard filler and the backend system-signals contributor so both
 * de-duplicate against the same source.
 */
export const HEALTHCHECK_SIGNAL_SOURCE_ID = "healthcheck";

/**
 * Per-system evaluated health status, keyed by systemId. This is the exact shape
 * the bulk RPC (`getBulkSystemHealthStatus`) returns under `statuses`, so both
 * the frontend (RPC result) and the backend (direct service call) can feed the
 * pure deriver below without reshaping.
 */
export type HealthcheckSignalStatuses = Record<
  string,
  SystemHealthStatusResponse
>;

/**
 * Pure, dependency-free deriver: turn evaluated per-system health statuses into
 * the dashboard {@link SystemSignalsMap}. Only systems that are degraded or
 * unhealthy produce a signal; healthy (or unknown) systems are omitted.
 *
 * Identical output to the (former) inline transform in `HealthSignalsFiller`:
 * same source/tone/label/detail/href/accessRule/iconName. `href`/`accessRule`
 * are frontend-only (the dashboard renders a gated deep link); the backend
 * aggregator passes signals through and drops those fields itself.
 */
export function deriveHealthcheckSignals({
  statuses,
}: {
  statuses: HealthcheckSignalStatuses;
}): SystemSignalsMap {
  const result: SystemSignalsMap = {};

  for (const [systemId, status] of Object.entries(statuses)) {
    if (!status || status.status === "healthy") continue;

    const failing = status.checkStatuses.filter((c) => c.status !== "healthy");
    const failingCheck = failing[0];
    // Both link targets gate on `configuration.manage`: detailed run history
    // is a manager surface (globally or via a team grant). The signal's
    // accessRule is a GLOBAL check, so team-scoped managers see text instead
    // of a link here - they reach the same history via the Health Checks page.
    const { href, accessRule } = failingCheck
      ? {
          href: resolveRoute(healthcheckRoutes.routes.historyDetail, {
            systemId,
            configurationId: failingCheck.configurationId,
          }),
          accessRule: healthCheckAccess.configuration.manage,
        }
      : {
          href: resolveRoute(healthcheckRoutes.routes.assignments, {
            systemId,
          }),
          accessRule: healthCheckAccess.configuration.manage,
        };

    const detail =
      status.checkStatuses.length > 0
        ? `${failing.length} of ${status.checkStatuses.length} checks failing`
        : undefined;

    const signal: SystemSignal = {
      source: HEALTHCHECK_SIGNAL_SOURCE_ID,
      tone: status.status === "unhealthy" ? "error" : "warn",
      label: status.status === "unhealthy" ? "Unhealthy" : "Degraded",
      detail,
      href,
      accessRule,
      iconName: "Activity",
    };
    result[systemId] = [signal];
  }

  return result;
}
