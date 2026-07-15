import React, { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import {
  SystemSignalsSlot,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import { MetricstreamApi, pluginMetadata } from "@checkstack/metricstream-common";
import {
  chunkSystemIdsForStatusLookup,
  mergeLinkedStreamStatuses,
} from "@checkstack/telemetry-common";
import {
  METRICSTREAM_SIGNAL_SOURCE_ID,
  deriveMetricstreamSignals,
} from "../lib/system-signals.logic";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Reports linked metric streams' scrape failures / cardinality overflows as
 * dashboard signals. Headless filler for {@link SystemSignalsSlot}.
 *
 * CHUNKED: the dashboard passes EVERY visible system in one slot context, which
 * can exceed the status lookup's input cap (`MAX_SYSTEMS_PER_STATUS_LOOKUP`). A
 * single over-cap call would fail input validation and the metric signals would
 * silently vanish while other sources still worked. So we split the ids into
 * capped chunks, fetch each, and MERGE by stream id (a stream linked to systems
 * in two chunks appears in both results). All chunks live under ONE React Query
 * entry (namespaced to this plugin) so it stays cached and is refreshed by the
 * plugin's signal auto-invalidator.
 *
 * The status->signal transform lives in the shared `deriveMetricstreamSignals`
 * deriver so it stays pure and unit-tested.
 */
export const MetricSignalsFiller: React.FC<Props> = ({
  systemIds,
  onSignals,
  onLoadingChange,
}) => {
  const client = usePluginClient(MetricstreamApi);

  const { data, isLoading } = useQuery({
    // Namespaced under the plugin id so the signal auto-invalidator
    // (invalidateQueries `[[pluginId]]`) refreshes this query too.
    queryKey: [
      [pluginMetadata.pluginId],
      "listLinkedStreamStatuses:chunked",
      systemIds,
    ],
    enabled: systemIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const chunks = chunkSystemIdsForStatusLookup(systemIds);
      const results = await Promise.all(
        chunks.map((chunk) =>
          client.listLinkedStreamStatuses.call({ systemIds: chunk }),
        ),
      );
      return mergeLinkedStreamStatuses(results);
    },
  });

  const signals = useMemo<SystemSignalsMap>(() => {
    if (!data) return {};
    return deriveMetricstreamSignals({ statuses: data });
  }, [data]);

  useEffect(() => {
    onSignals(METRICSTREAM_SIGNAL_SOURCE_ID, signals);
  }, [signals, onSignals]);

  // Report load state so the dashboard holds its overview skeleton until this
  // (and every other source) has settled, instead of flashing "all healthy".
  useEffect(() => {
    if (systemIds.length === 0) return;
    onLoadingChange(METRICSTREAM_SIGNAL_SOURCE_ID, isLoading);
  }, [isLoading, systemIds.length, onLoadingChange]);

  return null;
};
