import React, { useEffect, useState, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useApi, rpcApiRef, wrapInSuspense } from "@checkmate/frontend-api";
import { resolveRoute } from "@checkmate/common";
import { maintenanceApiRef } from "../api";
import { maintenanceRoutes } from "@checkmate/maintenance-common";
import type {
  MaintenanceDetail,
  MaintenanceStatus,
} from "@checkmate/maintenance-common";
import {
  catalogRoutes,
  type CatalogClient,
  type System,
} from "@checkmate/catalog-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  LoadingSpinner,
  EmptyState,
  PageLayout,
  BackLink,
} from "@checkmate/ui";
import { Calendar, Clock, MessageSquare, Wrench, Server } from "lucide-react";
import { format } from "date-fns";

const MaintenanceDetailPageContent: React.FC = () => {
  const { maintenanceId } = useParams<{ maintenanceId: string }>();
  const navigate = useNavigate();
  const api = useApi(maintenanceApiRef);
  const rpcApi = useApi(rpcApiRef);

  const catalogApi = useMemo(
    () => rpcApi.forPlugin<CatalogClient>("catalog-backend"),
    [rpcApi]
  );

  const [maintenance, setMaintenance] = useState<MaintenanceDetail>();
  const [systems, setSystems] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!maintenanceId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [maintenanceData, systemList] = await Promise.all([
          api.getMaintenance({ id: maintenanceId }),
          catalogApi.getSystems(),
        ]);
        setMaintenance(maintenanceData ?? undefined);
        setSystems(systemList);
      } catch (error) {
        console.error("Failed to load maintenance details:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [maintenanceId, api, catalogApi]);

  const getStatusBadge = (status: MaintenanceStatus) => {
    switch (status) {
      case "in_progress": {
        return <Badge variant="warning">In Progress</Badge>;
      }
      case "scheduled": {
        return <Badge variant="info">Scheduled</Badge>;
      }
      case "completed": {
        return <Badge variant="success">Completed</Badge>;
      }
      case "cancelled": {
        return <Badge variant="secondary">Cancelled</Badge>;
      }
      default: {
        return <Badge>{status}</Badge>;
      }
    }
  };

  const getSystemName = (systemId: string): string => {
    return systems.find((s) => s.id === systemId)?.name ?? systemId;
  };

  if (!maintenanceId) {
    return (
      <EmptyState
        title="Maintenance not found"
        description="No maintenance ID was provided."
      />
    );
  }

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!maintenance) {
    return (
      <EmptyState
        title="Maintenance not found"
        description="The requested maintenance could not be found."
      />
    );
  }

  // Get first system for "back" navigation
  const primarySystemId = maintenance.systemIds[0];

  return (
    <div className="space-y-6">
      {primarySystemId && (
        <BackLink
          onClick={() =>
            navigate(
              resolveRoute(maintenanceRoutes.routes.systemHistory, {
                systemId: primarySystemId,
              })
            )
          }
        >
          Back to History
        </BackLink>
      )}

      <PageLayout
        title={maintenance.title}
        subtitle="Maintenance details and status history"
        loading={false}
        allowed={true}
      >
        <div className="space-y-6">
          {/* Maintenance Info Card */}
          <Card>
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Maintenance Details</CardTitle>
                </div>
                {getStatusBadge(maintenance.status)}
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {maintenance.description && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">
                    Description
                  </h4>
                  <p className="text-foreground">{maintenance.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">
                    Start Time
                  </h4>
                  <div className="flex items-center gap-2 text-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>{format(new Date(maintenance.startAt), "PPpp")}</span>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">
                    End Time
                  </h4>
                  <div className="flex items-center gap-2 text-foreground">
                    <Clock className="h-4 w-4" />
                    <span>{format(new Date(maintenance.endAt), "PPpp")}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Affected Systems
                </h4>
                <div className="flex flex-wrap gap-2">
                  {maintenance.systemIds.map((systemId) => (
                    <Link
                      key={systemId}
                      to={resolveRoute(catalogRoutes.routes.systemDetail, {
                        systemId,
                      })}
                    >
                      <Badge
                        variant="outline"
                        className="cursor-pointer hover:bg-muted"
                      >
                        <Server className="h-3 w-3 mr-1" />
                        {getSystemName(systemId)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Status Updates Timeline */}
          <Card>
            <CardHeader className="border-b border-border">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Status Updates</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {maintenance.updates.length === 0 ? (
                <EmptyState
                  title="No status updates"
                  description="No status updates have been posted for this maintenance."
                />
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />

                  <div className="space-y-6">
                    {maintenance.updates
                      .toSorted(
                        (a, b) =>
                          new Date(b.createdAt).getTime() -
                          new Date(a.createdAt).getTime()
                      )
                      .map((update, index) => (
                        <div key={update.id} className="relative pl-10">
                          {/* Timeline dot */}
                          <div
                            className={`absolute left-2.5 w-3 h-3 rounded-full border-2 border-background ${
                              index === 0
                                ? "bg-primary"
                                : "bg-muted-foreground/30"
                            }`}
                          />

                          <div className="p-4 rounded-lg border border-border bg-muted/20">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <p className="text-foreground">
                                {update.message}
                              </p>
                              {update.statusChange && (
                                <div className="shrink-0">
                                  {getStatusBadge(update.statusChange)}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>
                                {format(
                                  new Date(update.createdAt),
                                  "MMM d, yyyy 'at' HH:mm"
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </div>
  );
};

export const MaintenanceDetailPage = wrapInSuspense(
  MaintenanceDetailPageContent
);
