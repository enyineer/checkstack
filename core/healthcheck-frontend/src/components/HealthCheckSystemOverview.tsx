import React, { useState, useCallback, useRef } from "react";
import { Loader2 } from "lucide-react";
import {
  ExtensionSlot,
  usePluginClient,
  useApi,
  accessApiRef,
  type SlotContext,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import {
  HEALTH_CHECK_RUN_COMPLETED,
  HealthCheckApi,
  healthCheckAccess,
  healthcheckRoutes,
} from "@checkstack/healthcheck-common";
import { resolveRoute } from "@checkstack/common";
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@checkstack/ui";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

// Helper to format availability percentage with color
const formatAvailability = (
  value: number | null,
  totalRuns: number,
): { text: string; className: string } => {
  if (value === null || totalRuns === 0) {
    return { text: "N/A", className: "text-muted-foreground" };
  }
  const formatted = value.toFixed(2) + "%";
  if (value >= 99.9) {
    return {
      text: formatted,
      className: "text-green-600 dark:text-green-400",
    };
  }
  if (value >= 99) {
    return {
      text: formatted,
      className: "text-yellow-600 dark:text-yellow-400",
    };
  }
  return { text: formatted, className: "text-red-600 dark:text-red-400" };
};

const ExpandedDetails: React.FC<ExpandedRowProps> = ({ item, systemId }) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const navigate = useNavigate();
  const accessApi = useApi(accessApiRef);
  const { allowed: canViewDetails } = accessApi.useAccess(
    healthCheckAccess.details,
  );

  // Date range state for filtering - default to last 24 hours
  const [dateRange, setDateRange] = useState(() =>
    getPresetRange(DateRangePreset.Last24Hours),
  );
  // Track if a rolling preset is active (vs custom range)
  const [isRollingPreset, setIsRollingPreset] = useState(true);

  // Callback to handle date range changes from the filter
  const handleDateRangeChange = useCallback(
    (newRange: { startDate: Date; endDate: Date }) => {
      setDateRange(newRange);
      // Check if this is a rolling preset by comparing endDate to now (within 1 minute)
      const isNearNow =
        Math.abs(newRange.endDate.getTime() - Date.now()) < 60_000;
      setIsRollingPreset(isNearNow);
      // Clear any pending custom range when preset is selected
      setPendingCustomRange(undefined);
    },
    [],
  );

  // Local state for custom date picker - only applied when user clicks Apply
  const [pendingCustomRange, setPendingCustomRange] = useState<
    | {
        startDate: Date;
        endDate: Date;
      }
    | undefined
  >();

  // Handle custom date changes - store locally until Apply
  const handleCustomDateChange = useCallback(
    (newRange: { startDate: Date; endDate: Date }) => {
      setPendingCustomRange(newRange);
    },
    [],
  );

  // Apply pending custom range
  const handleApplyCustomRange = useCallback(() => {
    if (pendingCustomRange) {
      setDateRange(pendingCustomRange);
      setIsRollingPreset(false);
      setPendingCustomRange(undefined);
    }
  }, [pendingCustomRange]);

  // Use shared hook for chart data - handles both raw and aggregated modes
  // and includes signal handling for automatic refresh
  const {
    context: chartContext,
    loading: chartLoading,
    isFetching: chartFetching,
    bucketIntervalSeconds,
  } = useHealthCheckData({
    systemId,
    configurationId: item.configurationId,
    strategyId: item.strategyId,
    dateRange,
    isRollingPreset,
    // Update endDate to current time when new runs are detected (only for rolling presets)
    onDateRangeRefresh: (newEndDate) => {
      setDateRange((prev) => ({ ...prev, endDate: newEndDate }));
    },
  });

  // Pagination state for history table
  const pagination = usePagination({ defaultLimit: 10 });

  // Fetch paginated history with useQuery - newest first for table
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
    sortOrder: "desc",
  });

  // Sync total from response
  usePaginationSync(pagination, historyData?.total);

  // Preserve previous runs during loading to prevent layout shift
  const prevRunsRef = useRef(historyData?.runs ?? []);
  const rawRuns = historyData?.runs ?? [];
  const displayRuns =
    loading && prevRunsRef.current.length > 0 ? prevRunsRef.current : rawRuns;
  if (!loading && rawRuns.length > 0) {
    prevRunsRef.current = rawRuns;
  }
  const runs = displayRuns;

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

  // Fetch availability stats
  const { data: availabilityData } =
    healthCheckClient.getAvailabilityStats.useQuery({
      systemId,
      configurationId: item.configurationId,
    });

  // Render charts - charts handle data transformation internally
  const renderCharts = () => {
    if (chartLoading) {
      return <LoadingSpinner />;
    }

    if (!chartContext) {
      return;
    }

    // Check if we have data to show
    const hasData = chartContext.buckets.length > 0;

    if (!hasData) {
      return;
    }

    return (
      <div className="space-y-4">
        {bucketIntervalSeconds && (
          <AggregatedDataBanner
            bucketIntervalSeconds={bucketIntervalSeconds}
            checkIntervalSeconds={item.intervalSeconds}
          />
        )}
        {/* Status Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Status Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HealthCheckStatusTimeline context={chartContext} height={50} />
          </CardContent>
        </Card>
        {/* Execution Duration Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Average Execution Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HealthCheckLatencyChart
              context={chartContext}
              height={150}
              showAverage
            />
          </CardContent>
        </Card>
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

      {/* Availability Stats - Prominent Display */}
      {availabilityData && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 p-4 rounded-lg border bg-card">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              31-Day Availability
            </span>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-2xl font-bold ${formatAvailability(availabilityData.availability31Days, availabilityData.totalRuns31Days).className}`}
              >
                {
                  formatAvailability(
                    availabilityData.availability31Days,
                    availabilityData.totalRuns31Days,
                  ).text
                }
              </span>
              {availabilityData.totalRuns31Days > 0 && (
                <span className="text-sm text-muted-foreground">
                  ({availabilityData.totalRuns31Days.toLocaleString()} runs)
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 p-4 rounded-lg border bg-card">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              365-Day Availability
            </span>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-2xl font-bold ${formatAvailability(availabilityData.availability365Days, availabilityData.totalRuns365Days).className}`}
              >
                {
                  formatAvailability(
                    availabilityData.availability365Days,
                    availabilityData.totalRuns365Days,
                  ).text
                }
              </span>
              {availabilityData.totalRuns365Days > 0 && (
                <span className="text-sm text-muted-foreground">
                  ({availabilityData.totalRuns365Days.toLocaleString()} runs)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Date Range Filter with Loading Spinner */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangeFilter
          value={pendingCustomRange ?? dateRange}
          onChange={handleDateRangeChange}
          onCustomChange={handleCustomDateChange}
          disabled={chartFetching}
        />
        {pendingCustomRange && (
          <button
            onClick={handleApplyCustomRange}
            disabled={
              chartFetching ||
              pendingCustomRange.startDate >= pendingCustomRange.endDate
            }
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Apply
          </button>
        )}
        {chartFetching && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Charts Section */}
      {renderCharts()}

      {loading && prevRunsRef.current.length === 0 ? (
        <LoadingSpinner />
      ) : runs.length > 0 ? (
        <>
          {/* Divider between charts and table */}
          <div className="flex items-center gap-4 pt-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              Recent Runs
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>
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
                  <TableRow
                    key={run.id}
                    className={`${
                      canViewDetails ? "cursor-pointer hover:bg-muted/50" : ""
                    } ${loading ? "opacity-50" : ""}`}
                    onClick={
                      canViewDetails
                        ? () =>
                            navigate(
                              resolveRoute(
                                healthcheckRoutes.routes.historyRun,
                                {
                                  systemId,
                                  configurationId: item.configurationId,
                                  runId: run.id,
                                },
                              ),
                            )
                        : undefined
                    }
                  >
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
      lastRunAt: check.recentRuns.at(-1)?.timestamp
        ? new Date(check.recentRuns.at(-1)!.timestamp)
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
