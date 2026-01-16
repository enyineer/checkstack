import React, { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { resolveRoute } from "@checkstack/common";
import { IncidentApi } from "../api";
import {
  incidentRoutes,
  INCIDENT_UPDATED,
  incidentAccess,
} from "@checkstack/incident-common";
import { CatalogApi } from "@checkstack/catalog-common";
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
  const incidentClient = usePluginClient(IncidentApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { allowed: canManage } = accessApi.useAccess(
    incidentAccess.incident.manage
  );

  const [showUpdateForm, setShowUpdateForm] = useState(false);

  // Fetch incident with useQuery
  const {
    data: incident,
    isLoading: incidentLoading,
    refetch: refetchIncident,
  } = incidentClient.getIncident.useQuery(
    { id: incidentId ?? "" },
    { enabled: !!incidentId }
  );

  // Fetch systems with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  const systems = systemsData?.systems ?? [];
  const loading = incidentLoading || systemsLoading;

  // Listen for realtime updates
  useSignal(INCIDENT_UPDATED, ({ incidentId: updatedId }) => {
    if (incidentId === updatedId) {
      void refetchIncident();
    }
  });

  // Resolve mutation
  const resolveMutation = incidentClient.resolveIncident.useMutation({
    onSuccess: () => {
      toast.success("Incident resolved");
      void refetchIncident();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to resolve");
    },
  });

  const handleUpdateSuccess = () => {
    setShowUpdateForm(false);
    void refetchIncident();
  };

  const handleResolve = () => {
    if (!incidentId) return;
    resolveMutation.mutate({ id: incidentId });
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResolve}
                    disabled={resolveMutation.isPending}
                  >
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
