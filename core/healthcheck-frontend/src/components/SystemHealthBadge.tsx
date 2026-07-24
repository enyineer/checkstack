import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { HealthCheckApi } from "../api";
import { StatusBadge } from "@checkstack/ui";
import { Activity } from "lucide-react";
import { useSystemBadgeDataOptional } from "@checkstack/dashboard-frontend";
import { resolveHealthBadge } from "./systemHealthBadge.logic";

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

  // The badge flags PROBLEM states only (`degraded` / `unhealthy`). `healthy`
  // and `unknown` (unmeasured: no checks, or none have run yet) produce no
  // badge - see `resolveHealthBadge`. This is what stops a check-less system
  // from falsely reading "Degraded".
  const badge = resolveHealthBadge({
    status: health?.status,
    overrideReason: health?.override?.reason,
  });
  if (!badge) return <></>;

  return <StatusBadge tone={badge.tone} icon={Activity} label={badge.label} />;
};
