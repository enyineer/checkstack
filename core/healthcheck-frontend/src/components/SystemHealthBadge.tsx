import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { HealthCheckApi } from "../api";
import { HealthBadge } from "@checkstack/ui";
import { useSystemBadgeDataOptional } from "@checkstack/dashboard-frontend";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Displays a health badge for a system based on its health check results.
 * Uses the backend's getSystemHealthStatus endpoint which evaluates
 * health status based on configured state thresholds.
 *
 * When rendered within SystemBadgeDataProvider, uses bulk-fetched data.
 * Otherwise, falls back to individual fetch.
 *
 * Realtime updates arrive via the SignalAutoInvalidator (auto-invalidates
 * `[["healthcheck"]]` queries when SYSTEM_STATUS_CHANGED fires).
 */
export const SystemHealthBadge: React.FC<Props> = ({ system }) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const badgeData = useSystemBadgeDataOptional();

  const providerData = badgeData?.getSystemBadgeData(system?.id ?? "");
  const providerStatus = providerData?.health?.status;

  const { data: healthData } = healthCheckClient.getSystemHealthStatus.useQuery(
    { systemId: system?.id ?? "" },
    {
      enabled: !badgeData && !!system?.id,
      staleTime: 30_000,
    },
  );

  const localStatus = healthData?.status;
  const status = providerStatus ?? localStatus;

  if (!status || status === "healthy") return <></>;
  return <HealthBadge status={status} />;
};
