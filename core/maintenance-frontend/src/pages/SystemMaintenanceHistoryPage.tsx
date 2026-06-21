import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { MaintenanceApi } from "../api";
import { maintenanceRoutes } from "@checkstack/maintenance-common";
import { catalogRoutes, CatalogApi } from "@checkstack/catalog-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  LoadingSpinner,
  EmptyState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  ResponsiveTable,
  MobileCardList,
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
  // creation date desc.
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
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Maintenance History</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : maintenances.length === 0 ? (
            <EmptyState
              title="No maintenance history"
              description="This system has never had a planned maintenance window. When one is scheduled (or completes), it will appear here so you can see how often this system is taken offline and for how long."
            />
          ) : (
            <>
              <ResponsiveTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {maintenances.map((m) => (
                      <TableRow
                        key={m.id}
                        className="cursor-pointer transition-colors hover:bg-surface-inset"
                        onClick={() =>
                          navigate(
                            `${resolveRoute(maintenanceRoutes.routes.detail, {
                              maintenanceId: m.id,
                            })}?from=${systemId}`,
                          )
                        }
                      >
                        <TableCell>
                          <div className="relative pl-3">
                            <span
                              className={cn(
                                "absolute inset-y-0 left-0 w-1 rounded-full",
                                getMaintenanceToneAccentClass(
                                  getMaintenanceStatusTone(m.status),
                                ),
                              )}
                              aria-hidden
                            />
                            <p className="font-medium text-foreground">
                              {m.title}
                            </p>
                            {m.description && (
                              <p className="text-sm text-muted-foreground truncate max-w-xs">
                                {m.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {getMaintenanceStatusBadge(m.status)}
                        </TableCell>
                        <TableCell>
                          <MaintenanceScheduleHero
                            startAt={m.startAt}
                            endAt={m.endAt}
                          />
                          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>
                              {format(new Date(m.startAt), "MMM d, yyyy HH:mm")}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>
                              {format(new Date(m.endAt), "MMM d, yyyy HH:mm")}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ResponsiveTable>

              <MobileCardList className="p-4">
                {maintenances.map((m) => (
                  <div
                    key={m.id}
                    className="group cursor-pointer"
                    onClick={() =>
                      navigate(
                        `${resolveRoute(maintenanceRoutes.routes.detail, {
                          maintenanceId: m.id,
                        })}?from=${systemId}`,
                      )
                    }
                  >
                    <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl">
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 w-1",
                          getMaintenanceToneAccentClass(
                            getMaintenanceStatusTone(m.status),
                          ),
                        )}
                        aria-hidden
                      />
                      <div className="flex items-start justify-between gap-2 pl-2">
                        <p className="min-w-0 truncate font-medium text-foreground">
                          {m.title}
                        </p>
                        {getMaintenanceStatusBadge(m.status)}
                      </div>
                      {m.description && (
                        <p className="mt-1 truncate pl-2 text-xs text-muted-foreground">
                          {m.description}
                        </p>
                      )}
                      <div className="mt-3 pl-2">
                        <MaintenanceScheduleHero
                          startAt={m.startAt}
                          endAt={m.endAt}
                        />
                      </div>
                      <div className="mt-2 space-y-1 pl-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>
                            {format(new Date(m.startAt), "MMM d, yyyy HH:mm")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>
                            {format(new Date(m.endAt), "MMM d, yyyy HH:mm")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </MobileCardList>
            </>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
};

export const SystemMaintenanceHistoryPage = wrapInSuspense(
  SystemMaintenanceHistoryPageContent,
);
