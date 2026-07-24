import React from "react";
import {
  Pagination,
  Spinner,
  Card,
  DataTable,
  type DataTableColumn,
  type DataTableFacetControl,
  type DataTableFilterState,
  useKeptPrevious,
  cn,
} from "@checkstack/ui";
import { formatDistanceToNow, format } from "date-fns";
import { ExternalLink, Satellite, Server, Layers } from "lucide-react";
import { HealthStatusPill } from "./HealthStatusPill";
import {
  statusToLabel,
  statusToTone,
  toneStyles,
} from "./healthcheckDisplay.logic";

/**
 * Stacks the absolute datetime (primary line) over the relative "x ago" string
 * (muted, secondary) so the exact time is visible at a glance instead of hidden
 * behind a hover tooltip. The full-precision timestamp stays on `title` for the
 * seconds/timezone detail.
 */
export const RunTimestamp: React.FC<{
  timestamp: Date;
  align?: "start" | "end";
}> = ({ timestamp, align = "start" }) => {
  const date = new Date(timestamp);
  return (
    <span
      className={cn(
        "flex flex-col leading-tight",
        align === "end" ? "items-end" : "items-start",
      )}
      title={format(date, "PPpp")}
    >
      <span className="tabular-nums text-foreground">{format(date, "PPp")}</span>
      <span className="text-xs text-muted-foreground">
        {formatDistanceToNow(date, { addSuffix: true })}
      </span>
    </span>
  );
};

/** Neutral metadata chip on surface tokens; the table's signal hue is reserved
 * for the remote/satellite source so the data reads consistently. */
const NEUTRAL_CHIP =
  "inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface-inset px-1.5 py-0.5 text-xs text-muted-foreground";
const SIGNAL_CHIP =
  "inline-flex items-center gap-1 rounded-full bg-status-warn/10 px-1.5 py-0.5 text-xs text-status-warn";

export const RunEnvironmentChip: React.FC<{
  environmentId?: string;
  label?: string;
}> = ({ environmentId, label }) => {
  // `label` is resolved by the caller against the FULL environment list, so an
  // absent one means the environment was deleted - see
  // `resolveRunEnvironmentLabel` for why those two cases must stay distinct.
  if (!environmentId) {
    return <span className="text-xs text-muted-foreground">None</span>;
  }
  return (
    <span className={NEUTRAL_CHIP}>
      <Layers className="h-3 w-3" />
      {label ?? "Removed environment"}
    </span>
  );
};

export const RunSourceChip: React.FC<{
  sourceId?: string;
  sourceLabel?: string;
}> = ({ sourceId, sourceLabel }) =>
  sourceId ? (
    <span className={SIGNAL_CHIP}>
      <Satellite className="h-3 w-3" />
      {sourceLabel ?? "Remote"}
    </span>
  ) : (
    <span className={NEUTRAL_CHIP}>
      <Server className="h-3 w-3" />
      {sourceLabel ?? "Local"}
    </span>
  );

export interface HealthCheckRunDetailed {
  id: string;
  configurationId: string;
  systemId: string;
  status: "healthy" | "unhealthy" | "degraded";
  /**
   * Full run result. Optional: list endpoints (e.g. the drawer's public
   * history) omit it; the table never reads it, and detail views fetch the
   * full run via `getRunById`.
   */
  result?: Record<string, unknown>;
  timestamp: Date;
  /**
   * Environment this run executed for (per-environment fan-out). undefined =
   * env-less run (opt-out / no membership).
   */
  environmentId?: string;
  /** Source ID for result attribution (undefined = local core, UUID = satellite) */
  sourceId?: string;
  /** Human-readable source label (e.g. "Local" or "EU West (eu-west-1)") */
  sourceLabel?: string;
}

export interface EnvironmentLabel {
  id: string;
  name: string;
}

