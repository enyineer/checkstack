import React, { useState } from "react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import {
  SatelliteApi,
  satelliteAccess,
  SATELLITE_STATUS_CHANGED,
} from "@checkstack/satellite-common";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  LoadingSpinner,
  EmptyState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  useToast,
  ConfirmationModal,
  PageLayout,
} from "@checkstack/ui";
import { Plus, Satellite, Trash2, MapPin } from "lucide-react";
import { SatelliteStatusBadge } from "../components/SatelliteStatusBadge";
import { CreateSatelliteDialog } from "../components/CreateSatelliteDialog";
import { extractErrorMessage } from "@checkstack/common";

const SatelliteListPageContent: React.FC = () => {
  const satelliteClient = usePluginClient(SatelliteApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    satelliteAccess.satellite.manage,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    SatelliteWithStatus | undefined
  >();

  const {
    data: satellites,
    isLoading,
    refetch,
  } = satelliteClient.listSatellites.useQuery();

  // Real-time status updates
  useSignal(SATELLITE_STATUS_CHANGED, () => {
    void refetch();
  });

  const deleteMutation = satelliteClient.deleteSatellite.useMutation({
    onSuccess: () => {
      toast.success("Satellite deleted");
      void refetch();
      setDeleteTarget(undefined);
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete satellite"));
    },
  });

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id });
  };

  const satelliteList = satellites?.satellites ?? [];

  return (
    <PageLayout
      title="Satellites"
      subtitle="Manage distributed satellite nodes for remote health check execution"
      icon={Satellite}
      loading={accessLoading}
      allowed={canManage}
      actions={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Satellite
        </Button>
      }
    >
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <Satellite className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Satellite Nodes</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : satelliteList.length === 0 ? (
            <EmptyState
              title="No satellites configured"
              description="Deploy satellite nodes to execute health checks from multiple geographic locations."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {satelliteList.map((sat) => (
                  <TableRow key={sat.id}>
                    <TableCell>
                      <p className="font-medium">{sat.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {sat.id}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        {sat.region}
                      </div>
                    </TableCell>
                    <TableCell>
                      <SatelliteStatusBadge status={sat.status} />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground font-mono">
                        {sat.version ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(sat)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateSatelliteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void refetch()}
      />

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(undefined)}
        title="Delete Satellite"
        message={`Are you sure you want to delete satellite "${deleteTarget?.name}"? This will remove all satellite assignments from health checks.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        isLoading={deleteMutation.isPending}
      />
    </PageLayout>
  );
};

export const SatelliteListPage = wrapInSuspense(SatelliteListPageContent);
