import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  usePluginClient,
  type SlotContext,
} from "@checkstack/frontend-api";
import {
  SystemSignalsSlot,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  TracestreamApi,
  tracestreamAccess,
} from "@checkstack/tracestream-common";
import {
  chunkSystemIdsForStatusLookup,
  mergeLinkedStreamStatuses,
  type LinkedStreamStatus,
} from "@checkstack/telemetry-common";
import {
  TRACESTREAM_SIGNAL_SOURCE_ID,
  deriveTraceStreamSignals,
} from "../lib/linked-stream-signals";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Reports linked trace streams' recent error spikes as dashboard signals.
 * Bulk-fetches the linked-stream statuses for ALL overview systems and emits one
 * signal per affected stream, deep-linking to that stream. Headless filler for
 * {@link SystemSignalsSlot}.
 *
 * The dashboard passes EVERY visible system in one slot context, which can
 * exceed the status lookup's per-call cap (`MAX_SYSTEMS_PER_STATUS_LOOKUP`), so
 * the ids are chunked (`chunkSystemIdsForStatusLookup`) and the chunk results
 * merged by stream (`mergeLinkedStreamStatuses`) - otherwise a large deployment
 * would fail input validation and silently drop every signal. The
 * status->signal transform lives in the pure `deriveTraceStreamSignals` deriver
 * so it stays unit-tested and drift-free.
 */
export function TraceSignalsFiller({
  systemIds,
  onSignals,
  onLoadingChange,
}: Props) {
  const client = usePluginClient(TracestreamApi);

  const chunks = useMemo(
    () => chunkSystemIdsForStatusLookup(systemIds),
    [systemIds],
  );

  const { data: matches, isLoading } = useQuery<LinkedStreamStatus[]>({
    queryKey: ["tracestream", "linkedStreamStatuses", systemIds],
    enabled: systemIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const results = await Promise.all(
        chunks.map((chunk) =>
          client.listLinkedStreamStatuses.call({ systemIds: chunk }),
        ),
      );
      return mergeLinkedStreamStatuses(results);
    },
  });

  const signals = useMemo<SystemSignalsMap>(() => {
    if (!matches) return {};
    return deriveTraceStreamSignals({
      matches,
      accessRule: tracestreamAccess.read,
    });
  }, [matches]);

  useEffect(() => {
    onSignals(TRACESTREAM_SIGNAL_SOURCE_ID, signals);
  }, [signals, onSignals]);

  // Report load state so the dashboard holds its overview skeleton until this
  // (and every other source) has settled, instead of flashing "all healthy".
  useEffect(() => {
    if (systemIds.length === 0) return;
    onLoadingChange(TRACESTREAM_SIGNAL_SOURCE_ID, isLoading);
  }, [isLoading, systemIds.length, onLoadingChange]);

  return null;
}
