import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { MaintenanceApi } from "../api";
import type {
  MaintenanceWithSystems,
  MaintenanceStatus,
} from "@checkstack/maintenance-common";
import {
  maintenanceAccess,
  maintenanceResourceTypes,
  pluginMetadata as maintenancePluginMetadata,
} from "@checkstack/maintenance-common";
import { Tip } from "@checkstack/tips-frontend";
import { CatalogApi, catalogResourceTypes } from "@checkstack/catalog-common";
import {
  Button,
  LoadingSpinner,
  EmptyState,
  QueryErrorState,
  DataTable,
  type DataTableColumn,
  RowActions,
  RowAction,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  useToast,
  ConfirmationModal,
  PageLayout,
  toastError,
  cn,
} from "@checkstack/ui";
import {
  Plus,
  Wrench,
  Calendar,
  Trash2,
  Edit2,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { MaintenanceEditor } from "../components/MaintenanceEditor";
import { MaintenanceScheduleHero } from "../components/MaintenanceScheduleHero";
import {
  getMaintenanceStatusBadge,
  getMaintenanceStatusTone,
  getMaintenanceToneAccentClass,
  maintenanceStatusRank,
} from "../utils/badges";
import {
  canComplete,
  summarizeSystemNames,
  selectableMaintenanceIds,
  completableMaintenanceIds,
  pruneSelection,
  summarizeBulkOutcome,
} from "./maintenanceConfig.logic";

const MaintenanceConfigPageContent: React.FC = () => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Create capability: gates the "Create Maintenance" action. A user who manages
  // a system (directly or via a team) may schedule maintenance for it even
  // without the global `maintenance.manage` rule; the backend authorizes that.
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useProcedureAccess(MaintenanceApi.contract.createMaintenance);
  // Surface access: gates reaching this page (matches the route guard), and is
  // also true for a user who manages an existing maintenance via a team.
  const { allowed: canAccessSurface, loading: surfaceLoading } =
    accessApi.useCanAccessType({
      accessRule: maintenanceAccess.maintenance.manage,
      objectType: maintenanceResourceTypes.maintenance,
      parentType: catalogResourceTypes.system,
    });

  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | "all">(
    "all",
  );

  // Completed maintenances are hidden by default (the list endpoint excludes
  // them unless `includeCompleted` is set); this toggle opts them back in.
  const [showCompleted, setShowCompleted] = useState(false);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMaintenance, setEditingMaintenance] = useState<
    MaintenanceWithSystems | undefined
  >();

  // Delete confirmation state
  const [deleteId, setDeleteId] = useState<string | undefined>();

  // Complete confirmation state
  const [completeId, setCompleteId] = useState<string | undefined>();

  // Multi-select state for the mass (bulk) actions. Only ids the user can
  // MANAGE ever enter this set (see selectableIds + toggle handlers below).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkCompleteOpen, setBulkCompleteOpen] = useState(false);

  // Fetch maintenances with useQuery
  const maintenancesQuery = maintenanceClient.listMaintenances.useQuery(
    statusFilter === "all"
      ? { includeCompleted: showCompleted }
      : { status: statusFilter, includeCompleted: showCompleted },
  );
  const {
    data: maintenancesData,
    isLoading: maintenancesLoading,
    refetch: refetchMaintenances,
  } = maintenancesQuery;

  // Fetch systems with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  // Memoized so the array reference is stable across renders where the query
  // data is unchanged, keeping the selectableIds memo (and its prune effect)
  // from re-running every render.
  const maintenances = useMemo(
    () => maintenancesData?.maintenances ?? [],
    [maintenancesData],
  );
  const systems = systemsData?.systems ?? [];
  const loading = maintenancesLoading || systemsLoading;

  // Per-resource gate: a user may manage a specific maintenance via a team
  // grant on that object even without the global rule (global-manage users
  // pass automatically). Gates each row's Edit / Complete / Delete action.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: maintenanceAccess.maintenance.manage,
    objectType: maintenanceResourceTypes.maintenance,
    resourceIds: maintenances.map((m) => m.id),
  });

  // Ids the user may bulk-act on (manageable rows only) and, of the current
  // selection, the subset still completable. Both feed the multi-select UI and
  // keep it in lock-step with what the backend will accept.
  const selectableIds = useMemo(
    () => selectableMaintenanceIds({ maintenances, canAccess }),
    [maintenances, canAccess],
  );
  const completableSelected = completableMaintenanceIds({
    selectedIds,
    maintenances,
    canAccess,
  });
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  // Prune the selection whenever the selectable set changes (refetch, grant
  // revoked, row deleted) so a stale id can never be submitted. The functional
  // update returns the SAME set reference when nothing changed, so React bails
  // out of the re-render and this never loops despite the unstable dep.
  useEffect(() => {
    setSelectedIds((prev) => {
      const pruned = pruneSelection({ selectedIds: prev, selectableIds });
      return pruned.length === prev.size ? prev : new Set(pruned);
    });
  }, [selectableIds]);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  };

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setEditingMaintenance(undefined);
      setEditorOpen(true);
      // Clear the URL param after opening
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  // Mutations
  const deleteMutation = maintenanceClient.deleteMaintenance.useMutation({
    onSuccess: () => {
      toast.success("Maintenance deleted");
      void refetchMaintenances();
      setDeleteId(undefined);
    },
    onError: (error) => {
      toastError(toast, "Failed to delete", error);
    },
  });

  const completeMutation = maintenanceClient.closeMaintenance.useMutation({
    onSuccess: () => {
      toast.success("Maintenance completed");
      void refetchMaintenances();
      setCompleteId(undefined);
    },
    onError: (error) => {
      toastError(toast, "Failed to complete", error);
    },
  });

  const bulkDeleteMutation = maintenanceClient.bulkDeleteMaintenances.useMutation(
    {
      onSuccess: (data) => {
        toast.success(
          summarizeBulkOutcome({
            results: data.results,
            successStatus: "deleted",
            successLabel: "deleted",
          }),
        );
        setSelectedIds(new Set());
        setBulkDeleteOpen(false);
        void refetchMaintenances();
      },
      onError: (error) => {
        toastError(toast, "Mass delete failed", error);
      },
    },
  );

  const bulkCompleteMutation =
    maintenanceClient.bulkCloseMaintenances.useMutation({
      onSuccess: (data) => {
        toast.success(
          summarizeBulkOutcome({
            results: data.results,
            successStatus: "completed",
            successLabel: "completed",
          }),
        );
        setSelectedIds(new Set());
        setBulkCompleteOpen(false);
        void refetchMaintenances();
      },
      onError: (error) => {
        toastError(toast, "Mass complete failed", error);
      },
    });

  const handleBulkDelete = () => {
    // Submit only ids that are still manageable (defensive: the selection is
    // already pruned to selectableIds).
    const ids = [...selectedIds].filter((id) => selectableIds.includes(id));
    if (ids.length === 0) return;
    bulkDeleteMutation.mutate({ ids });
  };

  const handleBulkComplete = () => {
    // Complete only the still-completable subset of the selection.
    if (completableSelected.length === 0) return;
    bulkCompleteMutation.mutate({ ids: completableSelected });
  };

  const handleCreate = () => {
    setEditingMaintenance(undefined);
    setEditorOpen(true);
  };

  const handleEdit = (m: MaintenanceWithSystems) => {
    setEditingMaintenance(m);
    setEditorOpen(true);
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteMutation.mutate({ id: deleteId });
  };

  const handleComplete = () => {
    if (!completeId) return;
    completeMutation.mutate({ id: completeId });
  };

  const handleSave = () => {
    setEditorOpen(false);
    void refetchMaintenances();
  };

  const columns: DataTableColumn<MaintenanceWithSystems>[] = [
    {
      id: "select",
      headClassName: "w-8",
      header: "",
      cellClassName: "pr-0",
      cell: (maintenance) =>
        canAccess(maintenance.id) ? (
          <Checkbox
            checked={selectedIds.has(maintenance.id)}
            onCheckedChange={() => toggleOne(maintenance.id)}
            aria-label={`Select maintenance ${maintenance.title}`}
          />
        ) : null,
    },
    {
      id: "title",
      header: "Title",
      sortValue: (maintenance) => maintenance.title,
      cell: (maintenance) => (
        <div className="relative pl-3">
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-1 rounded-full",
              getMaintenanceToneAccentClass(
                getMaintenanceStatusTone(maintenance.status),
              ),
            )}
            aria-hidden
          />
          <p className="font-medium">{maintenance.title}</p>
          {maintenance.description && (
            <p className="text-sm text-muted-foreground truncate max-w-xs">
              {maintenance.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (maintenance) => maintenanceStatusRank[maintenance.status],
      cell: (maintenance) => getMaintenanceStatusBadge(maintenance.status),
    },
    {
      id: "systems",
      header: "Systems",
      cellClassName: "text-sm text-muted-foreground",
      cell: (maintenance) =>
        summarizeSystemNames({ systemIds: maintenance.systemIds, systems }),
    },
    {
      id: "schedule",
      header: "Schedule",
      sortValue: (maintenance) => new Date(maintenance.startAt).getTime(),
      cell: (maintenance) => (
        <>
          <MaintenanceScheduleHero
            startAt={maintenance.startAt}
            endAt={maintenance.endAt}
          />
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>
                {format(new Date(maintenance.startAt), "MMM d, HH:mm")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>
                {format(new Date(maintenance.endAt), "MMM d, HH:mm")}
              </span>
            </div>
          </div>
        </>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-32",
      cell: (maintenance) => (
        <RowActions>
          {canAccess(maintenance.id) && (
            <RowAction
              icon={Edit2}
              label={`Edit ${maintenance.title}`}
              onClick={() => handleEdit(maintenance)}
            />
          )}
          {canAccess(maintenance.id) &&
            canComplete({ status: maintenance.status }) && (
              <RowAction
                icon={CheckCircle2}
                label={`Complete ${maintenance.title}`}
                tone="success"
                onClick={() => setCompleteId(maintenance.id)}
              />
            )}
          {canAccess(maintenance.id) && (
            <RowAction
              icon={Trash2}
              label={`Delete ${maintenance.title}`}
              tone="destructive"
              onClick={() => setDeleteId(maintenance.id)}
            />
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <PageLayout
      title="Planned Maintenances"
      subtitle="Manage scheduled maintenance windows for systems"
      icon={Wrench}
      loading={accessLoading || surfaceLoading}
      allowed={canAccessSurface}
      actions={
        <Tip
          plugin={maintenancePluginMetadata}
          id="windows.create"
          title="Tell Checkstack about expected downtime"
          description="Maintenance windows mark a period where you expect a system to be partially or fully unavailable. Checkstack uses them to suppress incidents, mark systems as “under maintenance” on the public status page, and (optionally) exclude the window from SLO error budgets."
          side="bottom"
          align="end"
        >
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create Maintenance
          </Button>
        </Tip>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3 sm:gap-4">
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="rounded border-border"
          />
          Show completed
        </label>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as MaintenanceStatus | "all")}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <LoadingSpinner />
        </div>
      ) : maintenancesQuery.isError ? (
        <QueryErrorState
          error={maintenancesQuery.error}
          onRetry={() => void maintenancesQuery.refetch()}
          resource="maintenances"
        />
      ) : (
        <>
          {selectableIds.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-inset/60 px-4 py-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all maintenances"
                />
                <span className="text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : "Select all"}
                </span>
              </label>
              {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkCompleteOpen(true)}
                    disabled={completableSelected.length === 0}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2 text-success" />
                    Mass complete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkDeleteOpen(true)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive/90"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Mass delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>
          )}

          <DataTable
            data={maintenances}
            columns={columns}
            getRowId={(maintenance) => maintenance.id}
            searchable={false}
            getRowProps={(maintenance) => ({
              selected: selectedIds.has(maintenance.id),
              className: "hover:bg-surface-inset",
            })}
            emptyState={
              <EmptyState
                icon={<Wrench className="size-10" />}
                title="No planned maintenances"
                description="A maintenance window tells Checkstack “this system is expected to be down or degraded” for a defined period. Failed health checks during the window are still recorded but are treated as expected - the system is flagged as “in maintenance” on the public status page, and notifications about it are suppressed."
                steps={[
                  "Click “Create Maintenance” and pick the systems that will be affected.",
                  "Set a start time, end time, and a short summary your users will see.",
                  "Subscribers (groups, status page subscribers, integrations) are notified automatically when the window starts and ends.",
                ]}
                actions={
                  canManage ? (
                    <Button onClick={handleCreate}>
                      <Plus className="h-4 w-4 mr-2" />
                      Schedule maintenance
                    </Button>
                  ) : undefined
                }
              />
            }
            renderMobileCard={(m) => (
              <div
                data-state={selectedIds.has(m.id) ? "selected" : undefined}
                className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] data-[state=selected]:border-primary"
              >
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-1",
                    getMaintenanceToneAccentClass(
                      getMaintenanceStatusTone(m.status),
                    ),
                  )}
                  aria-hidden
                />
                <div className="flex items-start justify-between gap-2 pl-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {canAccess(m.id) && (
                      <Checkbox
                        checked={selectedIds.has(m.id)}
                        onCheckedChange={() => toggleOne(m.id)}
                        aria-label={`Select maintenance ${m.title}`}
                      />
                    )}
                    <p className="min-w-0 truncate font-medium">{m.title}</p>
                  </div>
                  {getMaintenanceStatusBadge(m.status)}
                </div>
                {m.description && (
                  <p className="mt-1 truncate pl-2 text-xs text-muted-foreground">
                    {m.description}
                  </p>
                )}
                <div className="mt-3 pl-2">
                  <MaintenanceScheduleHero
                    startAt={m.startAt}
                    endAt={m.endAt}
                  />
                </div>
                {m.systemIds.length > 0 && (
                  <p className="mt-2 pl-2 text-xs text-muted-foreground">
                    {summarizeSystemNames({
                      systemIds: m.systemIds,
                      systems,
                    })}
                  </p>
                )}
                <div className="mt-2 space-y-1 pl-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>
                      {format(new Date(m.startAt), "MMM d, HH:mm")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{format(new Date(m.endAt), "MMM d, HH:mm")}</span>
                  </div>
                </div>
                <RowActions className="mt-3">
                  {canAccess(m.id) && (
                    <RowAction
                      icon={Edit2}
                      label={`Edit ${m.title}`}
                      onClick={() => handleEdit(m)}
                    />
                  )}
                  {canAccess(m.id) && canComplete({ status: m.status }) && (
                    <RowAction
                      icon={CheckCircle2}
                      label={`Complete ${m.title}`}
                      tone="success"
                      onClick={() => setCompleteId(m.id)}
                    />
                  )}
                  {canAccess(m.id) && (
                    <RowAction
                      icon={Trash2}
                      label={`Delete ${m.title}`}
                      tone="destructive"
                      onClick={() => setDeleteId(m.id)}
                    />
                  )}
                </RowActions>
              </div>
            )}
          />
        </>
      )}

      <MaintenanceEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        maintenance={editingMaintenance}
        systems={systems}
        onSave={handleSave}
      />

      <ConfirmationModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(undefined)}
        title="Delete Maintenance"
        message="Are you sure you want to delete this maintenance? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        isLoading={deleteMutation.isPending}
      />

      <ConfirmationModal
        isOpen={!!completeId}
        onClose={() => setCompleteId(undefined)}
        title="Complete Maintenance"
        message="Are you sure you want to mark this maintenance as completed?"
        confirmText="Complete"
        variant="info"
        onConfirm={handleComplete}
        isLoading={completeMutation.isPending}
      />

      <ConfirmationModal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title="Delete maintenances"
        message={`Delete ${selectedIds.size} selected ${
          selectedIds.size === 1 ? "maintenance" : "maintenances"
        }? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={handleBulkDelete}
        isLoading={bulkDeleteMutation.isPending}
      />

      <ConfirmationModal
        isOpen={bulkCompleteOpen}
        onClose={() => setBulkCompleteOpen(false)}
        title="Complete maintenances"
        message={`Mark ${completableSelected.length} selected ${
          completableSelected.length === 1 ? "maintenance" : "maintenances"
        } as completed?`}
        confirmText="Complete"
        variant="info"
        onConfirm={handleBulkComplete}
        isLoading={bulkCompleteMutation.isPending}
      />
    </PageLayout>
  );
};

export const MaintenanceConfigPage = wrapInSuspense(
  MaintenanceConfigPageContent,
);
