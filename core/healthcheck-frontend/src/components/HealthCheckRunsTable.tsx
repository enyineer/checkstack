import React, { useRef } from "react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  HealthBadge,
  Pagination,
  Spinner,
} from "@checkstack/ui";
import { formatDistanceToNow, format } from "date-fns";
import { ExternalLink, Satellite, Server, Layers } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { healthcheckRoutes } from "@checkstack/healthcheck-common";
import { resolveRoute } from "@checkstack/common";
import { EmptyRunsTableRow } from "./EmptyRunsTableRow";

export interface HealthCheckRunDetailed {
  id: string;
  configurationId: string;
  systemId: string;
  status: "healthy" | "unhealthy" | "degraded";
  result: Record<string, unknown>;
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

export const HealthCheckRunsTable: React.FC<HealthCheckRunsTableProps> = ({
  runs,
  loading,
  emptyMessage = "No health check runs found.",
  environmentLabels,
  showFilterColumns = false,
  pagination,
}) => {
  const navigate = useNavigate();
  const prevRunsRef = useRef(runs);
  const envNameById = new Map(
    (environmentLabels ?? []).map((e) => [e.id, e.name]),
  );

  // Keep previous runs during loading to prevent layout shift
  const displayRuns =
    loading && prevRunsRef.current.length > 0 ? prevRunsRef.current : runs;
  if (!loading && runs.length > 0) {
    prevRunsRef.current = runs;
  }

  const handleRowClick = (run: HealthCheckRunDetailed) => {
    navigate(
      resolveRoute(healthcheckRoutes.routes.historyRun, {
        systemId: run.systemId,
        configurationId: run.configurationId,
        runId: run.id,
      }),
    );
  };

  // 4 base columns (Status, Timestamp, Environment, Source) + 3 extras when
  // showFilterColumns is on (System ID, Configuration ID, link icon).
  const columnCount = showFilterColumns ? 7 : 4;
  const showEmptyRow = !loading && displayRuns.length === 0;

  return (
    <>
      <div className="rounded-md border">
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
            {displayRuns.map((run) => (
              <TableRow
                key={run.id}
                className={`cursor-pointer hover:bg-muted/50 ${loading ? "opacity-50" : ""}`}
                onClick={() => handleRowClick(run)}
              >
                <TableCell>
                  <HealthBadge status={run.status} />
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
                  <span title={format(new Date(run.timestamp), "PPpp")}>
                    {formatDistanceToNow(new Date(run.timestamp), {
                      addSuffix: true,
                    })}
                  </span>
                </TableCell>
                <TableCell>
                  {run.environmentId ? (
                    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                      <Layers className="h-3 w-3" />
                      {envNameById.get(run.environmentId) ?? run.environmentId}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell>
                  {run.sourceId ? (
                    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600">
                      <Satellite className="h-3 w-3" />
                      {run.sourceLabel ?? "Remote"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      <Server className="h-3 w-3" />
                      {run.sourceLabel ?? "Local"}
                    </span>
                  )}
                </TableCell>
                {showFilterColumns && (
                  <TableCell>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
