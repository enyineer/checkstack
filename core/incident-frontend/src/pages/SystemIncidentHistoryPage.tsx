import React from "react";
import { useParams, useNavigate } from "react-router";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { IncidentApi } from "../api";
import { incidentRoutes } from "@checkstack/incident-common";
import type { IncidentWithSystems } from "@checkstack/incident-common";
import { CatalogApi, catalogRoutes } from "@checkstack/catalog-common";
import {
  PageLayout,
  EmptyState,
  ListEmptyState,
  BackLink,
  Card,
  DataTable,
  type DataTableColumn,
} from "@checkstack/ui";
import { Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { sortIncidentHistory } from "../utils/incident.logic";
import {
  getIncidentStatusBadge,
  getIncidentSeverityBadge,
  incidentSeverityRank,
  incidentStatusRank,
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
  // Feeds the DataTable in this order; leaving `defaultSort` unset preserves it
  // until the user clicks a sortable header.
  const incidents = sortIncidentHistory(incidentsData?.incidents ?? []);
  const systems = systemsData?.systems ?? [];
  const system = systems.find((s) => s.id === systemId);
  const loading = incidentsLoading || systemsLoading;

  const openIncident = (incident: IncidentWithSystems): void => {
    navigate(
      `${resolveRoute(incidentRoutes.routes.detail, {
        incidentId: incident.id,
      })}?from=${systemId}`,
    );
  };

  const columns: DataTableColumn<IncidentWithSystems>[] = [
    {
      id: "title",
      header: "Title",
      sortValue: (incident) => incident.title,
      searchValue: (incident) => incident.title,
      cell: (incident) => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {incident.title}
          </p>
          {incident.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {incident.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "severity",
      header: "Severity",
      sortValue: (incident) => incidentSeverityRank[incident.severity],
      cell: (incident) => getIncidentSeverityBadge(incident.severity),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (incident) => incidentStatusRank[incident.status],
      cell: (incident) => getIncidentStatusBadge(incident.status),
    },
    {
      id: "created",
      header: "Created",
      sortValue: (incident) => new Date(incident.createdAt).getTime(),
      cell: (incident) => (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span className="tabular-nums">
            {formatDistanceToNow(new Date(incident.createdAt), {
              addSuffix: true,
            })}
          </span>
        </div>
      ),
    },
  ];

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
      <DataTable
        data={incidents}
        columns={columns}
        getRowId={(incident) => incident.id}
        searchPlaceholder="Search incidents..."
        onRowClick={openIncident}
        emptyState={
          <EmptyState
            title="Clean record"
            description="No incidents have been reported for this system. Incidents in Checkstack are created by hand when a real outage or user-visible issue happens - they aren't auto-generated from failing health checks. Anything reported against this system in the future will show up here."
          />
        }
        noResultsState={
          <ListEmptyState
            resource="incidents"
            description="No incidents match your search."
          />
        }
        renderMobileCard={(incident) => (
          <Card
            className="cursor-pointer p-3"
            onClick={() => openIncident(incident)}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate font-semibold text-foreground">
                {incident.title}
              </p>
              {getIncidentStatusBadge(incident.status)}
            </div>
            {incident.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {incident.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {getIncidentSeverityBadge(incident.severity)}
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span className="tabular-nums">
                  {formatDistanceToNow(new Date(incident.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </span>
            </div>
          </Card>
        )}
      />
    </PageLayout>
  );
};

export const SystemIncidentHistoryPage = wrapInSuspense(
  SystemIncidentHistoryPageContent,
);
