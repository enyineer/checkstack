import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  useApi,
  rpcApiRef,
  permissionApiRef,
  wrapInSuspense,
} from "@checkmate/frontend-api";
import { useSignal } from "@checkmate/signal-frontend";
import { resolveRoute } from "@checkmate/common";
import { incidentApiRef } from "../api";
import {
  incidentRoutes,
  INCIDENT_UPDATED,
  type IncidentDetail,
} from "@checkmate/incident-common";
import { CatalogApi, type System } from "@checkmate/catalog-common";
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
} from "@checkmate/ui";
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
      const [incidentData, systemList] = await Promise.all([
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

  const affectedSystems = systems.filter((s) =>
    incident.systemIds.includes(s.id)
  );

  return (
    <div className="space-y-6 p-6">
      <BackLink to={resolveRoute(incidentRoutes.routes.config, {})}>
        Back to Incidents
      </BackLink>

      {/* Incident Header */}
      <Card
        className={
          incident.severity === "critical"
            ? "border-destructive/30 bg-destructive/5"
            : incident.severity === "major"
            ? "border-warning/30 bg-warning/5"
            : ""
        }
      >
        <CardHeader className="border-b border-border">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle
                className={`h-6 w-6 ${
                  incident.severity === "critical"
                    ? "text-destructive"
                    : incident.severity === "major"
                    ? "text-warning"
                    : "text-muted-foreground"
                }`}
              />
              <div>
                <CardTitle className="text-xl">{incident.title}</CardTitle>
                <div className="flex items-center gap-2 mt-2">
                  {getIncidentSeverityBadge(incident.severity)}
                  {getIncidentStatusBadge(incident.status)}
                </div>
              </div>
            </div>
            {canManage && incident.status !== "resolved" && (
              <Button variant="outline" onClick={handleResolve}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Resolve Incident
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {incident.description && (
            <p className="text-muted-foreground">{incident.description}</p>
          )}

          <div className="flex gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              <span>
                Started {format(new Date(incident.createdAt), "MMM d, HH:mm")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>
                Duration:{" "}
                {formatDistanceToNow(new Date(incident.createdAt), {
                  addSuffix: false,
                })}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Affected Systems */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Affected Systems</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {affectedSystems.map((system) => (
              <Badge key={system.id} variant="outline">
                {system.name}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Status Updates Timeline */}
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Status Updates</CardTitle>
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
        <CardContent className="p-4">
          {/* Add Update Form */}
          {showUpdateForm && incidentId && (
            <div className="mb-4">
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
            emptyDescription="No status updates have been posted yet."
          />
        </CardContent>
      </Card>
    </div>
  );
};

export const IncidentDetailPage = wrapInSuspense(IncidentDetailPageContent);
