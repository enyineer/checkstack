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
  DataTableFilterBar,
  EMPTY_TABLE_FILTERS,
  type DataTableFilterState,
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
  pillToneStyles,
} from "@checkstack/ui";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "react-router";
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
  runSourceControl,
  runSourceFilterInput,
  runStatusControl,
  runStatusFilterInput,
  selectedRunStatus,
} from "./runFilters.logic";
import { HealthStatusPill } from "./HealthStatusPill";
import { isRunStale } from "./run-staleness.logic";
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
  /** A paused check is quiet on purpose, so its last run is never "stale". */
  paused?: boolean;
  /**
   * A retired slice (environment removed, satellite unassigned). Also never
   * "stale": it stopped correctly.
   */
  isOrphaned?: boolean;
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
  /**
   * Draws attention to a value that undermines the rest of the banner - a
   * "last run" so old that the status beside it is no longer being verified.
   */
  warn?: boolean;
}> = ({ value, label, title, warn = false }) => (
  <div className="text-right" title={title}>
    <span
      className={cn(
        "block text-lg font-bold leading-none tracking-tight tabular-nums",
        warn ? pillToneStyles.warn.text : "text-foreground",
      )}
    >
      {value}
    </span>
    <span
      className={cn(
        "mt-0.5 block text-[11px]",
        warn ? pillToneStyles.warn.text : "text-muted-foreground",
      )}
    >
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
  // Computed once per render rather than on a timer: the drawer already
  // re-renders on every realtime run signal, which is exactly when staleness
  // can change.
  const runIsStale = isRunStale({
    ...(item.lastRunAt ? { lastRunAt: item.lastRunAt } : {}),
    intervalSeconds: item.intervalSeconds,
    ...(item.paused === undefined ? {} : { paused: item.paused }),
    ...(item.isOrphaned === undefined ? {} : { orphaned: item.isOrphaned }),
    now: new Date(),
  });

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
  // Source (charts + runs) and run status, both applied server-side. Held in
  // COMPONENT state rather than the URL: the drawer is a transient sheet over a
  // system's detail page, its open state is not addressable, and writing its
  // filters into that page's query string would leave parameters behind with no
  // visible control once the sheet closes.
  const [runFilters, setRunFilters] =
    useState<DataTableFilterState>(EMPTY_TABLE_FILTERS);
  const sourceFilter = runSourceFilterInput({ filters: runFilters });
  const runsStatusFilter = selectedRunStatus({ filters: runFilters });
  const runsStatusInput = runStatusFilterInput({ filters: runFilters });

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
    statusFilter: runsStatusInput,
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
                {/* A check that has gone quiet is showing a status nobody is
                    verifying any more, so the age is warned rather than stated
                    flatly - otherwise a dead probe reads like a passing one. */}
                <BannerStat
                  value={
                    item.lastRunAt
                      ? formatDistanceToNow(item.lastRunAt, { addSuffix: true })
                      : "Never"
                  }
                  label={runIsStale ? "last run (stale)" : "last run"}
                  warn={runIsStale}
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

                    {/* Source stays HERE, not in the runs table: it scopes the
                        CHARTS as well as the runs (both queries take
                        `sourceFilter`), so it belongs beside the date range,
                        which scopes the same two. The status control, which
                        narrows only the runs, lives in that table's own bar. */}
                    {canReadSatellites && satellites.length > 0 && (
                      <DataTableFilterBar
                        filters={runFilters}
                        onFiltersChange={setRunFilters}
                        facets={[runSourceControl({ satellites })]}
                        searchable={false}
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
          {(runs.length > 0 || runsStatusFilter !== undefined) && (
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

              <HealthCheckRunsTable
                runs={runs}
                filters={runFilters}
                onFiltersChange={(next) => {
                  setRunFilters(next);
                  // A different filter means a different list; page 7 of the
                  // old one is not where the operator wants to land.
                  pagination.setPage(1);
                }}
                onClearFilters={() => {
                  setRunFilters(EMPTY_TABLE_FILTERS);
                  pagination.setPage(1);
                }}
                facets={[runStatusControl]}
                loading={historyLoading || environmentLabelsLoading}
                emptyMessage={
                  runsStatusFilter === undefined
                    ? "No runs found."
                    : `No runs match the ${runsStatusFilter} filter.`
                }
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
