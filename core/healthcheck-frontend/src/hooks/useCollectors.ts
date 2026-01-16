import { usePluginClient } from "@checkstack/frontend-api";
import { CollectorDto, HealthCheckApi } from "@checkstack/healthcheck-common";

interface UseCollectorsResult {
  collectors: CollectorDto[];
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

/**
 * Hook to fetch collectors for a given strategy.
 * @param strategyId - The strategy ID to fetch collectors for
 */
export function useCollectors(strategyId: string): UseCollectorsResult {
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
  } = healthCheckClient.getCollectors.useQuery(
    { strategyId },
    { enabled: !!strategyId }
  );

  const collectors = data ?? [];
  const error = queryError instanceof Error ? queryError : undefined;

  return {
    collectors,
    loading,
    error,
    refetch: () => void refetch(),
  };
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
