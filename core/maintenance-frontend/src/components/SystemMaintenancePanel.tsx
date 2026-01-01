import React, { useEffect, useState } from "react";
import { useApi, type SlotContext } from "@checkmate/frontend-api";
import { SystemDetailsSlot } from "@checkmate/catalog-common";
import { maintenanceApiRef } from "../api";
import type { MaintenanceWithSystems } from "@checkmate/maintenance-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  LoadingSpinner,
} from "@checkmate/ui";
import { Wrench, Clock, Calendar } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

type Props = SlotContext<typeof SystemDetailsSlot>;

/**
 * Panel shown on system detail pages displaying active/upcoming maintenances
 */
export const SystemMaintenancePanel: React.FC<Props> = ({ system }) => {
  const api = useApi(maintenanceApiRef);
  const [maintenances, setMaintenances] = useState<MaintenanceWithSystems[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!system?.id) return;

    api
      .getMaintenancesForSystem({ systemId: system.id })
      .then(setMaintenances)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [system?.id, api]);

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
    return; // Don't show card if no maintenances
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
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-warning" />
          <CardTitle className="text-lg font-semibold">
            Planned Maintenance
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {maintenances.map((m) => (
          <div
            key={m.id}
            className="p-3 rounded-lg border border-border bg-background"
          >
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-medium text-foreground">{m.title}</h4>
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
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
