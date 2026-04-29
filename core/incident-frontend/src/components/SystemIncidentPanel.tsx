import React from "react";
import { Link } from "react-router-dom";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { SystemDetailsTopSlot } from "@checkstack/catalog-common";
import { IncidentApi } from "../api";
import {
  incidentRoutes,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import { Badge, LoadingSpinner, Button } from "@checkstack/ui";
import { AlertTriangle, History } from "lucide-react";

type Props = SlotContext<typeof SystemDetailsTopSlot>;

const SEVERITY_WEIGHTS = { critical: 3, major: 2, minor: 1 } as const;


function findMostSevereIncident(
  incidents: IncidentWithSystems[]
): IncidentWithSystems {
  let mostSevere = incidents[0];
  for (const incident of incidents) {
    const currentWeight =
      SEVERITY_WEIGHTS[incident.severity as keyof typeof SEVERITY_WEIGHTS] || 0;
    const mostWeight =
      SEVERITY_WEIGHTS[mostSevere.severity as keyof typeof SEVERITY_WEIGHTS] ||
      0;
    if (currentWeight > mostWeight) {
      mostSevere = incident;
    }
  }
  return mostSevere;
}

/**
 * Panel shown on system detail pages displaying active incidents.
 * Listens for realtime updates via signals.
 */
export const SystemIncidentPanel: React.FC<Props> = ({ system }) => {
  const incidentClient = usePluginClient(IncidentApi);

  // Fetch incidents with useQuery
  const { data: incidents = [], isLoading: loading } =
    incidentClient.getIncidentsForSystem.useQuery(
      { systemId: system?.id ?? "" },
      { enabled: !!system?.id }
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-md border border-border/50 bg-card px-3 py-2">
        <LoadingSpinner />
      </div>
    );
  }

  if (incidents.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border/50 bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="text-sm">No active incidents</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
          <Link
            to={resolveRoute(incidentRoutes.routes.systemHistory, {
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

  const mostSevere = findMostSevereIncident(incidents);
  const severityColor =
    mostSevere.severity === "critical"
      ? "border-destructive/30 bg-destructive/5"
      : mostSevere.severity === "major"
        ? "border-warning/30 bg-warning/5"
        : "border-info/30 bg-info/5";

  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 ${severityColor}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="text-sm font-medium truncate">
          {incidents.length} active incident{incidents.length > 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1.5">
          {incidents.map((i) => (
            <Badge
              key={i.id}
              variant={
                i.severity === "critical"
                  ? "destructive"
                  : i.severity === "major"
                    ? "warning"
                    : "secondary"
              }
              className="text-xs"
            >
              {i.severity}
            </Badge>
          ))}
        </div>
      </div>
      <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" asChild>
        <Link
          to={resolveRoute(incidentRoutes.routes.systemHistory, {
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
