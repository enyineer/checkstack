/**
 * Hook to fetch and cache strategy schemas.
 */

import { useEffect, useState } from "react";
import { useApi } from "@checkmate-monitor/frontend-api";
import { healthCheckApiRef } from "../api";

interface StrategySchemas {
  resultSchema: Record<string, unknown> | undefined;
  aggregatedResultSchema: Record<string, unknown> | undefined;
}

/**
 * Fetch and cache strategy schemas for auto-chart rendering.
 *
 * @param strategyId - The strategy ID to fetch schemas for
 * @returns Schemas for the strategy, or undefined if not found
 */
export function useStrategySchemas(strategyId: string): {
  schemas: StrategySchemas | undefined;
  loading: boolean;
} {
  const api = useApi(healthCheckApiRef);
  const [schemas, setSchemas] = useState<StrategySchemas | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchSchemas() {
      try {
        const strategies = await api.getStrategies();
        const strategy = strategies.find((s) => s.id === strategyId);

        if (!cancelled && strategy) {
          setSchemas({
            resultSchema:
              (strategy.resultSchema as Record<string, unknown>) ?? undefined,
            aggregatedResultSchema:
              (strategy.aggregatedResultSchema as Record<string, unknown>) ??
              undefined,
          });
        }
      } catch (error) {
        console.error("Failed to fetch strategy schemas:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSchemas();

    return () => {
      cancelled = true;
    };
  }, [api, strategyId]);

  return { schemas, loading };
}
