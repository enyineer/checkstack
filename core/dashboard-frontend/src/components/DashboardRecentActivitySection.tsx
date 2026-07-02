import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { CatalogApi } from "@checkstack/catalog-common";
import { SectionHeader, TerminalFeed, type TerminalEntry } from "@checkstack/ui";
import { Terminal } from "lucide-react";
import { HEALTH_CHECK_RUN_COMPLETED } from "@checkstack/healthcheck-common";
import { useSignal } from "@checkstack/signal-frontend";
import { buildRunActivityContent } from "../logic/recentActivity";

const MAX_TERMINAL_ENTRIES = 8;

const statusToVariant = (
  status: string,
): "default" | "success" | "warning" | "error" => {
  switch (status) {
    case "healthy": {
      return "success";
    }
    case "degraded": {
      return "warning";
    }
    case "unhealthy": {
      return "error";
    }
    default: {
      return "default";
    }
  }
};

/**
 * Dashboard section: the recent-activity terminal feed.
 *
 * Registered as a DashboardSlot extension with priority 30 so it renders last.
 * Self-contained: subscribes to health-check-run signals to populate the feed
 * and fetches the entities query (react-query dedupes) only to gate on
 * systems existing - the feed is meaningless on a fresh install.
 */
export const DashboardRecentActivitySection: React.FC = () => {
  const catalogClient = usePluginClient(CatalogApi);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);

  const { data: entitiesData } = catalogClient.getEntities.useQuery(
    {},
    { staleTime: 30_000 },
  );
  const systemsCount = entitiesData?.systems.length ?? 0;

  useSignal(
    HEALTH_CHECK_RUN_COMPLETED,
    ({ systemName, configurationName, status, latencyMs, environmentName }) => {
      const newEntry: TerminalEntry = {
        id: `${configurationName}-${Date.now()}`,
        timestamp: new Date(),
        content: buildRunActivityContent({
          systemName,
          configurationName,
          status,
          environmentName,
        }),
        variant: statusToVariant(status),
        suffix: latencyMs === undefined ? undefined : `${latencyMs}ms`,
      };
      setTerminalEntries((prev) =>
        [newEntry, ...prev].slice(0, MAX_TERMINAL_ENTRIES),
      );
    },
  );

  if (systemsCount === 0) return null;

  return (
    <section>
      <SectionHeader
        title="Recent activity"
        icon={<Terminal className="w-5 h-5" />}
      />
      <TerminalFeed
        entries={terminalEntries}
        maxEntries={MAX_TERMINAL_ENTRIES}
        maxHeight="320px"
        title="checkstack status --watch"
      />
    </section>
  );
};
