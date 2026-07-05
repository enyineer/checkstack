import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { HealthCheckApi } from "../api";
import { StatusBadge } from "@checkstack/ui";
import { Activity } from "lucide-react";
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

  const { data: healthData } = healthCheckClient.getSystemHealthStatus.useQuery(
    { systemId: system?.id ?? "" },
    {
      enabled: !badgeData && !!system?.id,
      staleTime: 30_000,
    },
  );

  const health = providerData?.health ?? healthData;
  const status = health?.status;

  if (!status || status === "healthy") return <></>;

  const baseLabel = status === "unhealthy" ? "Unhealthy" : "Degraded";
  // Explain WHY the system reads this way when an incident (not a health check)
  // forced the status - surfaced on hover / to assistive tech via the label.
  const label = health?.override
    ? `${baseLabel} - forced by incident: ${health.override.reason}`
    : baseLabel;

  return status === "unhealthy" ? (
    <StatusBadge tone="error" icon={Activity} label={label} />
  ) : (
    <StatusBadge tone="warn" icon={Activity} label={label} />
  );
};
