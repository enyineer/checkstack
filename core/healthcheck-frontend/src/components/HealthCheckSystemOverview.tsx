import React, { useEffect, useState, useCallback } from "react";
import {
  useApi,
  type SlotContext,
  permissionApiRef,
} from "@checkmate/frontend-api";
import { useSignal } from "@checkmate/signal-frontend";
import { healthCheckApiRef } from "../api";
import { SystemDetailsSlot } from "@checkmate/catalog-common";
import {
  HEALTH_CHECK_STATE_CHANGED,
  permissions,
} from "@checkmate/healthcheck-common";
import {
  HealthBadge,
  LoadingSpinner,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Tooltip,
  Pagination,
  usePagination,
  HealthCheckLatencyChart,
  HealthCheckStatusTimeline,
  DateRangeFilter,
  Button,
} from "@checkmate/ui";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight, Settings } from "lucide-react";
import { HealthCheckSparkline } from "./HealthCheckSparkline";
import { RetentionConfigDialog } from "./RetentionConfigDialog";
import type {
  StateThresholds,
  HealthCheckStatus,
} from "@checkmate/healthcheck-common";
import { HealthCheckDiagram } from "./HealthCheckDiagram";

type SlotProps = SlotContext<typeof SystemDetailsSlot>;

interface HealthCheckOverviewItem {
  configurationId: string;
  configurationName: string;
  strategyId: string;
  intervalSeconds: number;
  enabled: boolean;
  status: HealthCheckStatus;
  stateThresholds?: StateThresholds;
  recentRuns: Array<{
    id: string;
    status: HealthCheckStatus;
    timestamp: Date;
  }>;
}

interface ExpandedRowProps {
  item: HealthCheckOverviewItem;
  systemId: string;
}

