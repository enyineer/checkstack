import React, { useEffect, useState } from "react";
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
  pluginMetadata as maintenancePluginMetadata,
} from "@checkstack/maintenance-common";
import { Tip } from "@checkstack/tips-frontend";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  Card,
  CardHeader,
  CardHeaderRow,
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useToast,
  ConfirmationModal,
  PageLayout,
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
import { getMaintenanceStatusBadge } from "../utils/badges";
import { extractErrorMessage } from "@checkstack/common";

const MaintenanceConfigPageContent: React.FC = () => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    maintenanceAccess.maintenance.manage,
  );

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

  const maintenances = maintenancesData?.maintenances ?? [];
  const systems = systemsData?.systems ?? [];
  const loading = maintenancesLoading || systemsLoading;

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
      toast.error(extractErrorMessage(error, "Failed to delete"));
    },
  });

  const completeMutation = maintenanceClient.closeMaintenance.useMutation({
    onSuccess: () => {
      toast.success("Maintenance completed");
      void refetchMaintenances();
      setCompleteId(undefined);
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to complete"),
      );
    },
  });

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

  const getSystemNames = (systemIds: string[]): string => {
    const names = systemIds
      .map((id) => systems.find((s) => s.id === id)?.name ?? id)
      .slice(0, 3);
    if (systemIds.length > 3) {
      names.push(`+${systemIds.length - 3} more`);
    }
    return names.join(", ");
  };

  const canComplete = (status: MaintenanceStatus) =>
    status !== "completed" && status !== "cancelled";

  return (
    <PageLayout
      title="Planned Maintenances"
      subtitle="Manage scheduled maintenance windows for systems"
      icon={Wrench}
      loading={accessLoading}
      allowed={canManage}
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
      <Card>
        <CardHeader className="border-b border-border">
          <CardHeaderRow>
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Maintenances</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
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
                onValueChange={(v) =>
                  setStatusFilter(v as MaintenanceStatus | "all")
                }
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
          </CardHeaderRow>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : maintenancesQuery.isError ? (
            <div className="p-4">
              <QueryErrorState
                error={maintenancesQuery.error}
                onRetry={() => void maintenancesQuery.refetch()}
                resource="maintenances"
              />
            </div>
          ) : maintenances.length === 0 ? (
            <EmptyState
              icon={<Wrench className="size-10" />}
              title="No planned maintenances"
              description="A maintenance window tells Checkstack “this system is expected to be down or degraded” for a defined period. Failed health checks during the window are still recorded but are treated as expected — the system is flagged as “in maintenance” on the public status page, and notifications about it are suppressed."
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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Systems</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {maintenances.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{m.title}</p>
                        {m.description && (
                          <p className="text-sm text-muted-foreground truncate max-w-xs">
                            {m.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getMaintenanceStatusBadge(m.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {getSystemNames(m.systemIds)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm space-y-1">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          <span>
                            {format(new Date(m.startAt), "MMM d, HH:mm")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>
                            {format(new Date(m.endAt), "MMM d, HH:mm")}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(m)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        {canComplete(m.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCompleteId(m.id)}
                          >
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(m.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
    </PageLayout>
  );
};

export const MaintenanceConfigPage = wrapInSuspense(
  MaintenanceConfigPageContent,
);
