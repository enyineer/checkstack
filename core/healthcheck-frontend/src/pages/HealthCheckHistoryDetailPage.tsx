import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  wrapInSuspense,
  accessApiRef,
  useApi,
  usePluginClient,
  ExtensionSlot,
} from "@checkstack/frontend-api";
import {
  healthcheckRoutes,
  healthCheckAccess,
  healthCheckResourceTypes,
  HealthCheckApi,
  HealthCheckConfigDetailsSlot,
  DEFAULT_RETENTION_CONFIG,
} from "@checkstack/healthcheck-common";
import { catalogResourceTypes } from "@checkstack/catalog-common";
import { SatelliteApi } from "@checkstack/satellite-common";
import { resolveRoute } from "@checkstack/common";
import {
  PageLayout,
  usePagination,
  usePaginationSync,
  useKeptPrevious,
  useIsMobile,
  usePerformance,
  chartCardChromeClass,
  BackLink,
  Button,
  DataTableFilterBar,
  DateRangeFilter,
  getDefaultDateRange,
  useDataTableFilters,
  EmptyState,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SplitPane,
  Pagination,
  cn,
  type DateRange,
} from "@checkstack/ui";
import { useParams, useNavigate } from "react-router";
import { History, MousePointerClick } from "lucide-react";
import { type HealthCheckRunDetailed } from "../components/HealthCheckRunsTable";
import { RunHistoryList } from "../components/RunHistoryList";
import { useEnvironmentLabels } from "../hooks/useEnvironmentLabels";
import { RunDetailPanel } from "../components/RunDetailPanel";
import {
  runFacetIds,
  runSourceControl,
  runSourceFilterInput,
  runStatusControl,
  runStatusFilterInput,
} from "../components/runFilters.logic";
import {
  buildRunHistoryRows,
  isLastRawPage,
  rawRetentionCutoff,
  shouldQueryAggregates,
} from "../components/runHistoryRows.logic";
import { getAdjacentRun } from "../components/runHistorySelection.logic";