export interface HealthCheckRunsTableProps {
  runs: HealthCheckRunDetailed[];
  loading: boolean;
  emptyMessage?: string;
  /**
   * id -> name map for the Environment column, covering EVERY environment in
   * the instance (see `useEnvironmentLabels`) - not just those currently
   * assigned to a system.
   *
   * REQUIRED, and deliberately so: an id that is absent from this list is
   * rendered as "Removed environment", a claim that is only sound when the full
   * list was actually supplied. While the prop was optional, a page that simply
   * forgot it labelled every live environment as removed - a failure that lies
   * rather than degrading visibly. Pass `[]` only if you genuinely mean "no
   * environments exist".
   */
  environmentLabels: EnvironmentLabel[];
  /** Show System ID and Configuration ID columns with link to detail page */
  showFilterColumns?: boolean;
  /** Number of columns for the expanded result row */
  colSpan?: number;
  /**
   * Selection callback. When absent, rows are non-interactive (no pointer,
   * no keyboard affordance). Navigation is the CALLER's concern.
   */
  onRowSelect?: (run: HealthCheckRunDetailed) => void;
  /** The currently selected run, highlighted with an accent stripe. */
  selectedRunId?: string;
  /** Pagination state from usePagination hook */
  pagination?: {
    page: number;
    totalPages: number;
    total: number;
    limit: number;
    setPage: (page: number) => void;
    setLimit: (limit: number) => void;
  };
  /**
   * Controlled filter state for the status/source controls. Both narrow the
   * HISTORY QUERY rather than these rows, so the caller applies them - the table
   * only renders the controls, keeping them attached to the list they filter.
   */
  filters?: DataTableFilterState;
  onFiltersChange?: (next: DataTableFilterState) => void;
  onClearFilters?: () => void;
  facets?: ReadonlyArray<DataTableFacetControl>;
}

/** Keyboard activation for row-as-button semantics (Enter / Space). */
function rowKeyHandler(
  onActivate: () => void,
): (event: React.KeyboardEvent) => void {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate();
  };
}

