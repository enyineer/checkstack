import React, { useEffect, useState, useMemo } from "react";
import {
  useApi,
  rpcApiRef,
  permissionApiRef,
  wrapInSuspense,
} from "@checkmate/frontend-api";
import { maintenanceApiRef } from "../api";
import type {
  MaintenanceWithSystems,
  MaintenanceStatus,
} from "@checkmate/maintenance-common";
import type { CatalogClient, System } from "@checkmate/catalog-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  LoadingSpinner,
  EmptyState,
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
} from "@checkmate/ui";
import { Plus, Wrench, Calendar, Trash2, Edit2, Clock } from "lucide-react";
import { format } from "date-fns";
import { MaintenanceEditor } from "../components/MaintenanceEditor";

const MaintenanceConfigPageContent: React.FC = () => {
  const api = useApi(maintenanceApiRef);
  const rpcApi = useApi(rpcApiRef);
  const permissionApi = useApi(permissionApiRef);

  const catalogApi = useMemo(
    () => rpcApi.forPlugin<CatalogClient>("catalog-backend"),
    [rpcApi]
  );
  const toast = useToast();

  const { allowed: canManage, loading: permissionLoading } =
    permissionApi.useResourcePermission("maintenance", "manage");

  const [maintenances, setMaintenances] = useState<MaintenanceWithSystems[]>(
    []
  );
  const [systems, setSystems] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | "all">(
    "all"
  );

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMaintenance, setEditingMaintenance] = useState<
    MaintenanceWithSystems | undefined
  >();

  // Delete confirmation state
  const [deleteId, setDeleteId] = useState<string | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [maintenanceList, systemList] = await Promise.all([
        api.listMaintenances(
          statusFilter === "all" ? undefined : { status: statusFilter }
        ),
        catalogApi.getSystems(),
      ]);
      setMaintenances(maintenanceList);
      setSystems(systemList);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const handleCreate = () => {
    setEditingMaintenance(undefined);
    setEditorOpen(true);
  };

  const handleEdit = (m: MaintenanceWithSystems) => {
    setEditingMaintenance(m);
    setEditorOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    setIsDeleting(true);
    try {
      await api.deleteMaintenance({ id: deleteId });
      toast.success("Maintenance deleted");
      loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete";
      toast.error(message);
    } finally {
      setIsDeleting(false);
      setDeleteId(undefined);
    }
  };

  const handleSave = () => {
    setEditorOpen(false);
    loadData();
  };

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

  const getSystemNames = (systemIds: string[]): string => {
    const names = systemIds
      .map((id) => systems.find((s) => s.id === id)?.name ?? id)
      .slice(0, 3);
    if (systemIds.length > 3) {
      names.push(`+${systemIds.length - 3} more`);
    }
    return names.join(", ");
  };

  return (
    <PageLayout
      title="Planned Maintenances"
      subtitle="Manage scheduled maintenance windows for systems"
      loading={permissionLoading}
      allowed={canManage}
      actions={
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Maintenance
        </Button>
      }
    >
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Maintenances</CardTitle>
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as MaintenanceStatus | "all")
              }
            >
              <SelectTrigger className="w-40">
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
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : maintenances.length === 0 ? (
            <EmptyState
              title="No maintenances found"
              description="Create your first planned maintenance to get started."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Systems</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
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
                    <TableCell>{getStatusBadge(m.status)}</TableCell>
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
        isLoading={isDeleting}
      />
    </PageLayout>
  );
};

export const MaintenanceConfigPage = wrapInSuspense(
  MaintenanceConfigPageContent
);
