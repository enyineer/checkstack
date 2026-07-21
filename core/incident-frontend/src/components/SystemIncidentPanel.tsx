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
import {
  cn,
  DetailCard,
  LoadingSpinner,
  Button,
  pillToneStyles,
  type StatusPillTone,
} from "@checkstack/ui";
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

/**
 * The panel's border tint per tone. Deliberately one step stronger than the
 * shared table's `border` (/30 vs /20): this is a full-width alert surface
 * sitting on a system detail page, where the shared value - tuned for an inline
 * chip - reads as no edge at all. Everything else (icon, pill, dot, accent)
 * comes from the shared `pillToneStyles` table.
 */
const panelBorder: Record<StatusPillTone, string> = {
  ok: "border-status-ok/30",
  down: "border-status-down/30",
  warn: "border-status-warn/30",
  info: "border-status-info/30",
  unknown: "border-status-unknown/30",
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
      <DetailCard
        surface="flat"
        className="flex items-center justify-center px-3 py-2"
      >
        <LoadingSpinner />
      </DetailCard>
    );
  }

  if (incidents.length === 0) {
    return (
      <DetailCard className="flex items-center justify-between px-3 py-2">
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
      </DetailCard>
    );
  }

  const mostSevere = findMostSevereIncident(incidents);
  const panelTone = severityTone(mostSevere.severity);
  const panelStyles = pillToneStyles[panelTone];

  return (
    <DetailCard
      className={cn(
        "relative flex items-center justify-between gap-3 overflow-hidden p-[var(--d-pad)]",
        panelBorder[panelTone],
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-1", panelStyles.accent)}
        aria-hidden
      />
      <div className="flex min-w-0 items-center gap-3 pl-2">
        <AlertTriangle className={cn("h-4 w-4 shrink-0", panelStyles.text)} />
        <div className="min-w-0">
          <p
            className={cn(
              "text-2xl font-bold leading-none tabular-nums",
              panelStyles.text,
            )}
          >
            {incidents.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            active incident{incidents.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Kept as hand-rolled markup rather than `StatusPill`: this strip
              packs one chip per active incident, so it needs a denser shape
              than `size="md"` while keeping the standard 12px label and dot
              that `size="sm"` shrinks. The classes still come from the shared
              tone table, which is the part that must never drift. */}
          {incidents.map((i) => {
            const styles = pillToneStyles[severityTone(i.severity)];
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
    </DetailCard>
  );
};
