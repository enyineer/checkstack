import React, { useState, Fragment } from "react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  HealthBadge,
  LoadingSpinner,
  Pagination,
  Button,
} from "@checkmate-monitor/ui";
import { formatDistanceToNow, format } from "date-fns";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { healthcheckRoutes } from "@checkmate-monitor/healthcheck-common";
import { resolveRoute } from "@checkmate-monitor/common";

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
  colSpan,
  pagination,
}) => {
  const [expandedId, setExpandedId] = useState<string>();

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? undefined : id);
  };

  // Calculate colspan based on columns shown
  const calculatedColSpan = colSpan ?? (showFilterColumns ? 6 : 3);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (runs.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead className="w-24">Status</TableHead>
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
            {runs.map((run) => {
              const isExpanded = expandedId === run.id;
              return (
                <Fragment key={run.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleExpand(run.id)}
                  >
                    <TableCell>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            to={resolveRoute(
                              healthcheckRoutes.routes.historyDetail,
                              {
                                systemId: run.systemId,
                                configurationId: run.configurationId,
                              }
                            )}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell
                        colSpan={calculatedColSpan}
                        className="bg-muted/30 p-4"
                      >
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium">Result Data</h4>
                          <pre className="text-xs bg-card rounded-md p-3 overflow-auto max-h-64 border">
                            {JSON.stringify(run.result, undefined, 2)}
                          </pre>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
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
