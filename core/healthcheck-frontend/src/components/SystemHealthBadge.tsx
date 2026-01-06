import React, { useEffect, useState, useCallback } from "react";
import { useApi, type SlotContext } from "@checkmate-monitor/frontend-api";
import { useSignal } from "@checkmate-monitor/signal-frontend";
import { SystemStateBadgesSlot } from "@checkmate-monitor/catalog-common";
import { HEALTH_CHECK_STATE_CHANGED } from "@checkmate-monitor/healthcheck-common";
import { healthCheckApiRef } from "../api";
import { HealthBadge, type HealthStatus } from "@checkmate-monitor/ui";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Displays a health badge for a system based on its health check results.
 * Uses the backend's getSystemHealthStatus endpoint which evaluates
 * health status based on configured state thresholds.
 * Listens for realtime updates via signals.
 */
export const SystemHealthBadge: React.FC<Props> = ({ system }) => {
  const api = useApi(healthCheckApiRef);
  const [status, setStatus] = useState<HealthStatus>();

  const refetch = useCallback(() => {
    if (!system?.id) return;

    api
      .getSystemHealthStatus({ systemId: system.id })
      .then((result) => {
        setStatus(result.status);
      })
      .catch(console.error);
  }, [system?.id, api]);

  // Initial fetch
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Listen for realtime health check updates
  useSignal(HEALTH_CHECK_STATE_CHANGED, ({ systemId: changedId }) => {
    if (changedId === system?.id) {
      refetch();
    }
  });

  if (!status) return;
  return <HealthBadge status={status} />;
};
