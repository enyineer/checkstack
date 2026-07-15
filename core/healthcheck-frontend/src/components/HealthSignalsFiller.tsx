import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import {
  SystemSignalsSlot,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  deriveHealthcheckSignals,
  HEALTHCHECK_SIGNAL_SOURCE_ID,
} from "@checkstack/healthcheck-common";
import { HealthCheckApi } from "../api";

type Props = SlotContext<typeof SystemSignalsSlot>;

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
  onLoadingChange,
}) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const { data, isLoading } = healthCheckClient.getBulkSystemHealthStatus.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const signals = useMemo<SystemSignalsMap>(() => {
    if (!data) return {};
    return deriveHealthcheckSignals({ statuses: data.statuses });
  }, [data]);

  useEffect(() => {
    onSignals(HEALTHCHECK_SIGNAL_SOURCE_ID, signals);
  }, [signals, onSignals]);

  // Report load state so the dashboard holds its overview skeleton until this
  // (and every other source) has settled, instead of flashing "all healthy".
  useEffect(() => {
    if (systemIds.length === 0) return;
    onLoadingChange(HEALTHCHECK_SIGNAL_SOURCE_ID, isLoading);
  }, [isLoading, systemIds.length, onLoadingChange]);

  return null;
};
