import React, { useState, useCallback, useRef } from "react";
import { Loader2, ExternalLink, Server } from "lucide-react";
import { Satellite as SatelliteIcon } from "lucide-react";
import {
  ExtensionSlot,
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import {
  HEALTH_CHECK_RUN_COMPLETED,
  HealthCheckApi,
  healthCheckAccess,
  healthcheckRoutes,
} from "@checkstack/healthcheck-common";
import { SatelliteApi, satelliteAccess } from "@checkstack/satellite-common";
import { AnomalyApi } from "@checkstack/anomaly-common";
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
  Pagination,
  usePagination,
  usePaginationSync,
  DateRangeFilter,
  getPresetRange,
  DateRangePreset,
  detectPreset,
  PRESETS,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricTile,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  Badge,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@checkstack/ui";
import { formatDistanceToNow } from "date-fns";
import { useNavigate, Link } from "react-router-dom";
import { HealthCheckStatusTimeline } from "./HealthCheckStatusTimeline";
import { HealthCheckLatencyChart } from "./HealthCheckLatencyChart";
import { useHealthCheckData } from "../hooks/useHealthCheckData";
import { AggregatedDataBanner } from "./AggregatedDataBanner";
import { HealthCheckDiagramSlot } from "../slots";
import { Heart, Clock, CheckCircle, AlertTriangle } from "lucide-react";

import type {
  StateThresholds,
  HealthCheckStatus,
} from "@checkstack/healthcheck-common";

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

interface HealthCheckDrawerProps {
  item: HealthCheckOverviewItem;
  systemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const getVariantForStatus = (
  status: HealthCheckStatus,
): "success" | "warning" | "destructive" | "default" => {
  switch (status) {
    case "healthy": {
      return "success";
    }
    case "degraded": {
      return "warning";
    }
    case "unhealthy": {
      return "destructive";
    }
    default: {
      return "default";
    }
  }
};

export const HealthCheckDrawer: React.FC<HealthCheckDrawerProps> = ({
  item,
  systemId,
  open,
  onOpenChange,
}) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const satelliteClient = usePluginClient(SatelliteApi);
  const navigate = useNavigate();
  const accessApi = useApi(accessApiRef);
  const { allowed: canViewDetails } = accessApi.useAccess(
    healthCheckAccess.details,
  );
  const { allowed: canReadSatellites } = accessApi.useAccess(
    satelliteAccess.satellite.read,
  );

  // Fetch satellites for source filter
  const { data: satellitesData } = satelliteClient.listSatellites.useQuery(
    {},
    { enabled: canReadSatellites },
  );
  const satellites = satellitesData?.satellites ?? [];

  // Date range state
  const [dateRange, setDateRange] = useState(() =>
    getPresetRange(DateRangePreset.Last24Hours),
  );
  const [isRollingPreset, setIsRollingPreset] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();

  const activePreset = detectPreset(dateRange);
  const activePresetLabel = PRESETS.find((p) => p.id === activePreset)?.shortLabel ?? "Custom";

  const activeSourceName = sourceFilter === "local"
    ? "Local"
    : sourceFilter
      ? satellites.find(s => s.id === sourceFilter)?.name ?? "Unknown"
      : "All";

  const handleDateRangeChange = useCallback(
    (newRange: { startDate: Date; endDate: Date }) => {
      setDateRange(newRange);
      const isNearNow =
        Math.abs(newRange.endDate.getTime() - Date.now()) < 60_000;
      setIsRollingPreset(isNearNow);
      setPendingCustomRange(undefined);
    },
    [],
  );

  const [pendingCustomRange, setPendingCustomRange] = useState<
    { startDate: Date; endDate: Date } | undefined
  >();

  const handleCustomDateChange = useCallback(
    (newRange: { startDate: Date; endDate: Date }) => {
      setPendingCustomRange(newRange);
    },
    [],
  );

  const handleApplyCustomRange = useCallback(() => {
    if (pendingCustomRange) {
      setDateRange(pendingCustomRange);
      setIsRollingPreset(false);
      setPendingCustomRange(undefined);
    }
  }, [pendingCustomRange]);

  // Chart data hook
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
    sourceFilter,
    isRollingPreset,
    onDateRangeRefresh: (newEndDate) => {
      setDateRange((prev) => ({ ...prev, endDate: newEndDate }));
    },
  });

  const anomalyClient = usePluginClient(AnomalyApi);
  const { data: baselines = [] } = anomalyClient.getAnomalyBaselines.useQuery(
    { systemId, configurationId: item.configurationId },
    { enabled: !!systemId && !!item.configurationId }
  );

  // Pagination for history table
  const pagination = usePagination({ defaultLimit: 5 });

  const {
    data: historyData,
    isLoading: historyLoading,
    refetch,
  } = healthCheckClient.getHistory.useQuery({
    systemId,
    configurationId: item.configurationId,
    limit: pagination.limit,
    offset: pagination.offset,
    startDate: dateRange.startDate,
    sourceFilter,
    sortOrder: "desc",
  });

  usePaginationSync(pagination, historyData?.total);

  const prevRunsRef = useRef(historyData?.runs ?? []);
  const rawRuns = historyData?.runs ?? [];
  const displayRuns =
    historyLoading && prevRunsRef.current.length > 0
      ? prevRunsRef.current
      : rawRuns;
  if (!historyLoading && rawRuns.length > 0) {
    prevRunsRef.current = rawRuns;
  }
  const runs = displayRuns;

  // Realtime updates
  useSignal(HEALTH_CHECK_RUN_COMPLETED, ({ systemId: changedId }) => {
    if (changedId === systemId) {
      void refetch();
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg">
        <SheetHeader>
          <div className="flex items-center justify-between pr-8 gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <SheetTitle className="truncate">{item.name}</SheetTitle>
              <Badge variant="secondary" className="hidden sm:inline-flex shrink-0">
                {item.strategyId}
              </Badge>
            </div>
            <Link
              to={resolveRoute(healthcheckRoutes.routes.historyDetail, {
                systemId,
                configurationId: item.configurationId,
              })}
              className="text-sm text-primary hover:underline flex items-center gap-1 shrink-0"
            >
              <span className="hidden sm:inline">Open Full Detail</span>
              <span className="sm:hidden">Details</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
          <SheetDescription className="sr-only">
            Health check details for {item.name}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6">
          {/* Zone 1 — Summary Metric Tiles */}
          <div className="grid grid-cols-2 gap-3">
            <MetricTile
              icon={Heart}
              label="Status"
              value={item.state}
              variant={getVariantForStatus(item.state)}
            />
            <MetricTile
              icon={Clock}
              label="Last Run"
              value={
                item.lastRunAt
                  ? formatDistanceToNow(item.lastRunAt, { addSuffix: true })
                  : "Never"
              }
            />
            <MetricTile
              icon={CheckCircle}
              label="Interval"
              value={`${item.intervalSeconds}s`}
            />
            <MetricTile
              icon={AlertTriangle}
              label="Recent History"
              value={`${item.recentStatusHistory.filter((s) => s === "healthy").length}/${item.recentStatusHistory.length} healthy`}
              variant={
                item.recentStatusHistory.includes("unhealthy")
                  ? "destructive"
                  : "success"
              }
            />
          </div>

          {/* Zone 2 — Timeline Charts */}
          <div className="space-y-6">
            {/* Filters */}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="filters" className="border-none">
                <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:no-underline hover:text-foreground">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-medium mr-1 text-foreground">Filters</span>
                    <div className="flex items-center gap-1.5 bg-muted/50 text-muted-foreground px-2 py-0.5 rounded-md border border-border/50">
                      <Clock className="h-3.5 w-3.5" />
                      {activePresetLabel}
                    </div>
                    {canReadSatellites && satellites.length > 0 && (
                      <div className="flex items-center gap-1.5 bg-muted/50 text-muted-foreground px-2 py-0.5 rounded-md border border-border/50">
                        {sourceFilter && sourceFilter !== "local" ? (
                          <SatelliteIcon className="h-3.5 w-3.5 text-orange-500" />
                        ) : (
                          <Server className="h-3.5 w-3.5" />
                        )}
                        {activeSourceName}
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-4 pt-2">
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
                          className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          Apply
                        </button>
                      )}
                      {chartFetching && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-2" />
                      )}
                    </div>

                    {/* Source filter */}
                    {canReadSatellites && satellites.length > 0 && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mr-1">
                          <Server className="h-4 w-4" />
                          <span className="font-medium text-foreground">Source:</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setSourceFilter(undefined)}
                            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                              sourceFilter === undefined
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                          >
                            All
                          </button>
                          <button
                            onClick={() => setSourceFilter("local")}
                            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                              sourceFilter === "local"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                          >
                            <Server className="h-3.5 w-3.5" />
                            Local
                          </button>
                          {satellites.map((sat) => (
                            <button
                              key={sat.id}
                              onClick={() => setSourceFilter(sat.id)}
                              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                                sourceFilter === sat.id
                                  ? "bg-orange-500 text-white"
                                  : "bg-orange-500/10 text-orange-600 hover:bg-orange-500/20"
                              }`}
                            >
                              <SatelliteIcon className="h-3.5 w-3.5" />
                              {sat.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Charts */}
            {chartLoading ? (
              <LoadingSpinner />
            ) : chartContext && chartContext.buckets.length > 0 ? (
              <div className="space-y-4">
                {bucketIntervalSeconds && (
                  <AggregatedDataBanner
                    bucketIntervalSeconds={bucketIntervalSeconds}
                    checkIntervalSeconds={item.intervalSeconds}
                  />
                )}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Status Timeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <HealthCheckStatusTimeline
                      context={chartContext}
                      height={96}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Average Execution Duration
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <HealthCheckLatencyChart
                      context={chartContext}
                      height={120}
                      showAverage
                      baselines={baselines}
                    />
                  </CardContent>
                </Card>
                <ExtensionSlot
                  slot={HealthCheckDiagramSlot}
                  context={chartContext}
                />
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-4 text-sm">
                No chart data available
              </div>
            )}
          </div>

          {/* Zone 3 — Recent Runs */}
          {runs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  Recent Runs
                  {historyLoading && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow
                        key={run.id}
                        className={`${
                          canViewDetails
                            ? "cursor-pointer hover:bg-muted/50"
                            : ""
                        } ${historyLoading ? "opacity-50" : ""}`}
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
                        <TableCell>
                          {run.sourceId ? (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600">
                              <SatelliteIcon className="h-3 w-3" />
                              {run.sourceLabel ?? "Remote"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              <Server className="h-3 w-3" />
                              {run.sourceLabel ?? "Local"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
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
              </div>
              <div className="text-center">
                <Link
                  to={resolveRoute(healthcheckRoutes.routes.historyDetail, {
                    systemId,
                    configurationId: item.configurationId,
                  })}
                  className="text-sm text-primary hover:underline"
                >
                  View all runs →
                </Link>
              </div>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
};
