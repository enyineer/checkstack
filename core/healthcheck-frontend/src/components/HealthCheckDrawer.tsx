import React, { useState, useCallback } from "react";
import { ExternalLink, Server } from "lucide-react";
import { Satellite as SatelliteIcon } from "lucide-react";
import {
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import {
  ExtensionSlot,
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import {
  HealthCheckApi,
  healthCheckAccess,
  healthCheckResourceTypes,
  healthcheckRoutes,
} from "@checkstack/healthcheck-common";
import { SatelliteApi, satelliteAccess } from "@checkstack/satellite-common";
import { AnomalyApi } from "@checkstack/anomaly-common";
import { resolveRoute } from "@checkstack/common";
import {
  LoadingSpinner,
  usePagination,
  usePaginationSync,
  DateRangeFilter,
  getPresetRange,
  DateRangePreset,
  detectPreset,
  PRESETS,
  ChartCard,
  chartCardChromeClass,
  StackedTimeline,
  usePerformance,
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
  Spinner,
  cn,
} from "@checkstack/ui";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { HealthCheckLatencyChart } from "./HealthCheckLatencyChart";
import { HealthCheckSparkline } from "./HealthCheckSparkline";
import { HealthCheckRunsTable } from "./HealthCheckRunsTable";
import { RunDetailPanel } from "./RunDetailPanel";
import {
  deriveExpectedBand,
  deriveTrend,
  formatBaselineChips,
} from "../auto-charts/baseline.logic";
import { BaselineChipStack } from "../auto-charts/BaselineChips";
import { useHealthCheckData } from "../hooks/useHealthCheckData";
import { useEnvironmentLabels } from "../hooks/useEnvironmentLabels";
import { AggregatedDataBanner } from "./AggregatedDataBanner";
import { HealthCheckDiagramSlot } from "../slots";
import {
  StatusFilterPills,
  STATUS_FILTER_TO_STATUSES,
  type StatusFilter,
} from "./StatusFilterPills";
import { SourceFilterPills } from "./SourceFilterPills";
import { HealthStatusPill } from "./HealthStatusPill";
import {
  bucketAvgLatencyMs,
  bucketHealthyPercent,
  bucketsToStacked,
  statusToLabel,
  statusToTone,
} from "./healthcheckDisplay.logic";
import { Clock } from "lucide-react";

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
  /**
   * The environment this drawer is scoped to. `null` for an env-less row; a
   * concrete string for a per-env row; `undefined` when the overview row was
   * the single-env rollup (no env scoping — query without an env filter).
   * Threaded straight through to every backend query the drawer issues so the
   * history table, the charts, and the stats see only the (check, environment)
   * pair the operator clicked — server-side, no client-side filtering.
   */
  environmentId?: string | null;
}

interface HealthCheckDrawerProps {
  item: HealthCheckOverviewItem;
  systemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** One number-led stat in the hero status banner. */
const BannerStat: React.FC<{
  value: string;
  label: string;
  /** Full-precision hover title (e.g. the exact datetime behind "2m ago"). */
  title?: string;
}> = ({ value, label, title }) => (
  <div className="text-right" title={title}>
    <span className="block text-lg font-bold leading-none tracking-tight tabular-nums text-foreground">
      {value}
    </span>
    <span className="mt-0.5 block text-[11px] text-muted-foreground">
      {label}
    </span>
  </div>
);


export const HealthCheckDrawer: React.FC<HealthCheckDrawerProps> = ({
  item,
  systemId,
  open,
  onOpenChange,
}) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const satelliteClient = usePluginClient(SatelliteApi);

  // Resolve run.environmentId to a human-readable name in the run-history
  // table. Uses ALL environments (not just those still assigned to the system)
  // so runs for an unassigned environment show its name, not its raw id.
  const {
    environmentLabels,
    isLoading: environmentLabelsLoading,
  } = useEnvironmentLabels();
  const accessApi = useApi(accessApiRef);
  // Detailed run history is a MANAGER surface: global manage, a team grant on
  // THIS configuration, or manage access to THIS system (a system's owning
  // team sees its runs). Gates the run-row click-through and the detail links
  // so users never navigate into a page whose data they cannot fetch.
  const { hasGlobal: hasGlobalManage, canAccess: canManageConfiguration } =
    accessApi.useResourceAccess({
      accessRule: healthCheckAccess.configuration.manage,
      objectType: healthCheckResourceTypes.configuration,
      resourceIds: [item.configurationId],
    });
  const { hasGlobal: hasGlobalSystemManage, canAccess: canManageSystem } =
    accessApi.useResourceAccess({
      accessRule: catalogAccess.system.manage,
      objectType: catalogResourceTypes.system,
      resourceIds: [systemId],
    });
  const canViewDetails =
    hasGlobalManage ||
    canManageConfiguration(item.configurationId) ||
    hasGlobalSystemManage ||
    canManageSystem(systemId);
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
  const [runsStatusFilter, setRunsStatusFilter] =
    useState<StatusFilter>("all");

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
    environmentId: item.environmentId,
    isRollingPreset,
    onDateRangeRefresh: (newEndDate) => {
      setDateRange((prev) => ({ ...prev, endDate: newEndDate }));
    },
  });

  const anomalyClient = usePluginClient(AnomalyApi);
  const { data: baselines = [] } = anomalyClient.getAnomalyBaselines.useQuery(
    // Server-side env scoping: thread the drawer's `item.environmentId`
    // through so baselines resolve to the clicked env only. `undefined`
    // (single-env rollup row) returns all envs; `null` → env-less slice; a
    // string → that env. Mirrors `getHistory`'s env filter above.
    { systemId, configurationId: item.configurationId, environmentId: item.environmentId },
    { enabled: !!systemId && !!item.configurationId }
  );

  // Pagination for history table
  const pagination = usePagination({ defaultLimit: 10 });

  const { data: historyData, isLoading: historyLoading } =
    healthCheckClient.getHistory.useQuery({
    systemId,
    configurationId: item.configurationId,
    limit: pagination.limit,
    offset: pagination.offset,
    startDate: dateRange.startDate,
    sourceFilter,
    statusFilter: STATUS_FILTER_TO_STATUSES[runsStatusFilter],
    // Server-side env filter: when the clicked overview row was env-scoped,
    // the run-history table shows only that env's runs; `null` selects the
    // env-less slice; `undefined` (single-env rollup row) queries all runs.
    environmentId: item.environmentId,
    sortOrder: "desc",
  });

  usePaginationSync(pagination, historyData?.total);

  // The runs table keeps the previous page rendered during refetches itself
  // (useKeptPrevious inside HealthCheckRunsTable).
  const runs = historyData?.runs ?? [];

  // Selected run for the nested detail sheet.
  const [detailRunId, setDetailRunId] = useState<string | undefined>();

  const { isLowPower } = usePerformance();
  const chartBuckets = chartContext?.buckets ?? [];
  const healthyPercent = bucketHealthyPercent({ buckets: chartBuckets });
  const avgLatency = bucketAvgLatencyMs({ buckets: chartBuckets });

  // Expected/Trend chips for the latency card header (shared derivation with
  // the auto-chart tiles — see auto-charts/baseline.logic).
  const latencyBaseline = baselines.find((b) => b.fieldPath === "latencyMs");
  const latencyChips = formatBaselineChips({
    band: deriveExpectedBand({
      baseline: latencyBaseline,
      buckets: chartBuckets,
    }),
    trend: deriveTrend({ baseline: latencyBaseline }),
    unit: "ms",
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
            {canViewDetails && (
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
            )}
          </div>
          <SheetDescription className="sr-only">
            Health check details for {item.name}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6">
          {/* Zone 1 — Hero status banner */}
          <div
            className={cn(
              chartCardChromeClass({ isLowPower }),
              "space-y-3 p-[var(--d-pad)]",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <HealthStatusPill
                tone={statusToTone({ status: item.state })}
                label={statusToLabel({ status: item.state })}
              />
              <div className="flex flex-wrap items-end justify-end gap-x-5 gap-y-2">
                <BannerStat
                  value={healthyPercent === null ? "—" : `${healthyPercent}%`}
                  label="healthy"
                />
                <BannerStat
                  value={avgLatency === null ? "—" : `${avgLatency}ms`}
                  label="avg latency"
                />
                <BannerStat
                  value={`${item.intervalSeconds}s`}
                  label="interval"
                />
                <BannerStat
                  value={
                    item.lastRunAt
                      ? formatDistanceToNow(item.lastRunAt, { addSuffix: true })
                      : "Never"
                  }
                  label="last run"
                  title={
                    item.lastRunAt
                      ? format(item.lastRunAt, "PPpp")
                      : undefined
                  }
                />
              </div>
            </div>
            <HealthCheckSparkline
              runs={item.recentStatusHistory.map((status) => ({ status }))}
              className="w-full"
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
                          <SatelliteIcon className="h-3.5 w-3.5 text-status-warn" />
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
                        <Spinner
                          size="sm"
                          className="text-muted-foreground ml-2"
                        />
                      )}
                    </div>

                    {/* Source filter */}
                    {canReadSatellites && satellites.length > 0 && (
                      <SourceFilterPills
                        value={sourceFilter}
                        onChange={setSourceFilter}
                        satellites={satellites}
                      />
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
                <ChartCard
                  title="Status Timeline"
                  heroValue={
                    healthyPercent === null ? "—" : `${healthyPercent}%`
                  }
                >
                  <StackedTimeline
                    buckets={bucketsToStacked({
                      buckets: chartContext.buckets,
                    })}
                    height={96}
                    ariaLabel="Run status distribution over the selected window"
                  />
                </ChartCard>
                <ChartCard
                  title="Average Execution Duration"
                  heroValue={avgLatency === null ? "—" : `${avgLatency}ms`}
                  actions={<BaselineChipStack chips={latencyChips} />}
                >
                  <HealthCheckLatencyChart
                    context={chartContext}
                    height={120}
                    showAverage={false}
                    baselines={baselines}
                  />
                </ChartCard>
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
          {(runs.length > 0 || runsStatusFilter !== "all") && (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  Recent Runs
                  {historyLoading && (
                    <Spinner size="sm" className="h-3 w-3" />
                  )}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="flex justify-end">
                <StatusFilterPills
                  value={runsStatusFilter}
                  onChange={(next) => {
                    setRunsStatusFilter(next);
                    pagination.setPage(1);
                  }}
                />
              </div>

              <HealthCheckRunsTable
                runs={runs}
                loading={historyLoading || environmentLabelsLoading}
                emptyMessage={`No runs match the ${runsStatusFilter} filter.`}
                environmentLabels={environmentLabels}
                pagination={pagination}
                selectedRunId={detailRunId}
                onRowSelect={
                  canViewDetails ? (run) => setDetailRunId(run.id) : undefined
                }
              />
              <div className="text-center">
                {canViewDetails && (
                  <Link
                    to={resolveRoute(healthcheckRoutes.routes.historyDetail, {
                      systemId,
                      configurationId: item.configurationId,
                    })}
                    className="text-sm text-primary hover:underline"
                  >
                    View all runs →
                  </Link>
                )}
              </div>
            </div>
          )}
        </SheetBody>
      </SheetContent>

      {/* Nested run-detail sheet: keeps the operator's drawer context (filters,
          scroll) instead of ejecting to the full history page. */}
      <Sheet
        open={detailRunId !== undefined}
        onOpenChange={(open) => {
          if (!open) setDetailRunId(undefined);
        }}
      >
        <SheetContent size="lg">
          <SheetHeader>
            <div className="flex items-center justify-between gap-4 pr-8">
              <SheetTitle>Run detail</SheetTitle>
              {detailRunId && (
                <Link
                  to={resolveRoute(healthcheckRoutes.routes.historyRun, {
                    systemId,
                    configurationId: item.configurationId,
                    runId: detailRunId,
                  })}
                  className="flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
                >
                  Open in full history
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            <SheetDescription className="sr-only">
              Details for the selected health check run
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {detailRunId && (
              <RunDetailPanel
                runId={detailRunId}
                strategyId={item.strategyId}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </Sheet>
  );
};
