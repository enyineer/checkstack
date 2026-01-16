import { useMemo } from "react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import {
  healthCheckAccess,
  DEFAULT_RETENTION_CONFIG,
  type RetentionConfig,
  HEALTH_CHECK_RUN_COMPLETED,
} from "@checkstack/healthcheck-common";
import { useSignal } from "@checkstack/signal-frontend";
import type {
  HealthCheckDiagramSlotContext,
  TypedHealthCheckRun,
  TypedAggregatedBucket,
} from "../slots";

interface UseHealthCheckDataProps {
  systemId: string;
  configurationId: string;
  strategyId: string;
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  /** Pagination for raw data mode */
  limit?: number;
  offset?: number;
}

interface UseHealthCheckDataResult {
  /** The context to pass to HealthCheckDiagramSlot */
  context: HealthCheckDiagramSlotContext | undefined;
  /** Whether data is currently loading */
  loading: boolean;
  /** Whether aggregated data mode is active */
  isAggregated: boolean;
  /** The resolved retention config */
  retentionConfig: RetentionConfig;
  /** Whether user has access to view detailed data */
  hasAccess: boolean;
  /** Whether access is still loading */
  accessLoading: boolean;
}

/**
 * Hook that handles fetching health check data for visualization.
 * Automatically determines whether to use raw or aggregated data based on:
 * - The selected date range
 * - The configured rawRetentionDays for the assignment
 *
 * Returns a ready-to-use context for HealthCheckDiagramSlot.
 */
export function useHealthCheckData({
  systemId,
  configurationId,
  strategyId,
  dateRange,
  limit = 100,
  offset = 0,
}: UseHealthCheckDataProps): UseHealthCheckDataResult {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);

  // Access state
  const { allowed: hasAccess, loading: accessLoading } = accessApi.useAccess(
    healthCheckAccess.details
  );

  // Calculate date range in days
  const dateRangeDays = useMemo(() => {
    return Math.ceil(
      (dateRange.endDate.getTime() - dateRange.startDate.getTime()) /
        (1000 * 60 * 60 * 24)
    );
  }, [dateRange.startDate, dateRange.endDate]);

  // Query: Fetch retention config
  const { data: retentionData, isLoading: retentionLoading } =
    healthCheckClient.getRetentionConfig.useQuery(
      { systemId, configurationId },
      { enabled: !!systemId && !!configurationId && hasAccess }
    );

  const retentionConfig =
    retentionData?.retentionConfig ?? DEFAULT_RETENTION_CONFIG;

  // Determine if we should use aggregated data
  const isAggregated = dateRangeDays > retentionConfig.rawRetentionDays;

  // Query: Fetch raw data (when in raw mode)
  const {
    data: rawData,
    isLoading: rawLoading,
    refetch: refetchRawData,
  } = healthCheckClient.getDetailedHistory.useQuery(
    {
      systemId,
      configurationId,
      startDate: dateRange.startDate,
      limit,
      offset,
    },
    {
      enabled:
        !!systemId &&
        !!configurationId &&
        hasAccess &&
        !accessLoading &&
        !retentionLoading &&
        !isAggregated,
    }
  );

  // Query: Fetch aggregated data (when in aggregated mode)
  const bucketSize = dateRangeDays > 30 ? "daily" : "hourly";
  const { data: aggregatedData, isLoading: aggregatedLoading } =
    healthCheckClient.getDetailedAggregatedHistory.useQuery(
      {
        systemId,
        configurationId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        bucketSize,
      },
      {
        enabled:
          !!systemId &&
          !!configurationId &&
          hasAccess &&
          !accessLoading &&
          !retentionLoading &&
          isAggregated,
      }
    );

  // Listen for realtime health check updates to refresh data silently
  useSignal(HEALTH_CHECK_RUN_COMPLETED, ({ systemId: changedId }) => {
    // Only refresh if we're in raw mode (not aggregated) and have access
    if (
      changedId === systemId &&
      hasAccess &&
      !accessLoading &&
      !retentionLoading &&
      !isAggregated
    ) {
      void refetchRawData();
    }
  });

  // Transform raw runs to typed format
  const rawRuns = useMemo((): TypedHealthCheckRun<
    Record<string, unknown>
  >[] => {
    if (!rawData?.runs) return [];
    return rawData.runs.map((r) => ({
      id: r.id,
      configurationId,
      systemId,
      status: r.status,
      timestamp: r.timestamp,
      latencyMs: r.latencyMs,
      result: r.result as Record<string, unknown>,
    }));
  }, [rawData, configurationId, systemId]);

  // Transform aggregated buckets
  const aggregatedBuckets = useMemo((): TypedAggregatedBucket<
    Record<string, unknown>
  >[] => {
    if (!aggregatedData?.buckets) return [];
    return aggregatedData.buckets as TypedAggregatedBucket<
      Record<string, unknown>
    >[];
  }, [aggregatedData]);

  const context = useMemo((): HealthCheckDiagramSlotContext | undefined => {
    if (!hasAccess || accessLoading || retentionLoading) {
      return undefined;
    }

    if (isAggregated) {
      return {
        type: "aggregated",
        systemId,
        configurationId,
        strategyId,
        buckets: aggregatedBuckets,
      };
    }

    return {
      type: "raw",
      systemId,
      configurationId,
      strategyId,
      runs: rawRuns,
    };
  }, [
    hasAccess,
    accessLoading,
    retentionLoading,
    isAggregated,
    systemId,
    configurationId,
    strategyId,
    rawRuns,
    aggregatedBuckets,
  ]);

  const loading =
    accessLoading ||
    retentionLoading ||
    (isAggregated ? aggregatedLoading : rawLoading);

  return {
    context,
    loading,
    isAggregated,
    retentionConfig,
    hasAccess,
    accessLoading,
  };
}
