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
} from "@checkstack/ui";
import { formatDistanceToNow, format } from "date-fns";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
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
                        <ExpandedResultView result={run.result} />
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

// =============================================================================
// EXPANDED RESULT VIEW
// =============================================================================

interface ExpandedResultViewProps {
  result: Record<string, unknown>;
}

/**
 * Displays the result data in a structured format.
 * Shows collector results as cards with key-value pairs.
 */
function ExpandedResultView({ result }: ExpandedResultViewProps) {
  const metadata = result.metadata as Record<string, unknown> | undefined;
  const rawCollectors = metadata?.collectors;

  // Type guard for collectors object
  const collectors: Record<string, Record<string, unknown>> | undefined =
    rawCollectors &&
    typeof rawCollectors === "object" &&
    !Array.isArray(rawCollectors)
      ? (rawCollectors as Record<string, Record<string, unknown>>)
      : undefined;

  // Check if we have collectors to display
  const collectorEntries = collectors ? Object.entries(collectors) : [];

  // Extract connection time as typed value
  const connectionTimeMs = metadata?.connectionTimeMs as number | undefined;

  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Status: </span>
          <span className="font-medium">{String(result.status)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Latency: </span>
          <span className="font-medium">{String(result.latencyMs)}ms</span>
        </div>
        {connectionTimeMs !== undefined && (
          <div>
            <span className="text-muted-foreground">Connection: </span>
            <span className="font-medium">{connectionTimeMs}ms</span>
          </div>
        )}
      </div>

      {collectorEntries.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Collector Results</h4>
          <div className="grid gap-3 md:grid-cols-2">
            {collectorEntries.map(([collectorId, collectorResult]) => (
              <CollectorResultCard
                key={collectorId}
                collectorId={collectorId}
                result={collectorResult}
              />
            ))}
          </div>
        </div>
      )}

      {result.message ? (
        <div className="text-sm text-muted-foreground">
          {String(result.message)}
        </div>
      ) : undefined}
    </div>
  );
}

interface CollectorResultCardProps {
  collectorId: string;
  result: Record<string, unknown>;
}

/**
 * Card displaying a single collector's result values.
 */
function CollectorResultCard({
  collectorId,
  result,
}: CollectorResultCardProps) {
  if (!result || typeof result !== "object") {
    return;
  }

  // Filter out null/undefined values
  const entries = Object.entries(result).filter(
    ([, value]) => value !== null && value !== undefined
  );

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <h5 className="text-sm font-medium text-primary">{collectorId}</h5>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <span className="text-muted-foreground truncate">
              {formatKey(key)}
            </span>
            <span className="font-mono text-xs truncate" title={String(value)}>
              {formatValue(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Format a camelCase key to a readable label.
 */
function formatKey(key: string): string {
  return key
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll(/^./, (c) => c.toUpperCase());
}

/**
 * Format a value for display.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (Array.isArray(value)) {
    return value.length > 3
      ? `[${value.slice(0, 3).join(", ")}…]`
      : `[${value.join(", ")}]`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  return str.length > 50 ? `${str.slice(0, 47)}…` : str;
}
