import React from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { IncidentApi } from "../api";
import { incidentRoutes } from "@checkstack/incident-common";
import { CatalogApi, catalogRoutes } from "@checkstack/catalog-common";
import { PageLayout, EmptyState, BackLink, cn } from "@checkstack/ui";
import { Clock, ChevronRight, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sortIncidentHistory } from "../utils/incident.logic";
import {
  getIncidentStatusBadge,
  getIncidentSeverityBadge,
  getIncidentSeverityAccentClass,
} from "../utils/badges";

const SystemIncidentHistoryPageContent: React.FC = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const incidentClient = usePluginClient(IncidentApi);
  const catalogClient = usePluginClient(CatalogApi);

  // Fetch incidents with useQuery — kept fresh via SignalAutoInvalidator.
  const { data: incidentsData, isLoading: incidentsLoading } =
    incidentClient.listIncidents.useQuery(
      { systemId, includeResolved: true },
      { enabled: !!systemId },
    );

  // Fetch systems with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  // Sort: active incidents (non-resolved) first, then by creation date desc.
  const incidents = sortIncidentHistory(incidentsData?.incidents ?? []);
  const systems = systemsData?.systems ?? [];
  const system = systems.find((s) => s.id === systemId);
  const loading = incidentsLoading || systemsLoading;

  // Actions for the page header
  const headerActions = system && (
    <BackLink
      onClick={() =>
        navigate(
          resolveRoute(catalogRoutes.routes.systemDetail, {
            systemId: system.id,
          }),
        )
      }
    >
      Back to {system.name}
    </BackLink>
  );

  return (
    <PageLayout
      title={`Incident History${system ? ` - ${system.name}` : ""}`}
      icon={AlertTriangle}
      loading={loading}
      actions={headerActions}
    >
      <div className="overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
        {incidents.length === 0 ? (
          <EmptyState
            title="Clean record"
            description="No incidents have been reported for this system. Incidents in Checkstack are created by hand when a real outage or user-visible issue happens - they aren't auto-generated from failing health checks. Anything reported against this system in the future will show up here."
          />
        ) : (
          <div className="divide-y divide-border/60">
            {incidents.map((incident) => (
              <Link
                key={incident.id}
                to={`${resolveRoute(incidentRoutes.routes.detail, {
                  incidentId: incident.id,
                })}?from=${systemId}`}
                className="group relative block px-[var(--d-pad)] py-3 transition-colors hover:bg-surface-inset"
              >
                {/* Severity accent: scannable by hue + position. */}
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-1",
                    getIncidentSeverityAccentClass(incident.severity),
                  )}
                  aria-hidden
                />
                <div className="flex items-start justify-between gap-4 pl-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-foreground">
                      {incident.title}
                    </h4>
                    {incident.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {incident.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {getIncidentSeverityBadge(incident.severity)}
                      {getIncidentStatusBadge(incident.status)}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span className="tabular-nums">
                        {formatDistanceToNow(new Date(incident.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
};

export const SystemIncidentHistoryPage = wrapInSuspense(
  SystemIncidentHistoryPageContent,
);
