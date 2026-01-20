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
} from "@checkstack/ui";
import { formatDistanceToNow, format } from "date-fns";
import { ExternalLink, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { healthcheckRoutes } from "@checkstack/healthcheck-common";
import { resolveRoute } from "@checkstack/common";

export interface HealthCheckRunDetailed {
  id: string;
  configurationId: string;
  systemId: string;
  status: "healthy" | "unhealthy" | "degraded";
  result: Record<string, unknown>;
  timestamp: Date;
}

export interface HealthCheckRunsTableProps {
  runs: HealthCheckRunDetailed[];
  loading: boolean;
  emptyMessage?: string;
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
  showFilterColumns = false,
  pagination,
}) => {
  const navigate = useNavigate();
  const prevRunsRef = useRef(runs);

  // Keep previous runs during loading to prevent layout shift
  const displayRuns =
    loading && prevRunsRef.current.length > 0 ? prevRunsRef.current : runs;
  if (!loading && runs.length > 0) {
    prevRunsRef.current = runs;
  }

  if (!loading && runs.length === 0 && prevRunsRef.current.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
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

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">
                <span className="flex items-center gap-2">
                  Status
                  {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                </span>
              </TableHead>
              {showFilterColumns && (
                <>
                  <TableHead>System ID</TableHead>
                  <TableHead>Configuration ID</TableHead>
                </>
              )}
              <TableHead>Timestamp</TableHead>
              {showFilterColumns && <TableHead className="w-16"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
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
