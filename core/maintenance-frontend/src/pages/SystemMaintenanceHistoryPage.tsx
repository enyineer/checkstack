import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApi, rpcApiRef, wrapInSuspense } from "@checkmate/frontend-api";
import { resolveRoute } from "@checkmate/common";
import { maintenanceApiRef } from "../api";
import { maintenanceRoutes } from "@checkmate/maintenance-common";
import type {
  MaintenanceWithSystems,
  MaintenanceStatus,
} from "@checkmate/maintenance-common";
import { catalogRoutes, type CatalogClient } from "@checkmate/catalog-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  LoadingSpinner,
  EmptyState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  PageLayout,
  BackLink,
} from "@checkmate/ui";
import { Calendar, Clock, History } from "lucide-react";
import { format } from "date-fns";

const SystemMaintenanceHistoryPageContent: React.FC = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const api = useApi(maintenanceApiRef);
  const rpcApi = useApi(rpcApiRef);

  const catalogApi = useMemo(
    () => rpcApi.forPlugin<CatalogClient>("catalog"),
    [rpcApi]
  );

  const [maintenances, setMaintenances] = useState<MaintenanceWithSystems[]>(
    []
  );
  const [systemName, setSystemName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!systemId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [maintenanceList, systemList] = await Promise.all([
          api.listMaintenances({ systemId }),
          catalogApi.getSystems(),
        ]);
        setMaintenances(maintenanceList);
        const system = systemList.find((s) => s.id === systemId);
        setSystemName(system?.name ?? "Unknown System");
      } catch (error) {
        console.error("Failed to load maintenance history:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [systemId, api, catalogApi]);

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

  if (!systemId) {
    return (
      <EmptyState
        title="System not found"
        description="No system ID was provided."
      />
    );
  }

  return (
    <div className="space-y-6">
      <BackLink
        onClick={() =>
          navigate(
            resolveRoute(catalogRoutes.routes.systemDetail, { systemId })
          )
        }
      >
        Back to System
      </BackLink>

      <PageLayout
        title={`Maintenance History: ${systemName}`}
        subtitle="All past and scheduled maintenances for this system"
        loading={loading}
        allowed={true}
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
                title="No maintenances found"
                description="There are no recorded maintenances for this system."
              />
            ) : (
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
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        navigate(
                          resolveRoute(maintenanceRoutes.routes.detail, {
                            maintenanceId: m.id,
                          })
                        )
                      }
                    >
                      <TableCell>
                        <p className="font-medium text-foreground">{m.title}</p>
                        {m.description && (
                          <p className="text-sm text-muted-foreground truncate max-w-xs">
                            {m.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(m.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          <span>
                            {format(new Date(m.startAt), "MMM d, yyyy HH:mm")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
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
            )}
          </CardContent>
        </Card>
      </PageLayout>
    </div>
  );
};

export const SystemMaintenanceHistoryPage = wrapInSuspense(
  SystemMaintenanceHistoryPageContent
);
