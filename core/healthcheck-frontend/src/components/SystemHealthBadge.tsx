import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { HEALTH_CHECK_RUN_COMPLETED } from "@checkstack/healthcheck-common";
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
 * Listens for realtime updates via signals.
 */
export const SystemHealthBadge: React.FC<Props> = ({ system }) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const badgeData = useSystemBadgeDataOptional();

  // Try to get data from provider first
  const providerData = badgeData?.getSystemBadgeData(system?.id ?? "");
  const providerStatus = providerData?.health?.status;

  // Query for health status if not using provider
  // When badgeData exists (inside provider), this query is disabled
  const { data: healthData, refetch } =
    healthCheckClient.getSystemHealthStatus.useQuery(
      { systemId: system?.id ?? "" },
      {
        enabled: !badgeData && !!system?.id,
        staleTime: 30_000, // Prevent unnecessary refetches
      }
    );

  const localStatus = healthData?.status;

  // Listen for realtime health check updates (only in fallback mode)
  useSignal(HEALTH_CHECK_RUN_COMPLETED, ({ systemId: changedId }) => {
    if (!badgeData && changedId === system?.id) {
      void refetch();
    }
  });

  // Use provider data if available, otherwise use local state
  const status = providerStatus ?? localStatus;

  if (!status) return <></>;
  return <HealthBadge status={status} />;
};
