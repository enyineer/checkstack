import React, { useState } from "react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  SatelliteApi,
  satelliteAccess,
  pluginMetadata as satellitePluginMetadata,
} from "@checkstack/satellite-common";
import { Tip } from "@checkstack/tips-frontend";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  LoadingSpinner,
  EmptyState,
  QueryErrorState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  useToast,
  ConfirmationModal,
  PageLayout,
  ResponsiveTable,
  MobileCardList,
  toastError,
  cn,
  formatRelativeTime,
} from "@checkstack/ui";
import { Plus, Satellite, Trash2, MapPin, KeyRound } from "lucide-react";
import { SatelliteStatusBadge } from "../components/SatelliteStatusBadge";
import { FleetSummaryStrip } from "../components/FleetSummaryStrip";
import { SatelliteMobileCard } from "../components/SatelliteMobileCard";
import { CreateSatelliteDialog } from "../components/CreateSatelliteDialog";
import { RotateSatelliteTokenDialog } from "../components/RotateSatelliteTokenDialog";
import {
  useProvenanceLocks,
  GitOpsSourceBadge,
} from "@checkstack/gitops-frontend";

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
  const [rotateTarget, setRotateTarget] = useState<
    SatelliteWithStatus | undefined
  >();

  const { getLock } = useProvenanceLocks();

  const satellitesQuery = satelliteClient.listSatellites.useQuery();
  const { data: satellites, isLoading, refetch } = satellitesQuery;

  const deleteMutation = satelliteClient.deleteSatellite.useMutation({
    onSuccess: () => {
      toast.success("Satellite deleted");
      void refetch();
      setDeleteTarget(undefined);
    },
    onError: (error) => {
      toastError(toast, "Failed to delete satellite", error);
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
        <Tip
          plugin={satellitePluginMetadata}
          id="create"
          title="Run checks from anywhere"
          description="A satellite is a small Checkstack agent you deploy somewhere this server can't reach directly - another region, a customer site, an air-gapped network. Once registered, you can pin specific health checks to it."
          side="bottom"
          align="end"
        >
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Satellite
          </Button>
        </Tip>
      }
    >
      {satelliteList.length > 0 && (
        <FleetSummaryStrip satellites={satelliteList} />
      )}

      <Card className="border-border/70 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
        <CardHeader className="border-b border-border bg-gradient-to-b from-surface-2 to-surface">
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
          ) : satellitesQuery.isError ? (
            <div className="p-4">
              <QueryErrorState
                error={satellitesQuery.error}
                onRetry={() => void satellitesQuery.refetch()}
                resource="satellites"
              />
            </div>
          ) : satelliteList.length === 0 ? (
            <EmptyState
              icon={<Satellite className="size-10" />}
              title="No satellites yet"
              description="A satellite is a small Checkstack agent you run somewhere else - another region, another VPC, a customer site - that executes health checks and reports results back to this server. You only need them if you want checks to run from a vantage point this server can't reach itself."
              steps={[
                "Create a satellite here to mint a registration token.",
                "Deploy the satellite container or binary on the target machine using that token.",
                "Once it's online, assign health checks to it on a per-check basis - TCP, HTTP, ping etc. all support satellite execution.",
              ]}
              actions={
                canManage ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create satellite
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <ResponsiveTable>
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
                    {satelliteList.map((sat) => {
                      const lock = getLock({
                        kind: "Satellite",
                        entityId: sat.id,
                      });
                      const lastSeen = formatRelativeTime(
                        sat.lastHeartbeatAt,
                      );
                      return (
                        <TableRow
                          key={sat.id}
                          className="transition-colors hover:bg-surface-inset"
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <span
                                className={cn(
                                  "h-8 w-1 shrink-0 rounded-full",
                                  sat.status === "online"
                                    ? "bg-status-ok"
                                    : "bg-status-down",
                                )}
                                aria-hidden
                              />
                              {lock.isLocked && lock.provenance && (
                                <GitOpsSourceBadge
                                  provenance={lock.provenance}
                                />
                              )}
                              <div>
                                <p className="font-medium text-foreground">
                                  {sat.name}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {sat.id}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5" />
                              {sat.region}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <SatelliteStatusBadge status={sat.status} />
                              {lastSeen && (
                                <span className="text-xs text-muted-foreground">
                                  Last seen {lastSeen}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground font-mono tabular-nums">
                              {sat.version ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Reset token"
                                aria-label={`Reset token for ${sat.name}`}
                                onClick={() => setRotateTarget(sat)}
                              >
                                <KeyRound className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={lock.isLocked}
                                title={
                                  lock.isLocked
                                    ? "Managed by GitOps"
                                    : "Delete satellite"
                                }
                                aria-label={`Delete ${sat.name}`}
                                onClick={() => setDeleteTarget(sat)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ResponsiveTable>

              <MobileCardList className="p-2">
                {satelliteList.map((sat) => (
                  <SatelliteMobileCard
                    key={sat.id}
                    satellite={sat}
                    lock={getLock({ kind: "Satellite", entityId: sat.id })}
                    onRotate={setRotateTarget}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </MobileCardList>
            </>
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

      <RotateSatelliteTokenDialog
        satellite={rotateTarget}
        onClose={() => setRotateTarget(undefined)}
        onRotated={() => void refetch()}
      />
    </PageLayout>
  );
};

export const SatelliteListPage = wrapInSuspense(SatelliteListPageContent);
