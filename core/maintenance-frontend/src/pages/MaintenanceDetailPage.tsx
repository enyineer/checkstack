import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  useParams,
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  useApi,
  rpcApiRef,
  wrapInSuspense,
  permissionApiRef,
} from "@checkmate-monitor/frontend-api";
import { resolveRoute } from "@checkmate-monitor/common";
import { maintenanceApiRef } from "../api";
import { maintenanceRoutes } from "@checkmate-monitor/maintenance-common";
import type { MaintenanceDetail } from "@checkmate-monitor/maintenance-common";
import {
  catalogRoutes,
  CatalogApi,
  type System,
} from "@checkmate-monitor/catalog-common";
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
  Button,
  StatusUpdateTimeline,
  useToast,
} from "@checkmate-monitor/ui";
import {
  Calendar,
  Clock,
  Wrench,
  Server,
  Plus,
  MessageSquare,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { MaintenanceUpdateForm } from "../components/MaintenanceUpdateForm";
import { getMaintenanceStatusBadge } from "../utils/badges";

const MaintenanceDetailPageContent: React.FC = () => {
  const { maintenanceId } = useParams<{ maintenanceId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const api = useApi(maintenanceApiRef);
  const rpcApi = useApi(rpcApiRef);
  const permissionApi = useApi(permissionApiRef);
  const toast = useToast();

  const catalogApi = useMemo(() => rpcApi.forPlugin(CatalogApi), [rpcApi]);

  const { allowed: canManage } = permissionApi.useResourcePermission(
    "maintenance",
    "manage"
  );

  const [maintenance, setMaintenance] = useState<MaintenanceDetail>();
  const [systems, setSystems] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpdateForm, setShowUpdateForm] = useState(false);

  const loadData = useCallback(async () => {
    if (!maintenanceId) return;

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
  }, [maintenanceId, api, catalogApi]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpdateSuccess = () => {
    setShowUpdateForm(false);
    loadData();
  };

  const handleComplete = async () => {
    if (!maintenanceId) return;

    try {
      await api.closeMaintenance({ id: maintenanceId });
      toast.success("Maintenance completed");
      await loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to complete";
      toast.error(message);
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

  // Use 'from' query param for back navigation, fallback to first affected system
  const sourceSystemId = searchParams.get("from") ?? maintenance.systemIds[0];
  const canComplete =
    canManage &&
    maintenance.status !== "completed" &&
    maintenance.status !== "cancelled";

  return (
    <PageLayout
      title={maintenance.title}
      subtitle="Maintenance details and status history"
      loading={false}
      allowed={true}
      actions={
        sourceSystemId ? (
          <BackLink
            onClick={() =>
              navigate(
                resolveRoute(maintenanceRoutes.routes.systemHistory, {
                  systemId: sourceSystemId,
                })
              )
            }
          >
            Back to History
          </BackLink>
        ) : undefined
      }
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
              <div className="flex items-center gap-2">
                {getMaintenanceStatusBadge(maintenance.status)}
                {canComplete && (
                  <Button variant="outline" size="sm" onClick={handleComplete}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Complete
                  </Button>
                )}
              </div>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Status Updates</CardTitle>
              </div>
              {canManage && !showUpdateForm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUpdateForm(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Update
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {/* Add Update Form */}
            {showUpdateForm && (
              <div className="mb-6">
                <MaintenanceUpdateForm
                  maintenanceId={maintenanceId}
                  onSuccess={handleUpdateSuccess}
                  onCancel={() => setShowUpdateForm(false)}
                />
              </div>
            )}

            <StatusUpdateTimeline
              updates={maintenance.updates}
              renderStatusBadge={getMaintenanceStatusBadge}
              emptyTitle="No status updates"
              emptyDescription="No status updates have been posted for this maintenance."
            />
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
};

export const MaintenanceDetailPage = wrapInSuspense(
  MaintenanceDetailPageContent
);
