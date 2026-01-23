/**
 * Hook to fetch and cache strategy schemas for auto-chart rendering.
 *
 * Fetches strategy aggregated result schemas AND collector aggregated result schemas,
 * merging them into a unified schema where collector schemas are nested
 * under `properties.collectors.<collectorId>`.
 */

import { useEffect, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";

interface StrategySchemas {
  resultSchema: Record<string, unknown> | undefined;
  aggregatedResultSchema: Record<string, unknown> | undefined;
}

/**
 * Fetch and cache strategy schemas for auto-chart rendering.
 *
 * Fetches collector aggregated schemas and merges them into the strategy's
 * aggregated result schema so that chart fields from collectors are properly extracted.
 *
 * @param strategyId - The strategy ID to fetch schemas for
 * @returns Schemas for the strategy, or undefined if not found
 */
export function useStrategySchemas(strategyId: string): {
  schemas: StrategySchemas | undefined;
  loading: boolean;
} {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const [schemas, setSchemas] = useState<StrategySchemas | undefined>();
  const [loading, setLoading] = useState(true);

  // Fetch strategies with useQuery
  const { data: strategies } = healthCheckClient.getStrategies.useQuery({});

  // Fetch collectors with useQuery
  const { data: collectors } = healthCheckClient.getCollectors.useQuery(
    { strategyId },
    { enabled: !!strategyId },
  );

  useEffect(() => {
    if (!strategies || !collectors) {
      return;
    }

    const strategy = strategies.find((s) => s.id === strategyId);

    if (strategy) {
      // Build collector aggregated schemas for nesting under aggregatedResultSchema.properties.collectors
      const collectorAggregatedProperties: Record<string, unknown> = {};

      for (const collector of collectors) {
        // Use full ID so it matches stored data keys like "healthcheck-http.request"
        if (collector.aggregatedResultSchema) {
          collectorAggregatedProperties[collector.id] =
            collector.aggregatedResultSchema;
        }
      }

      // Merge collector aggregated schemas into strategy aggregated schema
      const mergedAggregatedSchema = mergeCollectorSchemas(
        strategy.aggregatedResultSchema as Record<string, unknown> | undefined,
        collectorAggregatedProperties,
      );

      // Build collector result schemas for nesting under resultSchema.properties.collectors
      const collectorResultProperties: Record<string, unknown> = {};

      for (const collector of collectors) {
        if (collector.resultSchema) {
          collectorResultProperties[collector.id] = collector.resultSchema;
        }
      }

      // Merge collector result schemas into strategy result schema
      const mergedResultSchema = mergeCollectorSchemas(
        strategy.resultSchema as Record<string, unknown> | undefined,
        collectorResultProperties,
      );

      setSchemas({
        resultSchema: mergedResultSchema,
        aggregatedResultSchema: mergedAggregatedSchema,
      });
    }

    setLoading(false);
  }, [strategies, collectors, strategyId]);

  return { schemas, loading };
}

/**
 * Merge collector result schemas into a strategy result schema.
 *
 * Creates a schema structure where collectors are nested under
 * `properties.collectors.<collectorId>`, matching the actual data structure
 * stored by the health check executor.
 */
function mergeCollectorSchemas(
  strategySchema: Record<string, unknown> | undefined,
  collectorProperties: Record<string, unknown>,
): Record<string, unknown> | undefined {
  // If no collectors, return original schema
  if (Object.keys(collectorProperties).length === 0) {
    return strategySchema;
  }

  // Build the collectors nested schema
  const collectorsSchema = {
    type: "object",
    properties: collectorProperties,
  };

  // If no strategy schema, create one just with collectors
  if (!strategySchema) {
    return {
      type: "object",
      properties: {
        collectors: collectorsSchema,
      },
    };
  }

  // Merge: add collectors to existing properties
  const existingProps = (strategySchema.properties ?? {}) as Record<
    string,
    unknown
  >;
  return {
    ...strategySchema,
    properties: {
      ...existingProps,
      collectors: collectorsSchema,
    },
  };
}
