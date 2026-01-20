import React, { useState, useCallback } from "react";
import {
  ExtensionSlot,
  usePluginClient,
  type SlotContext,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import {
  HEALTH_CHECK_RUN_COMPLETED,
  HealthCheckApi,
} from "@checkstack/healthcheck-common";
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
  usePaginationSync,
  DateRangeFilter,
  getPresetRange,
  DateRangePreset,
} from "@checkstack/ui";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { HealthCheckSparkline } from "./HealthCheckSparkline";
import { HealthCheckLatencyChart } from "./HealthCheckLatencyChart";
import { HealthCheckStatusTimeline } from "./HealthCheckStatusTimeline";
import { useHealthCheckData } from "../hooks/useHealthCheckData";

import type {
  StateThresholds,
  HealthCheckStatus,
} from "@checkstack/healthcheck-common";
import { AggregatedDataBanner } from "./AggregatedDataBanner";
import { HealthCheckDiagramSlot } from "../slots";

type SlotProps = SlotContext<typeof SystemDetailsSlot>;

interface HealthCheckOverviewItem {
  configurationId: string;
  strategyId: string;
  name: string;
  state: HealthCheckStatus;
  intervalSeconds: number;
  lastRunAt?: Date;
  stateThresholds?: StateThresholds;
  recentStatusHistory: HealthCheckStatus[];
}

interface ExpandedRowProps {
  item: HealthCheckOverviewItem;
  systemId: string;
}

const ExpandedDetails: React.FC<ExpandedRowProps> = ({ item, systemId }) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);

  // Date range state for filtering - default to last 24 hours
  const [dateRange, setDateRange] = useState(() =>
    getPresetRange(DateRangePreset.Last24Hours),
  );

  // Use shared hook for chart data - handles both raw and aggregated modes
  // and includes signal handling for automatic refresh
  const {
    context: chartContext,
    loading: chartLoading,
    isAggregated,
    bucketIntervalSeconds,
  } = useHealthCheckData({
    systemId,
    configurationId: item.configurationId,
    strategyId: item.strategyId,
    dateRange,
    limit: 1000,
  });

  // Pagination state for history table
  const pagination = usePagination({ defaultLimit: 10 });

  // Fetch paginated history with useQuery
  const {
    data: historyData,
    isLoading: loading,
    refetch,
  } = healthCheckClient.getHistory.useQuery({
    systemId,
    configurationId: item.configurationId,
    limit: pagination.limit,
    offset: pagination.offset,
    startDate: dateRange.startDate,
    // Don't pass endDate - backend defaults to 'now' so new runs are included
  });

  // Sync total from response
  usePaginationSync(pagination, historyData?.total);

  const runs = historyData?.runs ?? [];

  // Listen for realtime health check updates to refresh history table
  // Charts are refreshed automatically by useHealthCheckData
  useSignal(HEALTH_CHECK_RUN_COMPLETED, ({ systemId: changedId }) => {
    if (changedId === systemId) {
      void refetch();
    }
  });

  const thresholdDescription = item.stateThresholds
    ? item.stateThresholds.mode === "consecutive"
      ? `Consecutive mode: Healthy after ${item.stateThresholds.healthy.minSuccessCount} success(es), Degraded after ${item.stateThresholds.degraded.minFailureCount} failure(s), Unhealthy after ${item.stateThresholds.unhealthy.minFailureCount} failure(s)`
      : `Window mode (${item.stateThresholds.windowSize} runs): Degraded at ${item.stateThresholds.degraded.minFailureCount}+ failures, Unhealthy at ${item.stateThresholds.unhealthy.minFailureCount}+ failures`
    : "Using default thresholds";

  // Render charts - charts handle data transformation internally
  const renderCharts = () => {
    if (chartLoading) {
      return <LoadingSpinner />;
    }

    if (!chartContext) {
      return;
    }

    // Check if we have data to show
    const hasData =
      chartContext.type === "raw"
        ? chartContext.runs.length > 0
        : chartContext.buckets.length > 0;

    if (!hasData) {
      return;
    }

    return (
      <div className="space-y-4">
        {isAggregated && bucketIntervalSeconds && (
          <AggregatedDataBanner
            bucketIntervalSeconds={bucketIntervalSeconds}
            checkIntervalSeconds={item.intervalSeconds}
          />
        )}
        {/* Status Timeline */}
        <div>
          <h4 className="text-sm font-medium mb-2">Status Timeline</h4>
          <HealthCheckStatusTimeline context={chartContext} height={50} />
        </div>
        {/* Execution Duration Chart */}
        <div>
          <h4 className="text-sm font-medium mb-2">Execution Duration</h4>
          <HealthCheckLatencyChart
            context={chartContext}
            height={150}
            showAverage
          />
        </div>
        {/* Extension Slot for custom strategy-specific diagrams */}
        <ExtensionSlot slot={HealthCheckDiagramSlot} context={chartContext} />
      </div>
    );
  };

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

      {/* Date Range Filter */}
      <DateRangeFilter value={dateRange} onChange={setDateRange} />

      {/* Charts Section */}
      {renderCharts()}

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
                    <TableCell className="text-muted-foreground">
                      {formatDistanceToNow(new Date(run.timestamp), {
                        addSuffix: true,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={pagination.setPage}
            total={pagination.total}
            limit={pagination.limit}
            onPageSizeChange={pagination.setLimit}
            showPageSize
            showTotal
          />
        </>
      ) : (
        <div className="text-center text-muted-foreground py-4">
          No runs recorded yet
        </div>
      )}
    </div>
  );
};

