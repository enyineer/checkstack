import React, { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  useApi,
  rpcApiRef,
  wrapInSuspense,
} from "@checkmate-monitor/frontend-api";
import { useSignal } from "@checkmate-monitor/signal-frontend";
import { resolveRoute } from "@checkmate-monitor/common";
import { incidentApiRef } from "../api";
import {
  incidentRoutes,
  INCIDENT_UPDATED,
  type IncidentWithSystems,
  type IncidentStatus,
} from "@checkmate-monitor/incident-common";
import {
  CatalogApi,
  type System,
  catalogRoutes,
} from "@checkmate-monitor/catalog-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  LoadingSpinner,
  EmptyState,
  BackLink,
} from "@checkmate-monitor/ui";
import { AlertTriangle, Clock, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SystemIncidentHistoryPageContent: React.FC = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const api = useApi(incidentApiRef);
  const rpcApi = useApi(rpcApiRef);

  const catalogApi = useMemo(() => rpcApi.forPlugin(CatalogApi), [rpcApi]);

  const [incidents, setIncidents] = useState<IncidentWithSystems[]>([]);
  const [system, setSystem] = useState<System | undefined>();
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    if (!systemId) return;

    setLoading(true);
    try {
      const [incidentList, systemList] = await Promise.all([
        api.listIncidents({ systemId, includeResolved: true }),
        catalogApi.getSystems(),
      ]);
      const systemData = systemList.find((s) => s.id === systemId);
      setIncidents(incidentList);
      setSystem(systemData);
    } catch (error) {
      console.error("Failed to load incidents:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [systemId]);

  // Listen for realtime updates
  useSignal(INCIDENT_UPDATED, ({ systemIds }) => {
    if (systemId && systemIds.includes(systemId)) {
      loadData();
    }
  });

  const getStatusBadge = (status: IncidentStatus) => {
    switch (status) {
      case "investigating": {
        return <Badge variant="destructive">Investigating</Badge>;
      }
      case "identified": {
        return <Badge variant="warning">Identified</Badge>;
      }
      case "fixing": {
        return <Badge variant="warning">Fixing</Badge>;
      }
      case "monitoring": {
        return <Badge variant="info">Monitoring</Badge>;
      }
      case "resolved": {
        return <Badge variant="success">Resolved</Badge>;
      }
      default: {
        return <Badge>{status}</Badge>;
      }
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical": {
        return <Badge variant="destructive">Critical</Badge>;
      }
      case "major": {
        return <Badge variant="warning">Major</Badge>;
      }
      default: {
        return <Badge variant="secondary">Minor</Badge>;
      }
    }
  };

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              <CardTitle>
                Incident History{system ? ` - ${system.name}` : ""}
              </CardTitle>
            </div>
            {system && (
              <BackLink
                to={resolveRoute(catalogRoutes.routes.systemDetail, {
                  systemId: system.id,
                })}
              >
                Back to {system.name}
              </BackLink>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {incidents.length === 0 ? (
            <EmptyState
              title="No incidents"
              description="This system has no recorded incidents."
            />
          ) : (
            <div className="divide-y divide-border">
              {incidents.map((incident) => (
                <Link
                  key={incident.id}
                  to={`${resolveRoute(incidentRoutes.routes.detail, {
                    incidentId: incident.id,
                  })}?from=${systemId}`}
                  className="block p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-foreground">
                          {incident.title}
                        </h4>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      {incident.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                          {incident.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>
                            {formatDistanceToNow(new Date(incident.createdAt), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {getSeverityBadge(incident.severity)}
                      {getStatusBadge(incident.status)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export const SystemIncidentHistoryPage = wrapInSuspense(
  SystemIncidentHistoryPageContent
);
