import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  useApi,
  rpcApiRef,
  permissionApiRef,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { resolveRoute } from "@checkstack/common";
import { incidentApiRef } from "../api";
import {
  incidentRoutes,
  INCIDENT_UPDATED,
  type IncidentDetail,
} from "@checkstack/incident-common";
import { CatalogApi, type System } from "@checkstack/catalog-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  LoadingSpinner,
  BackLink,
  useToast,
  StatusUpdateTimeline,
  PageLayout,
} from "@checkstack/ui";
import {
  AlertTriangle,
  Clock,
  Calendar,
  MessageSquare,
  CheckCircle2,
  Server,
  Plus,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { IncidentUpdateForm } from "../components/IncidentUpdateForm";
import {
  getIncidentStatusBadge,
  getIncidentSeverityBadge,
} from "../utils/badges";

const IncidentDetailPageContent: React.FC = () => {
  const { incidentId } = useParams<{ incidentId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const api = useApi(incidentApiRef);
  const rpcApi = useApi(rpcApiRef);
  const permissionApi = useApi(permissionApiRef);
  const toast = useToast();

  const catalogApi = useMemo(() => rpcApi.forPlugin(CatalogApi), [rpcApi]);

  const { allowed: canManage } = permissionApi.useResourcePermission(
    "incident",
    "manage"
  );

  const [incident, setIncident] = useState<IncidentDetail | undefined>();
  const [systems, setSystems] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpdateForm, setShowUpdateForm] = useState(false);

  const loadData = useCallback(async () => {
    if (!incidentId) return;

    try {
      const [incidentData, { systems: systemList }] = await Promise.all([
        api.getIncident({ id: incidentId }),
        catalogApi.getSystems(),
      ]);
      setIncident(incidentData ?? undefined);
      setSystems(systemList);
    } catch (error) {
      console.error("Failed to load incident:", error);
    } finally {
      setLoading(false);
    }
  }, [incidentId, api, catalogApi]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for realtime updates
  useSignal(INCIDENT_UPDATED, ({ incidentId: updatedId }) => {
    if (incidentId === updatedId) {
      loadData();
    }
  });

  const handleUpdateSuccess = () => {
    setShowUpdateForm(false);
    loadData();
  };

  const handleResolve = async () => {
    if (!incidentId) return;

    try {
      await api.resolveIncident({ id: incidentId });
      toast.success("Incident resolved");
      await loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve";
      toast.error(message);
    }
  };

  const getSystemName = (systemId: string): string => {
    return systems.find((s) => s.id === systemId)?.name ?? systemId;
  };

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="p-12 text-center">
        <p className="text-muted-foreground">Incident not found</p>
        <BackLink
          to={resolveRoute(incidentRoutes.routes.config, {})}
          className="mt-4"
        >
          Back to Incidents
        </BackLink>
      </div>
    );
  }

  const canResolve = canManage && incident.status !== "resolved";
  // Use 'from' query param for back navigation, fallback to first affected system
  const sourceSystemId = searchParams.get("from") ?? incident.systemIds[0];

  return (
    <PageLayout
      title={incident.title}
      subtitle="Incident details and status history"
      loading={false}
      allowed={true}
      actions={
        sourceSystemId ? (
          <BackLink
            onClick={() =>
              navigate(
                resolveRoute(incidentRoutes.routes.systemHistory, {
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
        {/* Incident Info Card */}
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Incident Details</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                {getIncidentSeverityBadge(incident.severity)}
                {getIncidentStatusBadge(incident.status)}
                {canResolve && (
                  <Button variant="outline" size="sm" onClick={handleResolve}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Resolve
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {incident.description && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Description
                </h4>
                <p className="text-foreground">{incident.description}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Started
                </h4>
                <div className="flex items-center gap-2 text-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>{format(new Date(incident.createdAt), "PPpp")}</span>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Duration
                </h4>
                <div className="flex items-center gap-2 text-foreground">
                  <Clock className="h-4 w-4" />
                  <span>
                    {formatDistanceToNow(new Date(incident.createdAt), {
                      addSuffix: false,
                    })}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Affected Systems
              </h4>
              <div className="flex flex-wrap gap-2">
                {incident.systemIds.map((systemId) => (
                  <Badge key={systemId} variant="outline">
                    <Server className="h-3 w-3 mr-1" />
                    {getSystemName(systemId)}
                  </Badge>
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
            {showUpdateForm && incidentId && (
              <div className="mb-6">
                <IncidentUpdateForm
                  incidentId={incidentId}
                  onSuccess={handleUpdateSuccess}
                  onCancel={() => setShowUpdateForm(false)}
                />
              </div>
            )}

            <StatusUpdateTimeline
              updates={incident.updates}
              renderStatusBadge={getIncidentStatusBadge}
              emptyTitle="No status updates"
              emptyDescription="No status updates have been posted for this incident."
            />
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
};

export const IncidentDetailPage = wrapInSuspense(IncidentDetailPageContent);
