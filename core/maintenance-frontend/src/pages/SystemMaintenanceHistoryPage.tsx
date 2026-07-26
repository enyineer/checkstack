import React from "react";
import { useParams, useNavigate } from "react-router";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { MaintenanceApi } from "../api";
import { maintenanceRoutes } from "@checkstack/maintenance-common";
import type { MaintenanceWithSystems } from "@checkstack/maintenance-common";
import { catalogRoutes, CatalogApi } from "@checkstack/catalog-common";
import {
  EmptyState,
  ListEmptyState,
  Card,
  DataTable,
  type DataTableColumn,
  PageLayout,
  BackLink,
} from "@checkstack/ui";
import { cn } from "@checkstack/ui";
import { Calendar, Clock, History } from "lucide-react";
import { format } from "date-fns";
import {
  getMaintenanceStatusBadge,
  getMaintenanceStatusTone,
  getMaintenanceToneAccentClass,
  maintenanceStatusRank,
} from "../utils/badges";
import { MaintenanceScheduleHero } from "../components/MaintenanceScheduleHero";

const SystemMaintenanceHistoryPageContent: React.FC = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const catalogClient = usePluginClient(CatalogApi);

  // Fetch maintenances with useQuery
  const { data: maintenancesData, isLoading: maintenancesLoading } =
    maintenanceClient.listMaintenances.useQuery(
      { systemId, includeCompleted: true },
      { enabled: !!systemId },
    );

  // Fetch systems with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  // Sort: active maintenances (scheduled / in_progress) first, then by
  // creation date desc. Feeds the DataTable in this order; leaving
  // `defaultSort` unset preserves it until the user clicks a sortable header.
  const maintenances = (maintenancesData?.maintenances ?? []).toSorted(
    (a, b) => {
      const aActive =
        a.status === "scheduled" || a.status === "in_progress" ? 0 : 1;
      const bActive =
        b.status === "scheduled" || b.status === "in_progress" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    },
  );
  const systems = systemsData?.systems ?? [];
  const system = systems.find((s) => s.id === systemId);
  const systemName = system?.name ?? "Unknown System";
  const loading = maintenancesLoading || systemsLoading;

  const openMaintenance = (maintenance: MaintenanceWithSystems): void => {
    navigate(
      `${resolveRoute(maintenanceRoutes.routes.detail, {
        maintenanceId: maintenance.id,
      })}?from=${systemId}`,
    );
  };

  const columns: DataTableColumn<MaintenanceWithSystems>[] = [
    {
      id: "title",
      header: "Title",
      sortValue: (maintenance) => maintenance.title,
      searchValue: (maintenance) => maintenance.title,
      cell: (maintenance) => (
        <div className="relative pl-3">
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-1 rounded-full",
              getMaintenanceToneAccentClass(
                getMaintenanceStatusTone(maintenance.status),
              ),
            )}
            aria-hidden
          />
          <p className="font-medium text-foreground">{maintenance.title}</p>
          {maintenance.description && (
            <p className="text-sm text-muted-foreground truncate max-w-xs">
              {maintenance.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (maintenance) => maintenanceStatusRank[maintenance.status],
      cell: (maintenance) => getMaintenanceStatusBadge(maintenance.status),
    },
    {
      id: "start",
      header: "Start",
      sortValue: (maintenance) => new Date(maintenance.startAt).getTime(),
      cell: (maintenance) => (
        <>
          <MaintenanceScheduleHero
            startAt={maintenance.startAt}
            endAt={maintenance.endAt}
          />
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>
              {format(new Date(maintenance.startAt), "MMM d, yyyy HH:mm")}
            </span>
          </div>
        </>
      ),
    },
    {
      id: "end",
      header: "End",
      sortValue: (maintenance) => new Date(maintenance.endAt).getTime(),
      cell: (maintenance) => (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>
            {format(new Date(maintenance.endAt), "MMM d, yyyy HH:mm")}
          </span>
        </div>
      ),
    },
  ];

  if (!systemId) {
    return (
      <EmptyState
        title="System not found"
        description="No system ID was provided."
      />
    );
  }

  return (
    <PageLayout
      title={`Maintenance History: ${systemName}`}
      subtitle="All past and scheduled maintenances for this system"
      icon={History}
      loading={loading}
      allowed={true}
      actions={
        <BackLink
          onClick={() =>
            navigate(
              resolveRoute(catalogRoutes.routes.systemDetail, { systemId }),
            )
          }
        >
          Back to System
        </BackLink>
      }
    >
      <DataTable
        data={maintenances}
        columns={columns}
        getRowId={(maintenance) => maintenance.id}
        searchPlaceholder="Search maintenances..."
        onRowClick={openMaintenance}
        emptyState={
          <EmptyState
            title="No maintenance history"
            description="This system has never had a planned maintenance window. When one is scheduled (or completes), it will appear here so you can see how often this system is taken offline and for how long."
          />
        }
        noResultsState={
          <ListEmptyState
            resource="maintenances"
            description="No maintenances match your search."
          />
        }
        renderMobileCard={(maintenance) => (
          <Card
            className="relative cursor-pointer overflow-hidden p-3"
            onClick={() => openMaintenance(maintenance)}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-1",
                getMaintenanceToneAccentClass(
                  getMaintenanceStatusTone(maintenance.status),
                ),
              )}
              aria-hidden
            />
            <div className="flex items-start justify-between gap-2 pl-2">
              <p className="min-w-0 truncate font-medium text-foreground">
                {maintenance.title}
              </p>
              {getMaintenanceStatusBadge(maintenance.status)}
            </div>
            {maintenance.description && (
              <p className="mt-1 truncate pl-2 text-xs text-muted-foreground">
                {maintenance.description}
              </p>
            )}
            <div className="mt-3 pl-2">
              <MaintenanceScheduleHero
                startAt={maintenance.startAt}
                endAt={maintenance.endAt}
              />
            </div>
            <div className="mt-2 space-y-1 pl-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                <span>
                  {format(new Date(maintenance.startAt), "MMM d, yyyy HH:mm")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>
                  {format(new Date(maintenance.endAt), "MMM d, yyyy HH:mm")}
                </span>
              </div>
            </div>
          </Card>
        )}
      />
    </PageLayout>
  );
};

export const SystemMaintenanceHistoryPage = wrapInSuspense(
  SystemMaintenanceHistoryPageContent,
);
