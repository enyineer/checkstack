import React from "react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Pagination,
  Spinner,
  Card,
  ResponsiveTable,
  MobileCardList,
  useKeptPrevious,
  cn,
} from "@checkstack/ui";
import { formatDistanceToNow, format } from "date-fns";
import { ExternalLink, Satellite, Server, Layers } from "lucide-react";
import { EmptyRunsTableRow } from "./EmptyRunsTableRow";
import { HealthStatusPill } from "./HealthStatusPill";
import {
  statusToLabel,
  statusToTone,
  toneStyles,
} from "./healthcheckDisplay.logic";

export const RunTimestamp: React.FC<{ timestamp: Date }> = ({ timestamp }) => (
  <span title={format(new Date(timestamp), "PPpp")}>
    {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
  </span>
);

/** Neutral metadata chip on surface tokens; the table's signal hue is reserved
 * for the remote/satellite source so the data reads consistently. */
const NEUTRAL_CHIP =
  "inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface-inset px-1.5 py-0.5 text-xs text-muted-foreground";
const SIGNAL_CHIP =
  "inline-flex items-center gap-1 rounded-full bg-status-warn/10 px-1.5 py-0.5 text-xs text-status-warn";

export const RunEnvironmentChip: React.FC<{
  environmentId?: string;
  label?: string;
}> = ({ environmentId, label }) =>
  environmentId ? (
    <span className={NEUTRAL_CHIP}>
      <Layers className="h-3 w-3" />
      {label ?? environmentId}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">None</span>
  );

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
   * Optional id -> name map for the Environment column. When a run's
   * `environmentId` is present, its display name is looked up here (falling
   * back to the id). Env-less runs render a muted dash.
   */
  environmentLabels?: EnvironmentLabel[];
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
}) => {
  const envNameById = new Map(
    (environmentLabels ?? []).map((e) => [e.id, e.name]),
  );

  // Keep previous runs during a refetch to prevent layout shift, and dim them
  // while stale (see useKeptPrevious).
  const { data: displayRuns, isStale } = useKeptPrevious({
    data: runs,
    isFetching: loading,
  });

  const interactive = onRowSelect !== undefined;

  // 4 base columns (Status, Timestamp, Environment, Source) + 3 extras when
  // showFilterColumns is on (System ID, Configuration ID, link icon).
  const columnCount = showFilterColumns ? 7 : 4;
  const showEmptyRow = !loading && displayRuns.length === 0;

  return (
    <>
      <ResponsiveTable className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">
                <span className="flex items-center gap-2">
                  Status
                  {loading && (
                    <Spinner size="sm" className="h-3 w-3" />
                  )}
                </span>
              </TableHead>
              {showFilterColumns && (
                <>
                  <TableHead>System ID</TableHead>
                  <TableHead>Configuration ID</TableHead>
                </>
              )}
              <TableHead>Timestamp</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Source</TableHead>
              {showFilterColumns && <TableHead className="w-16"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {showEmptyRow && (
              <EmptyRunsTableRow colSpan={columnCount}>
                {emptyMessage}
              </EmptyRunsTableRow>
            )}
            {displayRuns.map((run) => {
              const tone = statusToTone({ status: run.status });
              const selected = run.id === selectedRunId;
              return (
                <TableRow
                  key={run.id}
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    interactive &&
                      "cursor-pointer transition-colors hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected && "bg-surface-inset",
                    isStale && "opacity-50",
                  )}
                  onClick={interactive ? () => onRowSelect(run) : undefined}
                  onKeyDown={
                    interactive
                      ? rowKeyHandler(() => onRowSelect(run))
                      : undefined
                  }
                >
                  <TableCell className="relative">
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
                  </TableCell>
                  {showFilterColumns && (
                    <>
                      <TableCell className="font-mono text-xs">
                        {run.systemId}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {run.configurationId.slice(0, 8)}...
                      </TableCell>
                    </>
                  )}
                  <TableCell className="text-sm text-muted-foreground">
                    <RunTimestamp timestamp={run.timestamp} />
                  </TableCell>
                  <TableCell>
                    <RunEnvironmentChip
                      environmentId={run.environmentId}
                      label={
                        run.environmentId
                          ? envNameById.get(run.environmentId)
                          : undefined
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <RunSourceChip
                      sourceId={run.sourceId}
                      sourceLabel={run.sourceLabel}
                    />
                  </TableCell>
                  {showFilterColumns && (
                    <TableCell>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ResponsiveTable>

      <MobileCardList>
        {showEmptyRow && (
          <Card className="p-6 text-center text-xs text-muted-foreground">
            {emptyMessage}
          </Card>
        )}
        {displayRuns.map((run) => {
          const tone = statusToTone({ status: run.status });
          const selected = run.id === selectedRunId;
          return (
          <div
            key={run.id}
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
              <span className="text-right text-xs text-muted-foreground">
                <RunTimestamp timestamp={run.timestamp} />
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
        })}
      </MobileCardList>
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
