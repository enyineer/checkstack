import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useApi, type SlotContext } from "@checkmate-monitor/frontend-api";
import { useSignal } from "@checkmate-monitor/signal-frontend";
import { resolveRoute } from "@checkmate-monitor/common";
import { SystemDetailsSlot } from "@checkmate-monitor/catalog-common";
import { maintenanceApiRef } from "../api";
import {
  maintenanceRoutes,
  MAINTENANCE_UPDATED,
  type MaintenanceWithSystems,
} from "@checkmate-monitor/maintenance-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  LoadingSpinner,
  Button,
} from "@checkmate-monitor/ui";
import { Wrench, Clock, Calendar, History, ChevronRight } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

type Props = SlotContext<typeof SystemDetailsSlot>;

/**
 * Panel shown on system detail pages displaying active/upcoming maintenances.
 * Listens for realtime updates via signals.
 */
export const SystemMaintenancePanel: React.FC<Props> = ({ system }) => {
  const api = useApi(maintenanceApiRef);
  const [maintenances, setMaintenances] = useState<MaintenanceWithSystems[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!system?.id) return;

    api
      .getMaintenancesForSystem({ systemId: system.id })
      .then(setMaintenances)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [system?.id, api]);

  // Initial fetch
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Listen for realtime maintenance updates
  useSignal(MAINTENANCE_UPDATED, ({ systemIds }) => {
    if (system?.id && systemIds.includes(system.id)) {
      refetch();
    }
  });

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex justify-center">
          <LoadingSpinner />
        </CardContent>
      </Card>
    );
  }

  if (maintenances.length === 0) {
    // Show a subtle card with just the history button when no active maintenances
    return (
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wrench className="h-4 w-4" />
              <span className="text-sm">No active maintenances</span>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link
                to={resolveRoute(maintenanceRoutes.routes.systemHistory, {
                  systemId: system.id,
                })}
              >
                <History className="h-4 w-4 mr-1" />
                View History
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "in_progress": {
        return <Badge variant="warning">In Progress</Badge>;
      }
      case "scheduled": {
        return <Badge variant="info">Scheduled</Badge>;
      }
      default: {
        return <Badge>{status}</Badge>;
      }
    }
  };

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardHeader className="border-b border-border bg-warning/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-warning" />
            <CardTitle className="text-lg font-semibold">
              Planned Maintenance
            </CardTitle>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link
              to={resolveRoute(maintenanceRoutes.routes.systemHistory, {
                systemId: system.id,
              })}
            >
              <History className="h-4 w-4 mr-1" />
              View History
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {maintenances.map((m) => (
          <Link
            key={m.id}
            to={resolveRoute(maintenanceRoutes.routes.detail, {
              maintenanceId: m.id,
            })}
            className="block p-3 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-foreground">{m.title}</h4>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
              {getStatusBadge(m.status)}
            </div>
            {m.description && (
              <p className="text-sm text-muted-foreground mb-2">
                {m.description}
              </p>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                <span>{format(new Date(m.startAt), "MMM d, HH:mm")}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>
                  {m.status === "scheduled"
                    ? `Starts ${formatDistanceToNow(new Date(m.startAt), {
                        addSuffix: true,
                      })}`
                    : `Ends ${formatDistanceToNow(new Date(m.endAt), {
                        addSuffix: true,
                      })}`}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
};
