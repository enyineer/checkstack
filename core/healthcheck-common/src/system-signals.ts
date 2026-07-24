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
    // Only degraded/unhealthy systems produce a signal. `healthy` AND `unknown`
    // are omitted: an unmeasured system (no checks, or none run yet) is "no
    // signal", not a fault - emitting it would fall through to the "Degraded"
    // label/tone below and surface a check-less system as a dashboard problem
    // (the false "Degraded" this guards against).
    if (
      !status ||
      status.status === "healthy" ||
      status.status === "unknown"
    ) {
      continue;
    }

    const failingCheck = status.checkStatuses.find(
      (c) => c.status !== "healthy",
    );

    // Count over (check × environment) SLICES, not checks: a single check that
    // fans out to three environments and fails in one is "1 of 3 failing", not
    // "1 of 1". `sliceCount` is >= 1 per check (env-less counts as one slice),
    // so a non-fanned system reads exactly as before.
    const failingSlices = status.checkStatuses.reduce(
      (sum, c) => sum + c.failingSliceCount,
      0,
    );
    const totalSlices = status.checkStatuses.reduce(
      (sum, c) => sum + c.sliceCount,
      0,
    );

    // The label/tone reflect the system's OVERALL health (`status.status`), which
    // already folds in any active incident override - so an operator who forced a
    // system unhealthy sees it here even with every check green.
    //
    // The DETAIL explains the cause honestly instead of always claiming checks
    // are failing: the failing-check count when any check is failing, otherwise
    // the incident that forced the status (never a misleading "0 of N checks
    // failing"). The deep link points at a failing check's run history when there
    // is one; a purely override-driven signal has no check to link to, so it
    // renders as plain text and the incident's own signal carries the link.
    // The accessRule gates that link on `configuration.manage` (a manager
    // surface); team-scoped managers without the global rule see plain text.
    const href = failingCheck
      ? resolveRoute(healthcheckRoutes.routes.historyDetail, {
          systemId,
          configurationId: failingCheck.configurationId,
        })
      : undefined;
    const accessRule = failingCheck
      ? healthCheckAccess.configuration.manage
      : undefined;

    const detail =
      failingSlices > 0
        ? `${failingSlices} of ${totalSlices} checks failing`
        : status.override
          ? `Forced by incident: ${status.override.reason}`
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
