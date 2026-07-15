import React, { createContext, useContext, useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AnomalyApi } from "@checkstack/anomaly-common";

interface AnomalyBadgeDataContextValue {
  /**
   * The worst anomaly state for a system from the two bulk fetches, or
   * `undefined` when the system has no active/suspicious anomaly.
   */
  getSystemState: (systemId: string) => "anomaly" | "suspicious" | undefined;
  loading: boolean;
}

const AnomalyBadgeDataContext = createContext<
  AnomalyBadgeDataContextValue | undefined
>(undefined);

/**
 * Provider that fetches the active + suspicious anomaly sets ONCE and derives an
 * O(1) per-system lookup, so per-row `SystemAnomalyBadge`s read from context
 * instead of each instantiating its own live query observers and scanning the
 * (up to 500-element) arrays. Without this provider each badge falls back to its
 * own (deduped) queries, so surfaces that don't install it still work.
 *
 * The `getAnomalies` queries are unscoped (they return every active/suspicious
 * anomaly, capped at 500), so this provider ignores `systemIds` for fetching and
 * only uses the results to build the lookup once.
 */
export const AnomalyBadgeDataProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const anomalyClient = usePluginClient(AnomalyApi);

  const { data: confirmed = [], isLoading: confirmedLoading } =
    anomalyClient.getAnomalies.useQuery(
      { state: "anomaly", limit: 500 },
      { staleTime: 30_000 },
    );
  const { data: suspicious = [], isLoading: suspiciousLoading } =
    anomalyClient.getAnomalies.useQuery(
      { state: "suspicious", limit: 500 },
      { staleTime: 30_000 },
    );

  const contextValue = useMemo<AnomalyBadgeDataContextValue>(() => {
    const confirmedIds = new Set(confirmed.map((a) => a.systemId));
    const suspiciousIds = new Set(suspicious.map((a) => a.systemId));
    return {
      getSystemState: (systemId) => {
        if (confirmedIds.has(systemId)) return "anomaly";
        if (suspiciousIds.has(systemId)) return "suspicious";
        return;
      },
      loading: confirmedLoading || suspiciousLoading,
    };
  }, [confirmed, suspicious, confirmedLoading, suspiciousLoading]);

  return (
    <AnomalyBadgeDataContext.Provider value={contextValue}>
      {children}
    </AnomalyBadgeDataContext.Provider>
  );
};

export function useAnomalyBadgeDataOptional():
  | AnomalyBadgeDataContextValue
  | undefined {
  return useContext(AnomalyBadgeDataContext);
}