const HealthCheckHistoryDetailPageContent = () => {
  const { systemId, configurationId, runId } = useParams<{
    systemId: string;
    configurationId: string;
    runId?: string;
  }>();

  const navigate = useNavigate();
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const satelliteClient = usePluginClient(SatelliteApi);
  const accessApi = useApi(accessApiRef);
  const isMobile = useIsMobile();
  const { isLowPower } = usePerformance();
  // Capability-aware: a team-scoped manager of a health check OR of a system
  // (a system's owning team sees its runs) can open detailed run history too,
  // matching the route guard; the data procs authorize the specific
  // (configuration, system) pair server-side.
  const { allowed: canManage, loading: accessLoading } =
    accessApi.useCanAccessType({
      accessRule: healthCheckAccess.configuration.manage,
      objectType: healthCheckResourceTypes.configuration,
      parentType: catalogResourceTypes.system,
    });

  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange);

  // Status + source are applied by `getDetailedHistory`, so the bar drives the
  // query rather than the list. URL-backed: a link to "this check's failing
  // runs from the EU satellite" reopens filtered.
  const filters = useDataTableFilters({ facetIds: runFacetIds });
  const sourceFilter = runSourceFilterInput({ filters: filters.state });
  const statusFilter = runStatusFilterInput({ filters: filters.state });

  // Pagination state
  const pagination = usePagination({ defaultLimit: 25 });

  // Fetch satellites for the source filter dropdown
  const { data: satellitesData } = satelliteClient.listSatellites.useQuery({});
  const satellites = satellitesData?.satellites ?? [];

  // Environment names for the run rows (per-environment fan-out). Uses ALL
  // environments (not just those still assigned to the system) so a run for an
  // unassigned environment shows its name instead of its raw id.
  const {
    environmentLabels,
    isLoading: environmentLabelsLoading,
  } = useEnvironmentLabels();

  // Fetch configurations to get strategyId
  const { data: configurations } = healthCheckClient.getConfigurations.useQuery(
    {},
    {
      enabled: !!configurationId,
    },
  );
  const configuration = configurations?.configurations.find(
    (c) => c.id === configurationId,
  );

  // Fetch data with useQuery - newest first for table display
  const { data, isLoading } = healthCheckClient.getDetailedHistory.useQuery({
    systemId,
    configurationId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    sourceFilter,
    statusFilter,
    limit: pagination.limit,
    offset: pagination.offset,
    sortOrder: "desc",
  });

  // Sync total from response
  usePaginationSync(pagination, data?.total);

  const rawRuns = useMemo(
    () => (data?.runs ?? []) as HealthCheckRunDetailed[],
    [data],
  );
  // Keep the previous page rendered (dimmed) while a refetch is in flight.
  const { data: displayRuns, isStale } = useKeptPrevious({
    data: rawRuns,
    isFetching: isLoading,
  });

  // Retention boundary. `getRetentionConfig` is gated on configuration.read,
  // which a system-owning team may not hold even though the history procs
  // authorize them handler-side — fall back to the platform default instead
  // of failing the page.
  const { data: retentionData } = healthCheckClient.getRetentionConfig.useQuery(
    { systemId: systemId!, configurationId: configurationId! },
    { enabled: !!systemId && !!configurationId, retry: false },
  );
  const rawRetentionDays =
    retentionData?.retentionConfig?.rawRetentionDays ??
    DEFAULT_RETENTION_CONFIG.rawRetentionDays;
  const cutoff = rawRetentionCutoff({ rawRetentionDays, now: new Date() });

  // Aggregate buckets for the pre-retention tail of the list (last page only).
  const aggregatesEnabled = shouldQueryAggregates({
    rangeStart: dateRange.startDate,
    cutoff,
    page: pagination.page,
    totalPages: pagination.totalPages,
  });
  const { data: aggregatedData } =
    healthCheckClient.getDetailedAggregatedHistory.useQuery(
      {
        systemId: systemId!,
        configurationId: configurationId!,
        startDate: dateRange.startDate,
        endDate: cutoff,
        sourceFilter,
        targetPoints: 60,
      },
      { enabled: aggregatesEnabled && !!systemId && !!configurationId },
    );

  const rows = buildRunHistoryRows({
    runs: displayRuns,
    buckets: aggregatesEnabled ? (aggregatedData?.buckets ?? []) : [],
    cutoff,
    isLastPage: isLastRawPage({
      page: pagination.page,
      totalPages: pagination.totalPages,
    }),
  });

  const selectRun = useCallback(
    (nextRunId: string) => {
      navigate(
        resolveRoute(healthcheckRoutes.routes.historyRun, {
          systemId,
          configurationId,
          runId: nextRunId,
        }),
      );
    },
    [navigate, systemId, configurationId],
  );

  // Handler to dismiss the highlighted run
  const dismissHighlightedRun = () => {
    navigate(
      resolveRoute(healthcheckRoutes.routes.historyDetail, {
        systemId,
        configurationId,
      }),
      { replace: true },
    );
  };

  // Prev/next: adjacent run on this page, or flip the page and select that
  // page's first/last run once it arrives.
  const pendingSelectRef = useRef<"first" | "last" | undefined>(undefined);
  const runIds = rawRuns.map((run) => run.id);

  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (pending === undefined || isLoading || rawRuns.length === 0) return;
    pendingSelectRef.current = undefined;
    const target = pending === "first" ? rawRuns[0] : rawRuns.at(-1);
    if (target !== undefined) selectRun(target.id);
  }, [rawRuns, isLoading, selectRun]);

  const adjacentFor = (direction: "prev" | "next") =>
    runId === undefined
      ? { kind: "none" as const }
      : getAdjacentRun({
          runIds,
          currentRunId: runId,
          direction,
          page: pagination.page,
          totalPages: pagination.totalPages,
        });

  const handleAdjacent = (direction: "prev" | "next") => {
    const result = adjacentFor(direction);
    if (result.kind === "run") {
      selectRun(result.runId);
    } else if (result.kind === "page") {
      pendingSelectRef.current = result.select;
      pagination.setPage(result.page);
    }
  };

  const canPrev = adjacentFor("prev").kind !== "none";
  const canNext = adjacentFor("next").kind !== "none";

  const defaultRange = getDefaultDateRange();
  // The date range is a filter too, but it is not part of the facet state, so
  // the page keeps its own Clear button (and the bar renders none) - otherwise
  // a widened range alone would leave nothing to reset it with.
  const hasActiveFilters =
    filters.active ||
    dateRange.startDate.getTime() !== defaultRange.startDate.getTime();

  const clearFilters = () => {
    setDateRange(getDefaultDateRange());
    filters.clear();
    pagination.setPage(1);
  };

  // Any filter change lands the operator on page 1: the run they are looking
  // for is unlikely to be on page 7 of a differently-filtered list.
  const applyFilters = (next: typeof filters.state) => {
    filters.setState(next);
    pagination.setPage(1);
  };

  const detailPanel = runId ? (
    <RunDetailPanel
      runId={runId}
      strategyId={configuration?.strategyId}
      onDismiss={dismissHighlightedRun}
      prevNext={{
        onPrev: canPrev ? () => handleAdjacent("prev") : undefined,
        onNext: canNext ? () => handleAdjacent("next") : undefined,
      }}
    />
  ) : undefined;

  const emptyMessage = filters.active
    ? "No runs match the current filters."
    : "No health check runs found for this configuration.";

  return (
    <PageLayout
      title="Health Check Run History"
      subtitle={`System: ${systemId} • Configuration: ${configurationId?.slice(
        0,
        8,
      )}...`}
      icon={History}
      loading={accessLoading}
      allowed={canManage}
      actions={
        <BackLink onClick={() => navigate(resolveRoute(healthcheckRoutes.routes.history))}>
          Back to All History
        </BackLink>
      }
    >
      {/* "Who can change this" — filled by auth-frontend; renders nothing when
          the configuration is not team-scoped. */}
      {configurationId && (
        <div className="mb-4">
          <ExtensionSlot
            slot={HealthCheckConfigDetailsSlot}
            context={{ configurationId }}
          />
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter
          value={dateRange}
          onChange={(next) => {
            setDateRange(next);
            pagination.setPage(1);
          }}
        />
        <DataTableFilterBar
          filters={filters.state}
          onFiltersChange={applyFilters}
          facets={[runStatusControl, runSourceControl({ satellites })]}
          // Runs are identified by time and outcome, not by a name worth
          // typing, so the two facets are the whole control.
          searchable={false}
        />
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        {data !== undefined && (
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {data.total} runs
          </span>
        )}
      </div>

      <SplitPane
        master={
          <div className="flex h-full flex-col gap-3">
            <RunHistoryList
              rows={rows}
              selectedRunId={runId}
              onSelectRun={({ runId: nextRunId }) => selectRun(nextRunId)}
              onKeyNavigate={({ direction }) => handleAdjacent(direction)}
              loading={isLoading || environmentLabelsLoading}
              isStale={isStale}
              environmentLabels={environmentLabels}
              emptyMessage={emptyMessage}
              className="min-h-0 flex-1 max-md:h-[60vh]"
            />
            {pagination.totalPages > 1 && (
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
            )}
          </div>
        }
        detail={
          detailPanel === undefined ? (
            <EmptyState
              icon={<MousePointerClick className="h-10 w-10" />}
              title="Select a run"
              description="Pick a run on the left to inspect its result, timing breakdown, and raw payload."
            />
          ) : (
            <div
              className={cn(
                chartCardChromeClass({ isLowPower }),
                "p-[var(--d-pad)]",
              )}
            >
              {detailPanel}
            </div>
          )
        }
      />

      {/* Mobile: the detail opens as a sheet over the list. */}
      {isMobile && (
        <Sheet
          open={!!runId}
          onOpenChange={(open) => {
            if (!open) dismissHighlightedRun();
          }}
        >
          <SheetContent size="xl">
            <SheetHeader>
              <SheetTitle>Run detail</SheetTitle>
              <SheetDescription className="sr-only">
                Details for the selected health check run
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              {runId && (
                <RunDetailPanel
                  runId={runId}
                  strategyId={configuration?.strategyId}
                  prevNext={{
                    onPrev: canPrev ? () => handleAdjacent("prev") : undefined,
                    onNext: canNext ? () => handleAdjacent("next") : undefined,
                  }}
                />
              )}
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </PageLayout>
  );
};

export const HealthCheckHistoryDetailPage = wrapInSuspense(
  HealthCheckHistoryDetailPageContent,
);
