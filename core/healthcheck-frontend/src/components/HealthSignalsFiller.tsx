import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  SystemSignalsSlot,
  type SystemSignal,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  healthcheckRoutes,
  healthCheckAccess,
} from "@checkstack/healthcheck-common";
import { HealthCheckApi } from "../api";

type Props = SlotContext<typeof SystemSignalsSlot>;

const SOURCE_ID = "healthcheck";

/**
 * Reports per-system health as dashboard signals. Bulk-fetches health for all
 * overview systems in one request and contributes a signal for every system
 * that is degraded or unhealthy, deep-linking to the failing check's history
 * (or the system's check assignments when no specific check is failing).
 * Renders nothing — it is a headless filler for {@link SystemSignalsSlot}.
 */
export const HealthSignalsFiller: React.FC<Props> = ({
  systemIds,
  onSignals,
}) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const { data } = healthCheckClient.getBulkSystemHealthStatus.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const signals = useMemo<SystemSignalsMap>(() => {
    const result: SystemSignalsMap = {};
    if (!data) return result;

    for (const systemId of systemIds) {
      const status = data.statuses[systemId];
      if (!status || status.status === "healthy") continue;

      const failing = status.checkStatuses.filter(
        (c) => c.status !== "healthy",
      );
      const failingCheck = failing[0];
      // Link target and its gating rule differ: the check history detail page
      // needs `details`; the assignments page needs `configuration.manage`. The
      // dashboard renders text instead of a link for users without the rule.
      const { href, accessRule } = failingCheck
        ? {
            href: resolveRoute(healthcheckRoutes.routes.historyDetail, {
              systemId,
              configurationId: failingCheck.configurationId,
            }),
            accessRule: healthCheckAccess.details,
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
        source: SOURCE_ID,
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
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
