import React, { useEffect, useMemo, useState } from "react";
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
import {
  incidentAccess,
  incidentResourceTypes,
  pluginMetadata as incidentPluginMetadata,
} from "@checkstack/incident-common";
import { Tip, TipBanner } from "@checkstack/tips-frontend";
import { CatalogApi, catalogResourceTypes } from "@checkstack/catalog-common";
import { APP_DOC_SLUGS, docsPath } from "@checkstack/common";
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
  ResponsiveTable,
  MobileCardList,
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
  AlertTriangle,
  Trash2,
  Edit2,
  Clock,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { IncidentEditor } from "../components/IncidentEditor";
import {
  getIncidentStatusBadge,
  getIncidentSeverityBadge,
  getIncidentSeverityAccentClass,
} from "../utils/badges";
import {
  canResolveIncident,
  selectableIncidentIds,
  resolvableIncidentIds,
  pruneSelection,
  summarizeBulkOutcome,
} from "./incidentConfig.logic";

/**
 * In-app deep-link to the Incidents concept page (same-origin Starlight build
 * served at `/checkstack/*`). Slug is centralised in `APP_DOC_SLUGS` and guarded
 * against renames by `docs-links.test.ts`.
 */
const DOCS_INCIDENTS = docsPath(APP_DOC_SLUGS.incidents);

/** Inline "Learn more" link to the incidents concept docs. */
const IncidentLearnMore = () => (
  <a
    href={DOCS_INCIDENTS}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:no-underline"
  >
    Learn more
    <ExternalLink className="h-3 w-3" />
  </a>
);

