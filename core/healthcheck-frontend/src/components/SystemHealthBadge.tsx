import React, { useEffect, useState } from "react";
import { useApi, type SlotContext } from "@checkmate/frontend-api";
import { SystemStateBadgesSlot } from "@checkmate/catalog-common";
import { healthCheckApiRef, type HealthCheckRun } from "../api";
import { HealthBadge, type HealthStatus } from "@checkmate/ui";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Displays a health badge for a system based on its health check results.
 * Fetches health check history and calculates the aggregate status.
 */
export const SystemHealthBadge: React.FC<Props> = ({ system }) => {
  const api = useApi(healthCheckApiRef);
  const [status, setStatus] = useState<HealthStatus>();

  useEffect(() => {
    if (!system?.id) return;

    api
      .getHistory({ systemId: system.id, limit: 50 })
      .then((runs: HealthCheckRun[]) => {
        // Calculate aggregate status from latest run of each configuration
        const configLatestRuns = new Map<string, HealthCheckRun>();

        for (const run of runs) {
          const existing = configLatestRuns.get(run.configurationId);
          if (
            !existing ||
            new Date(run.timestamp) > new Date(existing.timestamp)
          ) {
            configLatestRuns.set(run.configurationId, run);
          }
        }

        if (configLatestRuns.size === 0) {
          // No health checks configured - show healthy by default
          setStatus("healthy");
          return;
        }

        // Aggregate: unhealthy > degraded > healthy
        const statuses = new Set(
          [...configLatestRuns.values()].map((r) => r.status)
        );
        if (statuses.has("unhealthy")) {
          setStatus("unhealthy");
        } else if (statuses.has("degraded")) {
          setStatus("degraded");
        } else {
          setStatus("healthy");
        }
      })
      .catch(console.error);
  }, [system?.id, api]);

  if (!status) return;
  return <HealthBadge status={status} />;
};
