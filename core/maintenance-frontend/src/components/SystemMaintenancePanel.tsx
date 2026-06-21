import React from "react";
import { Link } from "react-router-dom";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import { MaintenanceApi } from "../api";
import { maintenanceRoutes } from "@checkstack/maintenance-common";
import { LoadingSpinner, Button } from "@checkstack/ui";
import { Wrench, History } from "lucide-react";

const PANEL_SHADOW =
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

type Props = SlotContext<typeof SystemDetailsSlot>;

/**
 * Panel shown on system detail pages displaying active/upcoming maintenances.
 * Listens for realtime updates via signals.
 */
export const SystemMaintenancePanel: React.FC<Props> = ({ system }) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);

  // Fetch maintenances with useQuery — kept fresh via SignalAutoInvalidator.
  const { data: maintenances = [], isLoading: loading } =
    maintenanceClient.getMaintenancesForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !!system?.id }
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-[var(--d-card-r)] border border-border/70 bg-surface px-3 py-2">
        <LoadingSpinner />
      </div>
    );
  }

  if (maintenances.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface px-3 py-2">
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
  const leadCount = active.length > 0 ? active.length : scheduled.length;
  const leadCaption = active.length > 0 ? "in progress" : "scheduled";

  return (
    <div
      className={`relative flex items-center justify-between gap-3 overflow-hidden rounded-[var(--d-card-r)] border border-status-warn/30 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] ${PANEL_SHADOW}`}
    >
      <span
        className="absolute inset-y-0 left-0 w-1 bg-status-warn"
        aria-hidden
      />
      <div className="flex min-w-0 items-center gap-3 pl-2">
        <Wrench className="h-4 w-4 shrink-0 text-status-warn" />
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-none tabular-nums text-status-warn">
            {leadCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{leadCaption}</p>
        </div>
        {active.length > 0 && scheduled.length > 0 && (
          <span className="truncate text-xs text-muted-foreground">
            + {scheduled.length} scheduled
          </span>
        )}
      </div>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" asChild>
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
