import React from "react";
import { Link } from "react-router-dom";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { resolveRoute } from "@checkstack/common";
import { SystemDetailsTopSlot } from "@checkstack/catalog-common";
import { IncidentApi } from "../api";
import {
  incidentRoutes,
  INCIDENT_UPDATED,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  LoadingSpinner,
  Button,
} from "@checkstack/ui";
import { AlertTriangle, Clock, History, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Props = SlotContext<typeof SystemDetailsTopSlot>;

const SEVERITY_WEIGHTS = { critical: 3, major: 2, minor: 1 } as const;

function getSeverityColor(severity: string): string {
  switch (severity) {
    case "critical": {
      return "border-destructive/30 bg-destructive/5";
    }
    case "major": {
      return "border-warning/30 bg-warning/5";
    }
    default: {
      return "border-info/30 bg-info/5";
    }
  }
}

function getSeverityHeaderColor(severity: string): string {
  switch (severity) {
    case "critical": {
      return "bg-destructive/10";
    }
    case "major": {
      return "bg-warning/10";
    }
    default: {
      return "bg-info/10";
    }
  }
}

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
  const {
    data: incidents = [],
    isLoading: loading,
    refetch,
  } = incidentClient.getIncidentsForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id }
  );

  // Listen for realtime incident updates
  useSignal(INCIDENT_UPDATED, ({ systemIds }) => {
    if (system?.id && systemIds.includes(system.id)) {
      void refetch();
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

  if (incidents.length === 0) {
    // Show a subtle card with just the history button when no active incidents
    return (
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">No active incidents</span>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link
                to={resolveRoute(incidentRoutes.routes.systemHistory, {
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
      case "investigating": {
        return <Badge variant="destructive">Investigating</Badge>;
      }
      case "identified": {
        return <Badge variant="warning">Identified</Badge>;
      }
      case "fixing": {
        return <Badge variant="warning">Fixing</Badge>;
      }
      case "monitoring": {
        return <Badge variant="info">Monitoring</Badge>;
      }
      default: {
        return <Badge>{status}</Badge>;
      }
    }
  };

  // Use the most severe incident for the card styling
  const mostSevere = findMostSevereIncident(incidents);

  return (
    <Card className={getSeverityColor(mostSevere.severity)}>
      <CardHeader
        className={`border-b border-border ${getSeverityHeaderColor(
          mostSevere.severity
        )}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg font-semibold">
              Active Incidents ({incidents.length})
            </CardTitle>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link
              to={resolveRoute(incidentRoutes.routes.systemHistory, {
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
        {incidents.map((i) => (
          <Link
            key={i.id}
            to={`${resolveRoute(incidentRoutes.routes.detail, {
              incidentId: i.id,
            })}?from=${system.id}`}
            className="block p-3 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-foreground">{i.title}</h4>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    i.severity === "critical"
                      ? "destructive"
                      : i.severity === "major"
                      ? "warning"
                      : "secondary"
                  }
                >
                  {i.severity}
                </Badge>
                {getStatusBadge(i.status)}
              </div>
            </div>
            {i.description && (
              <p className="text-sm text-muted-foreground mb-2">
                {i.description}
              </p>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>
                  Started{" "}
                  {formatDistanceToNow(new Date(i.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
};