const IncidentConfigPageContent: React.FC = () => {
  const incidentClient = usePluginClient(IncidentApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Create capability: gates the "Report Incident" action. A user who manages a
  // system (directly or via a team) may open an incident for it even without the
  // global `incident.manage` rule, and the backend authorizes exactly that.
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useCanCreate({
      accessRule: incidentAccess.incident.manage,
      objectType: incidentResourceTypes.incident,
      parentType: catalogResourceTypes.system,
    });
  // Surface access: gates reaching this page (matches the route guard). Also
  // true for a user who manages an existing incident via a team but cannot
  // create new ones - they still need to open the page to manage theirs.
  const { allowed: canAccessSurface, loading: surfaceLoading } =
    accessApi.useCanAccessType({
      accessRule: incidentAccess.incident.manage,
      objectType: incidentResourceTypes.incident,
      parentType: catalogResourceTypes.system,
    });

  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">(
    "all",
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

  // Multi-select state for the mass (bulk) actions. Only ids the user can
  // MANAGE ever enter this set (see selectableIds + toggle handlers below).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkResolveOpen, setBulkResolveOpen] = useState(false);

  // Fetch incidents with useQuery
  const incidentsQuery = incidentClient.listIncidents.useQuery(
    statusFilter === "all"
      ? { includeResolved: showResolved }
      : { status: statusFilter, includeResolved: showResolved },
  );
  const {
    data: incidentsData,
    isLoading: incidentsLoading,
    refetch: refetchIncidents,
  } = incidentsQuery;

  // Fetch systems with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  // Memoized so the array reference is stable across renders where the query
  // data is unchanged, keeping the selectableIds memo (and its prune effect)
  // from re-running every render.
  const incidents = useMemo(
    () => incidentsData?.incidents ?? [],
    [incidentsData],
  );
  const systems = systemsData?.systems ?? [];
  const loading = incidentsLoading || systemsLoading;

  // Per-resource action gate: ORs the global rule with a team grant on each
  // specific incident, so team-scoped managers see actions only for incidents
  // they own while global managers see them for all.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: incidentAccess.incident.manage,
    objectType: incidentResourceTypes.incident,
    resourceIds: incidents.map((i) => i.id),
  });

  // Ids the user may bulk-act on (manageable rows only) and, of the current
  // selection, the subset still resolvable. Both feed the multi-select UI and
  // keep it in lock-step with what the backend will accept.
  const selectableIds = useMemo(
    () => selectableIncidentIds({ incidents, canAccess }),
    [incidents, canAccess],
  );
  const resolvableSelected = resolvableIncidentIds({
    selectedIds,
    incidents,
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
      toastError(toast, "Failed to delete", error);
    },
  });

  const resolveMutation = incidentClient.resolveIncident.useMutation({
    onSuccess: () => {
      toast.success("Incident resolved");
      void refetchIncidents();
      setResolveId(undefined);
    },
    onError: (error) => {
      toastError(toast, "Failed to resolve", error);
    },
  });

  const bulkDeleteMutation = incidentClient.bulkDeleteIncidents.useMutation({
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
      void refetchIncidents();
    },
    onError: (error) => {
      toastError(toast, "Mass delete failed", error);
    },
  });

  const bulkResolveMutation = incidentClient.bulkResolveIncidents.useMutation({
    onSuccess: (data) => {
      toast.success(
        summarizeBulkOutcome({
          results: data.results,
          successStatus: "resolved",
          successLabel: "resolved",
        }),
      );
      setSelectedIds(new Set());
      setBulkResolveOpen(false);
      void refetchIncidents();
    },
    onError: (error) => {
      toastError(toast, "Mass resolve failed", error);
    },
  });

  const handleBulkDelete = () => {
    // Submit only ids that are still manageable (defensive: the selection is
    // already pruned to selectableIds).
    const ids = [...selectedIds].filter((id) => selectableIds.includes(id));
    if (ids.length === 0) return;
    bulkDeleteMutation.mutate({ ids });
  };

  const handleBulkResolve = () => {
    // Resolve only the still-resolvable subset of the selection.
    if (resolvableSelected.length === 0) return;
    bulkResolveMutation.mutate({ ids: resolvableSelected });
  };

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
      icon={AlertTriangle}
      loading={accessLoading || surfaceLoading}
      allowed={canAccessSurface}
      actions={
        <Tip
          plugin={incidentPluginMetadata}
          id="report"
          title="Incidents are deliberate, not automatic"
          description={
            <>
              Incidents in Checkstack are events you open by hand for real,
              user-visible problems - they're not auto-created from failing
              health checks. Use “Report Incident” to record an outage you've
              detected (your own monitoring, a customer ticket, a security event)
              so it shows up on the dashboard and the public status page, and so
              subscribers get notified. <IncidentLearnMore />
            </>
          }
          side="bottom"
          align="end"
        >
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Report Incident
          </Button>
        </Tip>
      }
    >
      <TipBanner
        plugin={incidentPluginMetadata}
        id="config.intro"
        title="What an incident is here"
        description={
          <>
            An incident is a manual record of a real, user-visible outage. You
            open it by hand - Checkstack never creates one from a failed health
            check - so it surfaces on the dashboard and status page and reaches
            subscribers. <IncidentLearnMore />
          </>
        }
      />

      <Card>
        <CardHeader className="border-b border-border">
          <CardHeaderRow>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Incidents</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <label className="flex items-center gap-2 text-sm whitespace-nowrap">
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
                <SelectTrigger className="w-full sm:w-40">
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
          </CardHeaderRow>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : incidentsQuery.isError ? (
            <div className="p-4">
              <QueryErrorState
                error={incidentsQuery.error}
                onRetry={() => void incidentsQuery.refetch()}
                resource="incidents"
              />
            </div>
          ) : incidents.length === 0 ? (
            <EmptyState
              icon={<AlertTriangle className="size-10" />}
              title="No incidents found"
              description="Incidents capture real, user-visible problems with the systems you monitor. They're created intentionally - Checkstack does not auto-open them from failed health checks, because not every failed check is a real outage. Open one by hand whenever something's actually broken so it shows up on the dashboard, on the status page, and reaches subscribers."
              steps={[
                "Adjust the filters above if you're looking for resolved or older incidents.",
                "Click “Report Incident” to record an outage you've detected.",
                "Linked systems and severity drive who gets notified - set them deliberately.",
              ]}
              actions={
                canManage ? (
                  <Button onClick={handleCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Report incident manually
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {selectableIds.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-inset/60 px-4 py-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all incidents"
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
                        onClick={() => setBulkResolveOpen(true)}
                        disabled={resolvableSelected.length === 0}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2 text-success" />
                        Mass resolve
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
              <ResponsiveTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" aria-hidden />
                      <TableHead className="w-6" aria-hidden />
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
                      <TableRow
                        key={i.id}
                        data-state={
                          selectedIds.has(i.id) ? "selected" : undefined
                        }
                        className="hover:bg-surface-inset"
                      >
                        <TableCell className="pr-0">
                          {canAccess(i.id) && (
                            <Checkbox
                              checked={selectedIds.has(i.id)}
                              onCheckedChange={() => toggleOne(i.id)}
                              aria-label={`Select incident ${i.title}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="pr-0">
                          {/* Severity lead: scannable by hue + position. */}
                          <span
                            className={cn(
                              "block size-2.5 rounded-full",
                              getIncidentSeverityAccentClass(i.severity),
                            )}
                            aria-hidden
                          />
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {i.title}
                            </p>
                            {i.description && (
                              <p className="text-xs text-muted-foreground truncate max-w-xs">
                                {i.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {getIncidentSeverityBadge(i.severity)}
                        </TableCell>
                        <TableCell>
                          {getIncidentStatusBadge(i.status)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {getSystemNames(i.systemIds)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span className="tabular-nums">
                              {formatDistanceToNow(new Date(i.createdAt), {
                                addSuffix: false,
                              })}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {canAccess(i.id) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEdit(i)}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            )}
                            {canAccess(i.id) && canResolveIncident({ status: i.status }) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setResolveId(i.id)}
                              >
                                <CheckCircle2 className="h-4 w-4 text-success" />
                              </Button>
                            )}
                            {canAccess(i.id) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteId(i.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ResponsiveTable>

              <MobileCardList className="p-4">
                {incidents.map((i) => (
                  <div
                    key={i.id}
                    data-state={selectedIds.has(i.id) ? "selected" : undefined}
                    className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] data-[state=selected]:border-primary"
                  >
                    {/* Severity accent: multi-encoded by hue + position. */}
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 w-1",
                        getIncidentSeverityAccentClass(i.severity),
                      )}
                      aria-hidden
                    />
                    <div className="pl-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {canAccess(i.id) && (
                            <Checkbox
                              checked={selectedIds.has(i.id)}
                              onCheckedChange={() => toggleOne(i.id)}
                              aria-label={`Select incident ${i.title}`}
                            />
                          )}
                          <p className="min-w-0 truncate font-semibold text-foreground">
                            {i.title}
                          </p>
                        </div>
                        {getIncidentStatusBadge(i.status)}
                      </div>
                      {i.description && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {i.description}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {getIncidentSeverityBadge(i.severity)}
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span className="tabular-nums">
                            {formatDistanceToNow(new Date(i.createdAt), {
                              addSuffix: false,
                            })}
                          </span>
                        </span>
                      </div>
                      {i.systemIds.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {getSystemNames(i.systemIds)}
                        </p>
                      )}
                      <div className="mt-3 flex justify-end gap-2">
                      {canAccess(i.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(i)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      )}
                      {canAccess(i.id) && canResolveIncident({ status: i.status }) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setResolveId(i.id)}
                        >
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        </Button>
                      )}
                      {canAccess(i.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(i.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                      </div>
                    </div>
                  </div>
                ))}
              </MobileCardList>
            </>
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

      <ConfirmationModal
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title="Delete incidents"
        message={`Delete ${selectedIds.size} selected ${
          selectedIds.size === 1 ? "incident" : "incidents"
        }? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={handleBulkDelete}
        isLoading={bulkDeleteMutation.isPending}
      />

      <ConfirmationModal
        isOpen={bulkResolveOpen}
        onClose={() => setBulkResolveOpen(false)}
        title="Resolve incidents"
        message={`Mark ${resolvableSelected.length} selected ${
          resolvableSelected.length === 1 ? "incident" : "incidents"
        } as resolved?`}
        confirmText="Resolve"
        variant="info"
        onConfirm={handleBulkResolve}
        isLoading={bulkResolveMutation.isPending}
      />
    </PageLayout>
  );
};

export const IncidentConfigPage = wrapInSuspense(IncidentConfigPageContent);
