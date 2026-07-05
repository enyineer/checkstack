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
  Button,
  LoadingSpinner,
  EmptyState,
  ListEmptyState,
  QueryErrorState,
  DataTable,
  type DataTableColumn,
  RowActions,
  RowAction,
  useToast,
  ConfirmationModal,
  PageLayout,
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

  const columns: DataTableColumn<SatelliteWithStatus>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (sat) => sat.name,
      searchValue: (sat) => `${sat.name} ${sat.id}`,
      cell: (sat) => {
        const lock = getLock({ kind: "Satellite", entityId: sat.id });
        return (
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "h-8 w-1 shrink-0 rounded-full",
                sat.status === "online" ? "bg-status-ok" : "bg-status-down",
              )}
              aria-hidden
            />
            {lock.isLocked && lock.provenance && (
              <GitOpsSourceBadge provenance={lock.provenance} />
            )}
            <div>
              <p className="font-medium text-foreground">{sat.name}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {sat.id}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      id: "region",
      header: "Region",
      sortValue: (sat) => sat.region,
      searchValue: (sat) => sat.region,
      cell: (sat) => (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          {sat.region}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (sat) => sat.status,
      searchValue: (sat) => sat.status,
      cell: (sat) => {
        const lastSeen = formatRelativeTime(sat.lastHeartbeatAt);
        return (
          <div className="flex flex-col gap-1">
            <SatelliteStatusBadge status={sat.status} />
            {lastSeen && (
              <span className="text-xs text-muted-foreground">
                Last seen {lastSeen}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "version",
      header: "Version",
      sortValue: (sat) => sat.version ?? "",
      searchValue: (sat) => sat.version ?? "",
      cell: (sat) => (
        <span className="text-sm text-muted-foreground font-mono tabular-nums">
          {sat.version ?? "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-20",
      cell: (sat) => {
        const lock = getLock({ kind: "Satellite", entityId: sat.id });
        return (
          <RowActions>
            <RowAction
              icon={KeyRound}
              label={`Reset token for ${sat.name}`}
              title="Reset token"
              onClick={() => setRotateTarget(sat)}
            />
            <RowAction
              icon={Trash2}
              tone="destructive"
              label={`Delete ${sat.name}`}
              disabled={lock.isLocked}
              title={lock.isLocked ? "Managed by GitOps" : "Delete satellite"}
              onClick={() => setDeleteTarget(sat)}
            />
          </RowActions>
        );
      },
    },
  ];

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

      <div>
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <LoadingSpinner />
          </div>
        ) : satellitesQuery.isError ? (
          <QueryErrorState
            error={satellitesQuery.error}
            onRetry={() => void satellitesQuery.refetch()}
            resource="satellites"
          />
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
          <DataTable
            data={satelliteList}
            columns={columns}
            getRowId={(sat) => sat.id}
            defaultSort={{ columnId: "name", direction: "asc" }}
            searchPlaceholder="Search satellites..."
            noResultsState={
              <ListEmptyState
                resource="satellites"
                description="No satellites match the current search."
              />
            }
            renderMobileCard={(sat) => (
              <SatelliteMobileCard
                satellite={sat}
                lock={getLock({ kind: "Satellite", entityId: sat.id })}
                onRotate={setRotateTarget}
                onDelete={setDeleteTarget}
              />
            )}
          />
        )}
      </div>

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
