import { usePluginClient } from "@checkstack/frontend-api";
import { CollectorDto, HealthCheckApi } from "@checkstack/healthcheck-common";

interface UseCollectorsResult {
  collectors: CollectorDto[];
  loading: boolean;
  /** True once the query has SUCCEEDED (distinct from merely settled): on a
   * fetch error `loading` clears while `collectors` stays the `[]` default, so
   * callers that brand configured collectors "not installed" must gate on this,
   * not on `!loading`, to avoid a false positive on a transient error. */
  loaded: boolean;
  error: Error | undefined;
  refetch: () => void;
}

/**
 * Hook to fetch collectors for a given strategy.
 * @param strategyId - The strategy ID to fetch collectors for
 * @param options.enabled - Extra fetch gate ANDed with the strategy-id guard.
 *   `getCollectors` is typeScoped on the healthcheck type, so callers gate it
 *   off for users without config-plane capability (e.g. a pure system
 *   manager in the editor) instead of surfacing a guaranteed 403.
 */
export function useCollectors(
  strategyId: string,
  options?: { enabled?: boolean },
): UseCollectorsResult {
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const {
    data,
    isLoading: loading,
    isSuccess: loaded,
    error: queryError,
    refetch,
  } = healthCheckClient.getCollectors.useQuery(
    { strategyId },
    { enabled: !!strategyId && (options?.enabled ?? true) }
  );

  const collectors = data ?? [];
  const error = queryError ?? undefined;

  return {
    collectors,
    loading,
    loaded,
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