const ExpandedDetails: React.FC<ExpandedRowProps> = ({ item, systemId }) => {
  const api = useApi(healthCheckApiRef);
  const permissionApi = useApi(permissionApiRef);

  // Check if user has permission to manage health checks (for retention config)
  const { allowed: canManage } = permissionApi.usePermission(
    permissions.healthCheckManage.id
  );

  // Retention config dialog state
  const [retentionDialogOpen, setRetentionDialogOpen] = useState(false);

  // Date range state for filtering
  const [dateRange, setDateRange] = useState<{
    startDate: Date;
    endDate: Date;
  }>(() => {
    // Default to last 24 hours
    const end = new Date();
    const start = new Date();
    start.setHours(start.getHours() - 24);
    return { startDate: start, endDate: end };
  });

  // usePagination now uses refs internally - no memoization needed
  const {
    items: runs,
    loading,
    pagination,
  } = usePagination({
    fetchFn: (params: {
      limit: number;
      offset: number;
      systemId: string;
      configurationId: string;
      startDate?: Date;
      endDate?: Date;
    }) =>
      api.getHistory({
        systemId: params.systemId,
        configurationId: params.configurationId,
        limit: params.limit,
        offset: params.offset,
        startDate: params.startDate,
        endDate: params.endDate,
      }),
    getItems: (response) => response.runs,
    getTotal: (response) => response.total,
    extraParams: {
      systemId,
      configurationId: item.configurationId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    },
    defaultLimit: 10,
  });

  const thresholdDescription = item.stateThresholds
    ? item.stateThresholds.mode === "consecutive"
      ? `Consecutive mode: Healthy after ${item.stateThresholds.healthy.minSuccessCount} success(es), Degraded after ${item.stateThresholds.degraded.minFailureCount} failure(s), Unhealthy after ${item.stateThresholds.unhealthy.minFailureCount} failure(s)`
      : `Window mode (${item.stateThresholds.windowSize} runs): Degraded at ${item.stateThresholds.degraded.minFailureCount}+ failures, Unhealthy at ${item.stateThresholds.unhealthy.minFailureCount}+ failures`
    : "Using default thresholds";

  return (
    <div className="p-4 bg-muted/30 border-t space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Strategy:</span>{" "}
          <span className="font-medium">{item.strategyId}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Interval:</span>{" "}
          <span className="font-medium">{item.intervalSeconds}s</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Thresholds:</span>{" "}
          <Tooltip content={thresholdDescription} />
        </div>
      </div>

      {/* Date Range Filter and Actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Time Range:</span>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRetentionDialogOpen(true)}
          >
            <Settings className="h-4 w-4 mr-1" />
            Retention
          </Button>
        )}
      </div>

      {/* Retention Config Dialog */}
      <RetentionConfigDialog
        systemId={systemId}
        configurationId={item.configurationId}
        configurationName={item.configurationName}
        open={retentionDialogOpen}
        onOpenChange={setRetentionDialogOpen}
      />

      {/* Charts Section - always render if we have run data */}
      {runs.length > 0 && (
        <div className="space-y-4">
          {/* Status Timeline */}
          <div>
            <h4 className="text-sm font-medium mb-2">Status Timeline</h4>
            <HealthCheckStatusTimeline
              data={runs.map((r) => ({
                timestamp: new Date(r.timestamp),
                status: r.status,
              }))}
              height={50}
            />
          </div>

          {/* Latency Chart - only if any run has latency data */}
          {runs.some((r) => r.latencyMs !== undefined) && (
            <div>
              <h4 className="text-sm font-medium mb-2">Response Latency</h4>
              <HealthCheckLatencyChart
                data={runs
                  .filter((r) => r.latencyMs !== undefined)
                  .map((r) => ({
                    timestamp: new Date(r.timestamp),
                    latencyMs: r.latencyMs!,
                    status: r.status,
                  }))}
                height={150}
                showAverage
              />
            </div>
          )}

          {/* Extension Slot for custom strategy-specific diagrams */}
          <HealthCheckDiagram
            systemId={systemId}
            configurationId={item.configurationId}
            strategyId={item.strategyId}
            dateRange={dateRange}
            limit={pagination.limit}
            offset={pagination.page * pagination.limit - pagination.limit}
          />
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : runs.length > 0 ? (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <HealthBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(run.timestamp), {
                        addSuffix: true,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pagination.totalPages > 1 && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={pagination.setPage}
              total={pagination.total}
              limit={pagination.limit}
              onPageSizeChange={pagination.setLimit}
              showTotal
            />
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground italic">No runs yet</p>
      )}
    </div>
  );
};

export const HealthCheckSystemOverview: React.FC<SlotProps> = (props) => {
  const { system } = props;
  const systemId = system?.id;

  const api = useApi(healthCheckApiRef);
  const [overview, setOverview] = useState<HealthCheckOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string>();

  const refetch = useCallback(() => {
    if (!systemId) return;

    api
      .getSystemHealthOverview({ systemId })
      .then((data) => setOverview(data.checks))
      .finally(() => setLoading(false));
  }, [api, systemId]);

  // Initial fetch
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Listen for realtime health check updates
  useSignal(HEALTH_CHECK_STATE_CHANGED, ({ systemId: changedId }) => {
    if (changedId === systemId) {
      refetch();
    }
  });

  if (loading) return <LoadingSpinner />;

  if (overview.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No health checks assigned to this system.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {overview.map((item) => {
        const isExpanded = expandedId === item.configurationId;
        const lastRun = item.recentRuns[0];

        return (
          <div
            key={item.configurationId}
            className="rounded-lg border bg-card transition-shadow hover:shadow-sm"
          >
            <div
              className="flex items-center gap-4 p-3 cursor-pointer"
              onClick={() =>
                setExpandedId(isExpanded ? undefined : item.configurationId)
              }
            >
              <div className="text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {item.configurationName}
                  </span>
                  {!item.enabled && (
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Disabled
                    </span>
                  )}
                </div>
                {lastRun && (
                  <span className="text-xs text-muted-foreground">
                    Last run:{" "}
                    {formatDistanceToNow(new Date(lastRun.timestamp), {
                      addSuffix: true,
                    })}
                  </span>
                )}
              </div>

              <HealthCheckSparkline
                runs={item.recentRuns}
                className="hidden sm:flex"
              />

              <HealthBadge status={item.status} />
            </div>

            {isExpanded && systemId && (
              <ExpandedDetails item={item} systemId={systemId} />
            )}
          </div>
        );
      })}
    </div>
  );
};
