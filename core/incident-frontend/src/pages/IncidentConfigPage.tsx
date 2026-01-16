import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { IncidentApi } from "../api";
import type {
  IncidentWithSystems,
  IncidentStatus,
} from "@checkstack/incident-common";
import { incidentAccess } from "@checkstack/incident-common";
import { CatalogApi } from "@checkstack/catalog-common";
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
} from "@checkstack/ui";
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
  const incidentClient = usePluginClient(IncidentApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    incidentAccess.incident.manage
  );

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

  // Resolve confirmation state
  const [resolveId, setResolveId] = useState<string | undefined>();

  // Fetch incidents with useQuery
  const {
    data: incidentsData,
    isLoading: incidentsLoading,
    refetch: refetchIncidents,
  } = incidentClient.listIncidents.useQuery(
    statusFilter === "all"
      ? { includeResolved: showResolved }
      : { status: statusFilter, includeResolved: showResolved }
  );

  // Fetch systems with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  const incidents = incidentsData?.incidents ?? [];
  const systems = systemsData?.systems ?? [];
  const loading = incidentsLoading || systemsLoading;

  // Handle ?action=create URL parameter (from command palette)
  useEffect(() => {
    if (searchParams.get("action") === "create" && canManage) {
      setEditingIncident(undefined);
      setEditorOpen(true);
      // Clear the URL param after opening
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, canManage, setSearchParams]);

  // Mutations
  const deleteMutation = incidentClient.deleteIncident.useMutation({
    onSuccess: () => {
      toast.success("Incident deleted");
      void refetchIncidents();
      setDeleteId(undefined);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    },
  });

  const resolveMutation = incidentClient.resolveIncident.useMutation({
    onSuccess: () => {
      toast.success("Incident resolved");
      void refetchIncidents();
      setResolveId(undefined);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to resolve");
    },
  });

  const handleCreate = () => {
    setEditingIncident(undefined);
    setEditorOpen(true);
  };

  const handleEdit = (i: IncidentWithSystems) => {
    setEditingIncident(i);
    setEditorOpen(true);
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteMutation.mutate({ id: deleteId });
  };

  const handleResolve = () => {
    if (!resolveId) return;
    resolveMutation.mutate({ id: resolveId });
  };

  const handleSave = () => {
    setEditorOpen(false);
    void refetchIncidents();
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
      loading={accessLoading}
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
        isLoading={deleteMutation.isPending}
      />

      <ConfirmationModal
        isOpen={!!resolveId}
        onClose={() => setResolveId(undefined)}
        title="Resolve Incident"
        message="Are you sure you want to mark this incident as resolved?"
        confirmText="Resolve"
        variant="info"
        onConfirm={handleResolve}
        isLoading={resolveMutation.isPending}
      />
    </PageLayout>
  );
};

export const IncidentConfigPage = wrapInSuspense(IncidentConfigPageContent);
