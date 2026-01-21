import { useMemo, useRef } from "react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import {
  healthCheckAccess,
  HEALTH_CHECK_RUN_COMPLETED,
} from "@checkstack/healthcheck-common";
import { useSignal } from "@checkstack/signal-frontend";
import type {
  HealthCheckDiagramSlotContext,
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
  /** Whether the date range is a rolling preset (e.g., 'Last 7 days') that should auto-update */
  isRollingPreset?: boolean;
  /** Callback to update the date range (e.g., to refresh endDate to current time) */
  onDateRangeRefresh?: (newEndDate: Date) => void;
}

interface UseHealthCheckDataResult {
  /** The context to pass to HealthCheckDiagramSlot */
  context: HealthCheckDiagramSlotContext | undefined;
  /** Whether data is currently loading (no previous data available) */
  loading: boolean;
  /** Whether data is being fetched (even if previous data is shown) */
  isFetching: boolean;
  /** Whether user has access to view detailed data */
  hasAccess: boolean;
  /** Whether access is still loading */
  accessLoading: boolean;
  /** Bucket interval in seconds */
  bucketIntervalSeconds: number | undefined;
}

/**
 * Hook that handles fetching health check data for chart visualization.
 * Always uses aggregated data with a fixed number of target points (500)
 * for consistent chart rendering regardless of the selected time range.
 *
 * The backend's cross-tier aggregation engine automatically selects
 * the appropriate data source (raw, hourly, or daily) based on the
 * time range and aggregates it to the target number of points.
 *
 * Returns a ready-to-use context for HealthCheckDiagramSlot.
 */
export function useHealthCheckData({
  systemId,
  configurationId,
  strategyId,
  dateRange,
  isRollingPreset = false,
  onDateRangeRefresh,
}: UseHealthCheckDataProps): UseHealthCheckDataResult {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);

  // Access state
  const { allowed: hasAccess, loading: accessLoading } = accessApi.useAccess(
    healthCheckAccess.details,
  );

  // Always use aggregated data with fixed target points
  const {
    data: aggregatedData,
    isLoading,
    refetch,
  } = healthCheckClient.getDetailedAggregatedHistory.useQuery(
    {
      systemId,
      configurationId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      targetPoints: 500,
    },
    {
      enabled: !!systemId && !!configurationId && hasAccess && !accessLoading,
      // Keep previous data visible during refetch to prevent layout shift
      placeholderData: (prev) => prev,
    },
  );

  // Listen for realtime health check updates to refresh data silently
  useSignal(HEALTH_CHECK_RUN_COMPLETED, ({ systemId: changedId }) => {
    if (changedId === systemId && hasAccess && !accessLoading) {
      // Update endDate to current time only for rolling presets (not custom ranges)
      if (isRollingPreset && onDateRangeRefresh) {
        onDateRangeRefresh(new Date());
      }
      void refetch();
    }
  });

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
    if (!hasAccess || accessLoading) {
      return undefined;
    }

    // Don't create context with empty buckets during loading
    if (aggregatedBuckets.length === 0) {
      return undefined;
    }

    return {
      systemId,
      configurationId,
      strategyId,
      buckets: aggregatedBuckets,
    };
  }, [
    hasAccess,
    accessLoading,
    systemId,
    configurationId,
    strategyId,
    aggregatedBuckets,
  ]);

  // Keep previous valid context to prevent layout shift during refetch
  const previousContextRef = useRef<
    HealthCheckDiagramSlotContext | undefined
  >();
  if (context) {
    previousContextRef.current = context;
  }

  // Return previous context while loading to prevent layout shift
  const stableContext =
    context ?? (isLoading ? previousContextRef.current : undefined);

  // Only report loading when we don't have any context to show
  // This prevents showing loading spinner during refetch when we have previous data
  const loading = isLoading && !stableContext;

  return {
    context: stableContext,
    loading,
    isFetching: isLoading,
    hasAccess,
    accessLoading,
    bucketIntervalSeconds: aggregatedData?.bucketIntervalSeconds,
  };
}
