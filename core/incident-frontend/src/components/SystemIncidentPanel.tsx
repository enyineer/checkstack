import React from "react";
import { Link } from "react-router-dom";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { SystemDetailsTopSlot } from "@checkstack/catalog-common";
import { IncidentApi } from "../api";
import {
  incidentRoutes,
  type IncidentSeverity,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import { cn, LoadingSpinner, Button, type StatusPillTone } from "@checkstack/ui";
import { AlertTriangle, History } from "lucide-react";
import { presentIncidentSeverity } from "../utils/badges.logic";

type Props = SlotContext<typeof SystemDetailsTopSlot>;

const SEVERITY_WEIGHTS = { critical: 3, major: 2, minor: 1 } as const;

/**
 * Colorblind-safe status tone for an incident severity. Reuses the canonical
 * severity -> tone mapping (`critical` -> down, `major` -> warn, `minor` ->
 * info) so this panel never drifts from the incident badges/list; a `minor`
 * incident used to fall through to the neutral grey `unknown` tone here.
 */
function severityTone(severity: IncidentSeverity): StatusPillTone {
  return presentIncidentSeverity(severity).tone;
}

/** Per-tone class sets for the panel surface, leading icon, pill, and dot. */
const toneStyles: Record<
  StatusPillTone,
  { surface: string; icon: string; pill: string; dot: string }
> = {
  ok: {
    surface: "border-status-ok/30 bg-status-ok/5",
    icon: "text-status-ok",
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
  },
  down: {
    surface: "border-status-down/30 bg-status-down/5",
    icon: "text-status-down",
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
  },
  warn: {
    surface: "border-status-warn/30 bg-status-warn/5",
    icon: "text-status-warn",
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
  },
  info: {
    surface: "border-status-info/30 bg-status-info/5",
    icon: "text-status-info",
    pill: "bg-status-info/10 text-status-info",
    dot: "bg-status-info",
  },
  unknown: {
    surface: "border-status-unknown/30 bg-status-unknown/5",
    icon: "text-status-unknown",
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
  },
};


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
      <div className="flex items-center justify-center rounded-md border border-border/50 bg-surface px-3 py-2">
        <LoadingSpinner />
      </div>
    );
  }

  if (incidents.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border/50 bg-surface px-3 py-2">
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
  const panelStyles = toneStyles[severityTone(mostSevere.severity)];

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border px-3 py-2",
        panelStyles.surface,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle
          className={cn("h-3.5 w-3.5 shrink-0", panelStyles.icon)}
        />
        <span className="text-sm font-medium truncate">
          {incidents.length} active incident{incidents.length > 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1.5">
          {incidents.map((i) => {
            const styles = toneStyles[severityTone(i.severity)];
            return (
              <span
                key={i.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  styles.pill,
                )}
              >
                <span
                  className={cn("size-1.5 rounded-full", styles.dot)}
                  aria-hidden
                />
                {i.severity}
              </span>
            );
          })}
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