export const HealthCheckRunsTable: React.FC<HealthCheckRunsTableProps> = ({
  runs,
  loading,
  emptyMessage = "No health check runs found.",
  environmentLabels,
  showFilterColumns = false,
  onRowSelect,
  selectedRunId,
  pagination,
  filters,
  onFiltersChange,
  onClearFilters,
  facets,
}) => {
  const envNameById = new Map(
    environmentLabels.map((e) => [e.id, e.name]),
  );

  // Keep previous runs during a refetch to prevent layout shift, and dim them
  // while stale (see useKeptPrevious).
  const { data: displayRuns, isStale } = useKeptPrevious({
    data: runs,
    isFetching: loading,
  });

  const interactive = onRowSelect !== undefined;

  // The runs are server-paginated (sortOrder: "desc"), so no column carries a
  // `sortValue` - a client-side sort would only reorder the visible page. The
  // table stays in the order the API returned.
  const idColumns: DataTableColumn<HealthCheckRunDetailed>[] = showFilterColumns
    ? [
        {
          id: "systemId",
          header: "System ID",
          cellClassName: "font-mono text-xs",
          cell: (run) => run.systemId,
        },
        {
          id: "configurationId",
          header: "Configuration ID",
          cellClassName: "font-mono text-xs",
          cell: (run) => `${run.configurationId.slice(0, 8)}...`,
        },
      ]
    : [];

  const linkColumn: DataTableColumn<HealthCheckRunDetailed>[] = showFilterColumns
    ? [
        {
          id: "link",
          header: "",
          headClassName: "w-16",
          cell: () => (
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          ),
        },
      ]
    : [];

  const columns: DataTableColumn<HealthCheckRunDetailed>[] = [
    {
      id: "status",
      header: (
        <span className="flex items-center gap-2">
          Status
          {loading && <Spinner size="sm" className="h-3 w-3" />}
        </span>
      ),
      headClassName: "w-24",
      cellClassName: "relative",
      cell: (run) => {
        const tone = statusToTone({ status: run.status });
        const selected = run.id === selectedRunId;
        return (
          <>
            {selected && (
              <span
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  toneStyles[tone].accent,
                )}
                aria-hidden
              />
            )}
            <HealthStatusPill
              tone={tone}
              label={statusToLabel({ status: run.status })}
            />
          </>
        );
      },
    },
    ...idColumns,
    {
      id: "timestamp",
      header: "Timestamp",
      cellClassName: "text-sm text-muted-foreground",
      cell: (run) => <RunTimestamp timestamp={run.timestamp} />,
    },
    {
      id: "environment",
      header: "Environment",
      cell: (run) => (
        <RunEnvironmentChip
          environmentId={run.environmentId}
          label={
            run.environmentId ? envNameById.get(run.environmentId) : undefined
          }
        />
      ),
    },
    {
      id: "source",
      header: "Source",
      cell: (run) => (
        <RunSourceChip sourceId={run.sourceId} sourceLabel={run.sourceLabel} />
      ),
    },
    ...linkColumn,
  ];

  return (
    <>
      <DataTable
        data={displayRuns}
        columns={columns}
        getRowId={(run) => run.id}
        // Status and source are applied SERVER-side (they narrow the history
        // query, and "failing" collapses degraded+unhealthy, which no single row
        // value expresses), so they arrive as controls with no row accessor -
        // rendered in the table's own bar, applied by the caller.
        facets={facets}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onClearFilters={onClearFilters}
        searchable={false}
        getRowProps={(run) => {
          const selected = run.id === selectedRunId;
          if (!interactive) {
            return {
              className: cn(
                selected && "bg-surface-inset",
                isStale && "opacity-50",
              ),
            };
          }
          return {
            className: cn(
              "cursor-pointer transition-colors hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              selected && "bg-surface-inset",
              isStale && "opacity-50",
            ),
            role: "button",
            tabIndex: 0,
            "aria-current": selected ? "true" : undefined,
            onClick: () => onRowSelect(run),
            onKeyDown: rowKeyHandler(() => onRowSelect(run)),
          };
        }}
        emptyState={
          // Only surface the empty message once loading settles; during the
          // initial load the table shows just its header (no empty flash).
          loading ? undefined : (
            <Card className="p-6 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </Card>
          )
        }
        renderMobileCard={(run) => {
          const tone = statusToTone({ status: run.status });
          const selected = run.id === selectedRunId;
          return (
            <div
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
                interactive &&
                  "cursor-pointer transition-colors hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "bg-surface-inset",
                isStale && "opacity-50",
              )}
              onClick={interactive ? () => onRowSelect(run) : undefined}
              onKeyDown={
                interactive ? rowKeyHandler(() => onRowSelect(run)) : undefined
              }
            >
              {/* Status accent stripe keyed to run status. */}
              <span
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  toneStyles[tone].accent,
                )}
                aria-hidden
              />
              <div className="flex items-start justify-between gap-2 pl-2">
                <HealthStatusPill
                  tone={tone}
                  label={statusToLabel({ status: run.status })}
                />
                <span className="text-xs text-muted-foreground">
                  <RunTimestamp timestamp={run.timestamp} align="end" />
                </span>
              </div>
              {showFilterColumns && (
                <div className="mt-2 break-all pl-2 font-mono text-xs text-muted-foreground">
                  {run.systemId} / {run.configurationId.slice(0, 8)}...
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-2">
                <RunEnvironmentChip
                  environmentId={run.environmentId}
                  label={
                    run.environmentId
                      ? envNameById.get(run.environmentId)
                      : undefined
                  }
                />
                <RunSourceChip
                  sourceId={run.sourceId}
                  sourceLabel={run.sourceLabel}
                />
              </div>
            </div>
          );
        }}
      />
      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={pagination.setPage}
            total={pagination.total}
            limit={pagination.limit}
            onPageSizeChange={pagination.setLimit}
            showTotal
            showPageSize
          />
        </div>
      )}
    </>
  );
};
