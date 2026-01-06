import { useEffect, useState, useMemo } from "react";
import { useApi, permissionApiRef } from "@checkmate-monitor/frontend-api";
import { healthCheckApiRef } from "../api";
import {
  permissions,
  DEFAULT_RETENTION_CONFIG,
  type RetentionConfig,
} from "@checkmate-monitor/healthcheck-common";
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
  /** Whether user has permission to view detailed data */
  hasPermission: boolean;
  /** Whether permission is still loading */
  permissionLoading: boolean;
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
 * const { context, loading, hasPermission } = useHealthCheckData({
 *   systemId,
 *   configurationId,
 *   strategyId,
 *   dateRange: { startDate, endDate },
 * });
 *
 * if (!hasPermission) return <NoPermissionMessage />;
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
  const permissionApi = useApi(permissionApiRef);

  // Permission state
  const { allowed: hasPermission, loading: permissionLoading } =
    permissionApi.usePermission(permissions.healthCheckDetailsRead.id);

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

  // Fetch raw data when in raw mode
  useEffect(() => {
    if (!hasPermission || permissionLoading || retentionLoading || isAggregated)
      return;

    setRawLoading(true);
    api
      .getDetailedHistory({
        systemId,
        configurationId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
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
  }, [
    api,
    systemId,
    configurationId,
    hasPermission,
    permissionLoading,
    retentionLoading,
    isAggregated,
    dateRange.startDate,
    dateRange.endDate,
    limit,
    offset,
  ]);

  // Fetch aggregated data when in aggregated mode
  useEffect(() => {
    if (
      !hasPermission ||
      permissionLoading ||
      retentionLoading ||
      !isAggregated
    )
      return;

    setAggregatedLoading(true);
    // Use daily buckets for ranges > 30 days, hourly otherwise
    const bucketSize = dateRangeDays > 30 ? "daily" : "hourly";
    // Use detailed endpoint to get aggregatedResult since we have permission
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
    hasPermission,
    permissionLoading,
    retentionLoading,
    isAggregated,
    dateRangeDays,
    dateRange.startDate,
    dateRange.endDate,
  ]);

  const context = useMemo((): HealthCheckDiagramSlotContext | undefined => {
    if (!hasPermission || permissionLoading || retentionLoading) {
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
    hasPermission,
    permissionLoading,
    retentionLoading,
    isAggregated,
    systemId,
    configurationId,
    strategyId,
    rawRuns,
    aggregatedBuckets,
  ]);

  const loading =
    permissionLoading ||
    retentionLoading ||
    (isAggregated ? aggregatedLoading : rawLoading);

  return {
    context,
    loading,
    isAggregated,
    retentionConfig,
    hasPermission,
    permissionLoading,
  };
}
