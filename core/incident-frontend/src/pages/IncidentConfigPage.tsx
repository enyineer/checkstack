import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  useQueryClient,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { IncidentApi } from "../api";
import type { IncidentWithSystems } from "@checkstack/incident-common";
import {
  incidentAccess,
  incidentResourceTypes,
  IncidentStatusEnum,
  pluginMetadata as incidentPluginMetadata,
} from "@checkstack/incident-common";
import { Tip, TipBanner } from "@checkstack/tips-frontend";
import { CatalogApi, catalogResourceTypes } from "@checkstack/catalog-common";
import { APP_DOC_SLUGS, docsPath } from "@checkstack/common";
import {
  Button,
  LoadingSpinner,
  EmptyState,
  QueryErrorState,
  DataTable,
  useDataTableFilters,
  parsedFacetValue,
  type DataTableColumn,
  type DataTableFacetOption,
  RowActions,
  RowAction,
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
  incidentSeverityRank,
  incidentStatusRank,
  presentIncidentStatus,
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

/**
 * Incident lifecycle status options. Labels come from the same presenter the
 * status badges use, so the dropdown and the rows can never disagree about what
 * a status is called - and declaring them keeps the lifecycle order, which
 * deriving from the data would sort alphabetically.
 *
 * The MATCHING lives on the Status column (`filterValue`), so the table renders
 * this control in its own bar. The selection ALSO narrows the list query, which
 * is what actually reduces the fetch; the column filter re-applying it over
 * already-scoped rows is a harmless no-op that keeps the control where a reader
 * expects it - attached to the column it filters.
 */
const INCIDENT_STATUS_FACET_ID = "status";
const INCIDENT_STATUS_OPTIONS: readonly DataTableFacetOption[] =
  IncidentStatusEnum.options.map((status) => ({
    value: status,
    label: presentIncidentStatus(status).label,
  }));

const IncidentConfigPageContent: React.FC = () => {
  const incidentClient = usePluginClient(IncidentApi);
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Deleting or resolving incidents can lift a health override they forced,
  // which is healthcheck's derived data (a different plugin) - invalidate it
  // explicitly (Pillar 2 of the query-invalidation rule).
  const invalidateSystemHealth = () => {
    void queryClient.invalidateQueries({ queryKey: [["healthcheck"]] });
  };

  // Create capability: gates the "Report Incident" action. A user who manages a
  // system (directly or via a team) may open an incident for it even without the
  // global `incident.manage` rule, and the backend authorizes exactly that.
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useProcedureAccess(IncidentApi.contract.createIncident);
  // Surface access: gates reaching this page (matches the route guard). Also
  // true for a user who manages an existing incident via a team but cannot
  // create new ones - they still need to open the page to manage theirs.
  const { allowed: canAccessSurface, loading: surfaceLoading } =
    accessApi.useCanAccessType({
      accessRule: incidentAccess.incident.manage,
      objectType: incidentResourceTypes.incident,
      parentType: catalogResourceTypes.system,
    });

  // Server-side filtering (both feed the list query's input), so the table
  // declares no facets - the shared bar drives the query. The status facet is
  // URL-backed, so a link to "the incidents being investigated" reopens filtered.
  const filters = useDataTableFilters({
    facetIds: [INCIDENT_STATUS_FACET_ID],
  });
  const statusFilter = parsedFacetValue({
    filters: filters.state,
    facetId: INCIDENT_STATUS_FACET_ID,
    schema: IncidentStatusEnum,
  });
  // NOT a facet: a facet NARROWS, and this WIDENS the list to include resolved
  // incidents. Modelling it as one would invert its meaning, so it rides in the
  // bar's `children` slot and keeps its own state.
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
    statusFilter === undefined
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
      invalidateSystemHealth();
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
      invalidateSystemHealth();
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
      invalidateSystemHealth();
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
      invalidateSystemHealth();
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

  const columns: DataTableColumn<IncidentWithSystems>[] = [
    {
      id: "select",
      headClassName: "w-8",
      header: "",
      cellClassName: "pr-0",
      cell: (incident) =>
        canAccess(incident.id) ? (
          <Checkbox
            checked={selectedIds.has(incident.id)}
            onCheckedChange={() => toggleOne(incident.id)}
            aria-label={`Select incident ${incident.title}`}
          />
        ) : null,
    },
    {
      id: "severity-dot",
      headClassName: "w-6",
      header: "",
      cellClassName: "pr-0",
      cell: (incident) => (
        // Severity lead: scannable by hue + position.
        <span
          className={cn(
            "block size-2.5 rounded-full",
            getIncidentSeverityAccentClass(incident.severity),
          )}
          aria-hidden
        />
      ),
    },
    {
      id: "title",
      header: "Title",
      sortValue: (incident) => incident.title,
      cell: (incident) => (
        <div>
          <p className="text-sm font-semibold text-foreground">
            {incident.title}
          </p>
          {incident.description && (
            <p className="text-xs text-muted-foreground truncate max-w-xs">
              {incident.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "severity",
      header: "Severity",
      sortValue: (incident) => incidentSeverityRank[incident.severity],
      cell: (incident) => getIncidentSeverityBadge(incident.severity),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (incident) => incidentStatusRank[incident.status],
      filterValue: (incident) => incident.status,
      filterOptions: INCIDENT_STATUS_OPTIONS,
      filterAnyLabel: "All statuses",
      cell: (incident) => getIncidentStatusBadge(incident.status),
    },
    {
      id: "systems",
      header: "Systems",
      cellClassName: "text-sm text-muted-foreground",
      cell: (incident) => getSystemNames(incident.systemIds),
    },
    {
      id: "duration",
      header: "Duration",
      sortValue: (incident) => new Date(incident.createdAt).getTime(),
      cell: (incident) => (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span className="tabular-nums">
            {formatDistanceToNow(new Date(incident.createdAt), {
              addSuffix: false,
            })}
          </span>
        </div>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-32",
      cell: (incident) => (
        <RowActions>
          {canAccess(incident.id) && (
            <RowAction
              icon={Edit2}
              label={`Edit ${incident.title}`}
              onClick={() => handleEdit(incident)}
            />
          )}
          {canAccess(incident.id) &&
            canResolveIncident({ status: incident.status }) && (
              <RowAction
                icon={CheckCircle2}
                label={`Resolve ${incident.title}`}
                tone="success"
                onClick={() => setResolveId(incident.id)}
              />
            )}
          {canAccess(incident.id) && (
            <RowAction
              icon={Trash2}
              label={`Delete ${incident.title}`}
              tone="destructive"
              onClick={() => setDeleteId(incident.id)}
            />
          )}
        </RowActions>
      ),
    },
  ];

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

      {loading ? (
        <div className="flex justify-center p-12">
          <LoadingSpinner />
        </div>
      ) : incidentsQuery.isError ? (
        <QueryErrorState
          error={incidentsQuery.error}
          onRetry={() => void incidentsQuery.refetch()}
          resource="incidents"
        />
      ) : (
        <>
          {selectableIds.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-inset/60 px-4 py-2">
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

          <DataTable
            data={incidents}
            columns={columns}
            getRowId={(incident) => incident.id}
            // The Status column declares its own filter, so the control sits in
            // the table's bar rather than floating above the card.
            filters={filters.state}
            onFiltersChange={filters.setState}
            onClearFilters={filters.clear}
            // "Show resolved" is not a facet: a facet NARROWS, and this WIDENS
            // the list to include rows the endpoint excludes by default. It
            // still belongs BESIDE the status control, not pushed to the far
            // side of the row where `toolbar` puts its actions.
            filterExtras={
              <label className="flex items-center gap-2 whitespace-nowrap text-sm">
                <Checkbox
                  checked={showResolved}
                  onCheckedChange={(checked) => setShowResolved(checked === true)}
                />
                Show resolved
              </label>
            }
            // Incidents are found by status and recency, not by typing a title.
            searchable={false}
            getRowProps={(incident) => ({
              selected: selectedIds.has(incident.id),
              className: "hover:bg-surface-inset",
            })}
            // The list arrives already narrowed by the server, so an empty
            // `data` means either "none exist" or "none match". Suppressing
            // `emptyState` while a filter is active is what tells them apart.
            emptyState={
              filters.active ? undefined : (
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
              )
            }
            noResultsState={
              <EmptyState
                icon={<AlertTriangle className="size-10" />}
                title="No incidents match your filters"
                description="Nothing in this list matches the current status filter. Resolved incidents are hidden unless you ask for them."
                actions={
                  <Button variant="outline" onClick={filters.clear}>
                    Clear filters
                  </Button>
                }
              />
            }
            renderMobileCard={(i) => (
              <div
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
                  <RowActions className="mt-3">
                    {canAccess(i.id) && (
                      <RowAction
                        icon={Edit2}
                        label={`Edit ${i.title}`}
                        onClick={() => handleEdit(i)}
                      />
                    )}
                    {canAccess(i.id) &&
                      canResolveIncident({ status: i.status }) && (
                        <RowAction
                          icon={CheckCircle2}
                          label={`Resolve ${i.title}`}
                          tone="success"
                          onClick={() => setResolveId(i.id)}
                        />
                      )}
                    {canAccess(i.id) && (
                      <RowAction
                        icon={Trash2}
                        label={`Delete ${i.title}`}
                        tone="destructive"
                        onClick={() => setDeleteId(i.id)}
                      />
                    )}
                  </RowActions>
                </div>
              </div>
            )}
          />
        </>
      )}

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
