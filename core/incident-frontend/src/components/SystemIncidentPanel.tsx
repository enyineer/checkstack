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

/** Shared card elevation used by the system-overview panels. */
const PANEL_SHADOW =
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

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

/** Per-tone class sets for the card border, leading icon/number, pill, and accent. */
const toneStyles: Record<
  StatusPillTone,
  { border: string; icon: string; pill: string; dot: string }
> = {
  ok: {
    border: "border-status-ok/30",
    icon: "text-status-ok",
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
  },
  down: {
    border: "border-status-down/30",
    icon: "text-status-down",
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
  },
  warn: {
    border: "border-status-warn/30",
    icon: "text-status-warn",
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
  },
  info: {
    border: "border-status-info/30",
    icon: "text-status-info",
    pill: "bg-status-info/10 text-status-info",
    dot: "bg-status-info",
  },
  unknown: {
    border: "border-status-unknown/30",
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
      <div className="flex items-center justify-center rounded-[var(--d-card-r)] border border-border/70 bg-surface px-3 py-2">
        <LoadingSpinner />
      </div>
    );
  }

  if (incidents.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface px-3 py-2">
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
        "relative flex items-center justify-between gap-3 overflow-hidden rounded-[var(--d-card-r)] border bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)]",
        panelStyles.border,
        PANEL_SHADOW,
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-1", panelStyles.dot)}
        aria-hidden
      />
      <div className="flex min-w-0 items-center gap-3 pl-2">
        <AlertTriangle className={cn("h-4 w-4 shrink-0", panelStyles.icon)} />
        <div className="min-w-0">
          <p
            className={cn(
              "text-2xl font-bold leading-none tabular-nums",
              panelStyles.icon,
            )}
          >
            {incidents.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            active incident{incidents.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
      <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" asChild>
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
