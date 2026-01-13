import { useEffect, useState, useMemo, useCallback } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { healthCheckApiRef } from "../api";
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
 *
 * @example
 * ```tsx
 * const { context, loading, hasAccess } = useHealthCheckData({
 *   systemId,
 *   configurationId,
 *   strategyId,
 *   dateRange: { startDate, endDate },
 * });
 *
 * if (!hasAccess) return <NoAccessMessage />;
 * if (loading) return <LoadingSpinner />;
 * if (!context) return null;
 *
 * return <ExtensionSlot slot={HealthCheckDiagramSlot} context={context} />;
 * ```
 */
export function useHealthCheckData({
  systemId,
  configurationId,
  strategyId,
  dateRange,
  limit = 100,
  offset = 0,
}: UseHealthCheckDataProps): UseHealthCheckDataResult {
  const api = useApi(healthCheckApiRef);
  const accessApi = useApi(accessApiRef);

  // Access state
  const { allowed: hasAccess, loading: accessLoading } =
    accessApi.useAccess(healthCheckAccess.details);

  // Retention config state
  const [retentionConfig, setRetentionConfig] = useState<RetentionConfig>(
    DEFAULT_RETENTION_CONFIG
  );
  const [retentionLoading, setRetentionLoading] = useState(true);

  // Raw data state
  const [rawRuns, setRawRuns] = useState<
    TypedHealthCheckRun<Record<string, unknown>>[]
  >([]);
  const [rawLoading, setRawLoading] = useState(false);

  // Aggregated data state
  const [aggregatedBuckets, setAggregatedBuckets] = useState<
    TypedAggregatedBucket<Record<string, unknown>>[]
  >([]);
  const [aggregatedLoading, setAggregatedLoading] = useState(false);

  // Calculate date range in days
  const dateRangeDays = useMemo(() => {
    return Math.ceil(
      (dateRange.endDate.getTime() - dateRange.startDate.getTime()) /
        (1000 * 60 * 60 * 24)
    );
  }, [dateRange.startDate, dateRange.endDate]);

  // Determine if we should use aggregated data
  const isAggregated = dateRangeDays > retentionConfig.rawRetentionDays;

  // Fetch retention config on mount
  useEffect(() => {
    setRetentionLoading(true);
    api
      .getRetentionConfig({ systemId, configurationId })
      .then((response) =>
        setRetentionConfig(response.retentionConfig ?? DEFAULT_RETENTION_CONFIG)
      )
      .catch(() => {
        // Fall back to default on error
        setRetentionConfig(DEFAULT_RETENTION_CONFIG);
      })
      .finally(() => setRetentionLoading(false));
  }, [api, systemId, configurationId]);

  // Fetch raw data function - extracted for reuse by signal handler
  const fetchRawData = useCallback(
    (showLoading = true) => {
      if (showLoading) {
        setRawLoading(true);
      }
      api
        .getDetailedHistory({
          systemId,
          configurationId,
          startDate: dateRange.startDate,
          // Don't pass endDate for live updates - backend defaults to 'now'
          limit,
          offset,
        })
        .then((response) => {
          setRawRuns(
            response.runs.map((r) => ({
              id: r.id,
              configurationId,
              systemId,
              status: r.status,
              timestamp: r.timestamp,
              latencyMs: r.latencyMs,
              result: r.result,
            }))
          );
        })
        .finally(() => setRawLoading(false));
    },
    [api, systemId, configurationId, dateRange.startDate, limit, offset]
  );

  // Fetch raw data when in raw mode
  useEffect(() => {
    if (!hasAccess || accessLoading || retentionLoading || isAggregated)
      return;
    fetchRawData(true);
  }, [
    fetchRawData,
    hasAccess,
    accessLoading,
    retentionLoading,
    isAggregated,
  ]);

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
      fetchRawData(false);
    }
  });

  // Fetch aggregated data when in aggregated mode
  useEffect(() => {
    if (
      !hasAccess ||
      accessLoading ||
      retentionLoading ||
      !isAggregated
    )
      return;

    setAggregatedLoading(true);
    // Use daily buckets for ranges > 30 days, hourly otherwise
    const bucketSize = dateRangeDays > 30 ? "daily" : "hourly";
    // Use detailed endpoint to get aggregatedResult since we have access
    api
      .getDetailedAggregatedHistory({
        systemId,
        configurationId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        bucketSize,
      })
      .then((response) => {
        setAggregatedBuckets(
          response.buckets as TypedAggregatedBucket<Record<string, unknown>>[]
        );
      })
      .finally(() => setAggregatedLoading(false));
  }, [
    api,
    systemId,
    configurationId,
    hasAccess,
    accessLoading,
    retentionLoading,
    isAggregated,
    dateRangeDays,
    dateRange.startDate,
    dateRange.endDate,
  ]);

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
