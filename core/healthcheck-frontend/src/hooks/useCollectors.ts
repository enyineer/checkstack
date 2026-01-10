import { useState, useEffect, useCallback } from "react";
import { useApi } from "@checkstack/frontend-api";
import { healthCheckApiRef } from "../api";
import { CollectorDto } from "@checkstack/healthcheck-common";

interface UseCollectorsResult {
  collectors: CollectorDto[];
  loading: boolean;
  error: Error | undefined;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch collectors for a given strategy.
 * @param strategyId - The strategy ID to fetch collectors for
 */
export function useCollectors(strategyId: string): UseCollectorsResult {
  const api = useApi(healthCheckApiRef);
  const [collectors, setCollectors] = useState<CollectorDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error>();

  const refetch = useCallback(async () => {
    if (!strategyId) {
      setCollectors([]);
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const result = await api.getCollectors({ strategyId });
      setCollectors(result);
    } catch (error_) {
      setError(
        error_ instanceof Error
          ? error_
          : new Error("Failed to fetch collectors")
      );
    } finally {
      setLoading(false);
    }
  }, [api, strategyId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { collectors, loading, error, refetch };
}

/**
 * Check if a collector is built-in for a given strategy.
 * Built-in collectors are those registered by the same plugin as the strategy.
 */
export function isBuiltInCollector(
  collectorId: string,
  strategyId: string
): boolean {
  // Collector ID format: ownerPluginId.collectorId
  // Strategy ID typically equals its plugin ID
  return collectorId.startsWith(`${strategyId}.`);
}
