import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import {
  chunkSystemIdsForStatusLookup,
  mergeLinkedStreamStatuses,
  type LinkedStreamStatus,
} from "@checkstack/telemetry-common";
import {
  shouldFetchLinkedStreamStatuses,
  isLinkedStreamSignalsLoading,
} from "../lib/linked-stream-signals.logic";

/** Stable empty result so a not-yet-loaded query derives a stable empty map. */
const NO_STATUSES: readonly LinkedStreamStatus[] = [];

export interface UseLinkedStreamSignalsOptions<TSignals> {
  /** The owning plugin's id - namespaces the query for signal invalidation. */
  pluginId: string;
  /** This signal source's stable id, as reported to the dashboard. */
  sourceId: string;
  /** Every system currently visible on the dashboard overview. */
  systemIds: string[];
  /** One chunk's bulk status lookup (the plugin's own RPC client call). */
  fetchStatuses: (args: {
    systemIds: string[];
  }) => Promise<{ matches: LinkedStreamStatus[] }>;
  /**
   * The plugin's pure status -> signals deriver. MUST be referentially stable
   * (declare it at module scope or memoize it) - it is a memo dependency.
   */
  deriveSignals: (statuses: readonly LinkedStreamStatus[]) => TSignals;
  /** The slot context's signal reporter. */
  onSignals: (sourceId: string, signals: TSignals) => void;
  /** The slot context's load-state reporter. */
  onLoadingChange: (sourceId: string, loading: boolean) => void;
}

/**
 * Shared engine for the three stream plugins' dashboard signal fillers
 * (logstream / metricstream / tracestream). They differ only in their client,
 * source id and deriver, so the fetch/chunk/merge/report machinery lives here
 * once instead of being copied three times.
 *
 * CHUNKED: the dashboard passes EVERY visible system in one slot context, which
 * can exceed the status lookup's input cap (`MAX_SYSTEMS_PER_STATUS_LOOKUP`). A
 * single over-cap call would fail input validation and the signals would
 * silently vanish while other sources still worked. So the ids are split into
 * capped chunks, fetched, and MERGED by stream id (a stream linked to systems in
 * two chunks appears in both results). All chunks live under ONE React Query
 * entry, namespaced under the owning plugin id so the plugin's signal
 * auto-invalidator (`invalidateQueries [[pluginId]]`) refreshes it.
 *
 * AUTHENTICATED-ONLY: `listLinkedStreamStatuses` requires a session, but the
 * dashboard is reachable anonymously, so the query is gated on the caller being
 * authenticated (see `shouldFetchLinkedStreamStatuses`).
 *
 * Headless: returns nothing and renders nothing; it reports through the slot
 * context callbacks.
 */
export function useLinkedStreamSignals<TSignals>({
  pluginId,
  sourceId,
  systemIds,
  fetchStatuses,
  deriveSignals,
  onSignals,
  onLoadingChange,
}: UseLinkedStreamSignalsOptions<TSignals>): void {
  const accessApi = useApi(accessApiRef);
  const { loading: authLoading, isAuthenticated } =
    accessApi.useIsAuthenticated();

  const { data, isLoading } = useQuery({
    queryKey: [[pluginId], "listLinkedStreamStatuses:chunked", systemIds],
    enabled: shouldFetchLinkedStreamStatuses({
      systemIdCount: systemIds.length,
      isAuthenticated,
    }),
    staleTime: 30_000,
    queryFn: async () => {
      const chunks = chunkSystemIdsForStatusLookup(systemIds);
      const results = await Promise.all(
        chunks.map((chunk) => fetchStatuses({ systemIds: chunk })),
      );
      return mergeLinkedStreamStatuses(results);
    },
  });

  const signals = useMemo(
    () => deriveSignals(data ?? NO_STATUSES),
    [data, deriveSignals],
  );

  useEffect(() => {
    onSignals(sourceId, signals);
  }, [sourceId, signals, onSignals]);

  // Report load state so the dashboard holds its overview skeleton until this
  // (and every other source) has settled, instead of flashing "all healthy".
  useEffect(() => {
    if (systemIds.length === 0) return;
    onLoadingChange(
      sourceId,
      isLinkedStreamSignalsLoading({
        queryLoading: isLoading,
        authLoading,
      }),
    );
  }, [sourceId, isLoading, authLoading, systemIds.length, onLoadingChange]);
}