export function HealthCheckSystemOverview(props: SlotProps) {
  const systemId = props.system.id;
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const [expandedRow, setExpandedRow] = React.useState<string | undefined>();

  // Fetch health check overview using useQuery
  const {
    data: overviewData,
    isLoading: initialLoading,
    refetch,
  } = healthCheckClient.getSystemHealthOverview.useQuery({
    systemId,
  });

  // Transform API response to component format
  const overview: HealthCheckOverviewItem[] = React.useMemo(() => {
    if (!overviewData) return [];
    return overviewData.checks.map((check) => ({
      configurationId: check.configurationId,
      strategyId: check.strategyId,
      name: check.configurationName,
      state: check.status,
      intervalSeconds: check.intervalSeconds,
      lastRunAt: check.recentRuns[0]?.timestamp
        ? new Date(check.recentRuns[0].timestamp)
        : undefined,
      stateThresholds: check.stateThresholds,
      recentStatusHistory: check.recentRuns.map((r) => r.status),
    }));
  }, [overviewData]);

  // Listen for realtime health check updates to refresh overview
  useSignal(
    HEALTH_CHECK_RUN_COMPLETED,
    useCallback(
      ({ systemId: changedId }) => {
        if (changedId === systemId) {
          void refetch();
        }
      },
      [systemId, refetch],
    ),
  );

  if (initialLoading) {
    return <LoadingSpinner />;
  }

  if (overview.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4">
        No health checks configured
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {overview.map((item) => {
        const isExpanded = expandedRow === item.configurationId;

        return (
          <div key={item.configurationId} className="rounded-md border bg-card">
            <button
              className="w-full p-4 text-left hover:bg-muted/50 transition-colors"
              onClick={() =>
                setExpandedRow(isExpanded ? undefined : item.configurationId)
              }
            >
              {/* Header row: chevron, name, badge */}
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{item.name}</span>
                  <HealthBadge status={item.state} />
                </div>
              </div>
              {/* Details row: last run + sparkline */}
              <div className="ml-7 mt-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  Last run:{" "}
                  {item.lastRunAt
                    ? formatDistanceToNow(item.lastRunAt, { addSuffix: true })
                    : "never"}
                </span>
                {item.recentStatusHistory.length > 0 && (
                  <HealthCheckSparkline
                    runs={item.recentStatusHistory.map((status) => ({
                      status,
                    }))}
                  />
                )}
              </div>
            </button>
            {isExpanded && <ExpandedDetails item={item} systemId={systemId} />}
          </div>
        );
      })}
    </div>
  );
}
