import React, { useEffect } from "react";
import { Link } from "react-router";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import { MaintenanceApi } from "../api";
import { maintenanceRoutes } from "@checkstack/maintenance-common";
import {
  LoadingSpinner,
  Button,
  DetailCard,
  pillToneStyles,
} from "@checkstack/ui";
import { Wrench, History } from "lucide-react";
import { getMaintenanceStatusTone } from "../utils/badges";

type Props = SlotContext<typeof SystemDetailsSlot>;

/**
 * Panel shown on system detail pages displaying active/upcoming maintenances.
 * Listens for realtime updates via signals.
 */
export const SystemMaintenancePanel: React.FC<Props> = ({
  system,
  onLoadingChange,
}) => {
  const maintenanceClient = usePluginClient(MaintenanceApi);

  // Fetch maintenances with useQuery — kept fresh via SignalAutoInvalidator.
  const { data: maintenances = [], isLoading: loading } =
    maintenanceClient.getMaintenancesForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !!system?.id }
    );

  // Report load state so the detail page reveals all overview cards together
  // instead of each popping in as its own fetch settles.
  useEffect(() => {
    onLoadingChange?.("maintenance.panel", loading);
  }, [loading, onLoadingChange]);

  if (loading) {
    return (
      <DetailCard surface="flat" className="flex items-center justify-center px-3 py-2">
        <LoadingSpinner />
      </DetailCard>
    );
  }

  if (maintenances.length === 0) {
    return (
      <DetailCard className="flex items-center justify-between px-3 py-2">
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
      </DetailCard>
    );
  }

  const active = maintenances.filter((m) => m.status === "in_progress");
  const scheduled = maintenances.filter((m) => m.status === "scheduled");
  const leadCount = active.length > 0 ? active.length : scheduled.length;
  const leadCaption = active.length > 0 ? "in progress" : "scheduled";
  // The card takes the tone of whichever window LEADS: amber `in_progress`
  // while one is running, else blue `scheduled`. Hardcoding amber painted an
  // upcoming-only window the same as a live one and disagreed with the blue
  // "Scheduled" pill everywhere else. Same canonical mapping as the pill.
  const leadTone = pillToneStyles[
    getMaintenanceStatusTone(active.length > 0 ? "in_progress" : "scheduled")
  ];

  return (
    <DetailCard
      className={`relative flex items-center justify-between gap-3 overflow-hidden ${leadTone.border} p-[var(--d-pad)]`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${leadTone.accent}`}
        aria-hidden
      />
      <div className="flex min-w-0 items-center gap-3 pl-2">
        <Wrench className={`h-4 w-4 shrink-0 ${leadTone.text}`} />
        <div className="min-w-0">
          <p
            className={`text-2xl font-bold leading-none tabular-nums ${leadTone.text}`}
          >
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
    </DetailCard>
  );
};
