import React from "react";
import { Link } from "react-router-dom";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { resolveRoute } from "@checkstack/common";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import { MaintenanceApi } from "../api";
import {
  maintenanceRoutes,
  MAINTENANCE_UPDATED,
} from "@checkstack/maintenance-common";
import { LoadingSpinner, Button } from "@checkstack/ui";
import { Wrench, History } from "lucide-react";

type Props = SlotContext<typeof SystemDetailsSlot>;

/**
 * Panel shown on system detail pages displaying active/upcoming maintenances.
 * Listens for realtime updates via signals.
 */
export const SystemMaintenancePanel: React.FC<Props> = ({ system }) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);

  // Fetch maintenances with useQuery
  const {
    data: maintenances = [],
    isLoading: loading,
    refetch,
  } = maintenanceClient.getMaintenancesForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id }
  );

  // Listen for realtime maintenance updates
  useSignal(MAINTENANCE_UPDATED, ({ systemIds }) => {
    if (system?.id && systemIds.includes(system.id)) {
      void refetch();
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-md border border-border/50 bg-card px-3 py-2">
        <LoadingSpinner />
      </div>
    );
  }

  if (maintenances.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border/50 bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" />
          <span className="text-sm">No planned maintenances</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
          <Link
            to={resolveRoute(maintenanceRoutes.routes.systemHistory, {
              systemId: system.id,
            })}
          >
            <History className="h-3 w-3 mr-1" />
            History
          </Link>
        </Button>
      </div>
    );
  }

  const active = maintenances.filter((m) => m.status === "in_progress");
  const scheduled = maintenances.filter((m) => m.status === "scheduled");

  return (
    <div className="flex items-center justify-between rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Wrench className="h-3.5 w-3.5 text-warning shrink-0" />
        <span className="text-sm font-medium truncate">
          {active.length > 0
            ? `${active.length} in progress`
            : `${scheduled.length} scheduled`}
        </span>
        {active.length > 0 && scheduled.length > 0 && (
          <span className="text-xs text-muted-foreground">
            + {scheduled.length} scheduled
          </span>
        )}
      </div>
      <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" asChild>
        <Link
          to={resolveRoute(maintenanceRoutes.routes.systemHistory, {
            systemId: system.id,
          })}
        >
          <History className="h-3 w-3 mr-1" />
          View
        </Link>
      </Button>
    </div>
  );
};
