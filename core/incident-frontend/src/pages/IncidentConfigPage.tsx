import React, { useEffect, useState, useMemo } from "react";
import {
  useApi,
  rpcApiRef,
  permissionApiRef,
  wrapInSuspense,
} from "@checkmate-monitor/frontend-api";
import { incidentApiRef } from "../api";
import type {
  IncidentWithSystems,
  IncidentStatus,
} from "@checkmate-monitor/incident-common";
import { CatalogApi, type System } from "@checkmate-monitor/catalog-common";
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
} from "@checkmate-monitor/ui";
import {
  Plus,
  AlertTriangle,
  Trash2,
  Edit2,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { IncidentEditor } from "../components/IncidentEditor";

const IncidentConfigPageContent: React.FC = () => {
  const api = useApi(incidentApiRef);
  const rpcApi = useApi(rpcApiRef);
  const permissionApi = useApi(permissionApiRef);

  const catalogApi = useMemo(() => rpcApi.forPlugin(CatalogApi), [rpcApi]);
  const toast = useToast();

  const { allowed: canManage, loading: permissionLoading } =
    permissionApi.useResourcePermission("incident", "manage");

  const [incidents, setIncidents] = useState<IncidentWithSystems[]>([]);
  const [systems, setSystems] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">(
    "all"
  );
  const [showResolved, setShowResolved] = useState(false);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingIncident, setEditingIncident] = useState<
    IncidentWithSystems | undefined
  >();

  // Delete confirmation state
  const [deleteId, setDeleteId] = useState<string | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);

  // Resolve confirmation state
  const [resolveId, setResolveId] = useState<string | undefined>();
  const [isResolving, setIsResolving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [incidentList, systemList] = await Promise.all([
        api.listIncidents(
          statusFilter === "all"
            ? { includeResolved: showResolved }
            : { status: statusFilter, includeResolved: showResolved }
        ),
        catalogApi.getSystems(),
      ]);
      setIncidents(incidentList);
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
  }, [statusFilter, showResolved]);

  const handleCreate = () => {
    setEditingIncident(undefined);
    setEditorOpen(true);
  };

  const handleEdit = (i: IncidentWithSystems) => {
    setEditingIncident(i);
    setEditorOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    setIsDeleting(true);
    try {
      await api.deleteIncident({ id: deleteId });
      toast.success("Incident deleted");
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

  const handleResolve = async () => {
    if (!resolveId) return;

    setIsResolving(true);
    try {
      await api.resolveIncident({ id: resolveId });
      toast.success("Incident resolved");
      loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve";
      toast.error(message);
    } finally {
      setIsResolving(false);
      setResolveId(undefined);
    }
  };

  const handleSave = () => {
    setEditorOpen(false);
    loadData();
  };

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
      title="Incident Management"
      subtitle="Track and manage incidents affecting your systems"
      loading={permissionLoading}
      allowed={canManage}
      actions={
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Report Incident
        </Button>
      }
    >
      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Incidents</CardTitle>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={(e) => setShowResolved(e.target.checked)}
                  className="rounded border-border"
                />
                Show resolved
              </label>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as IncidentStatus | "all")
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="identified">Identified</SelectItem>
                  <SelectItem value="fixing">Fixing</SelectItem>
                  <SelectItem value="monitoring">Monitoring</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : incidents.length === 0 ? (
            <EmptyState
              title="No incidents found"
              description="No incidents match your current filters."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Systems</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{i.title}</p>
                        {i.description && (
                          <p className="text-sm text-muted-foreground truncate max-w-xs">
                            {i.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getSeverityBadge(i.severity)}</TableCell>
                    <TableCell>{getStatusBadge(i.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {getSystemNames(i.systemIds)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          {formatDistanceToNow(new Date(i.createdAt), {
                            addSuffix: false,
                          })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(i)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        {i.status !== "resolved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setResolveId(i.id)}
                          >
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(i.id)}
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

      <IncidentEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        incident={editingIncident}
        systems={systems}
        onSave={handleSave}
      />

      <ConfirmationModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(undefined)}
        title="Delete Incident"
        message="Are you sure you want to delete this incident? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />

      <ConfirmationModal
        isOpen={!!resolveId}
        onClose={() => setResolveId(undefined)}
        title="Resolve Incident"
        message="Are you sure you want to mark this incident as resolved?"
        confirmText="Resolve"
        variant="info"
        onConfirm={handleResolve}
        isLoading={isResolving}
      />
    </PageLayout>
  );
};

export const IncidentConfigPage = wrapInSuspense(IncidentConfigPageContent);
