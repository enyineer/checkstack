import React, { createContext, useContext, useCallback, useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import type { SloObjective, SloStatus } from "@checkstack/slo-common";
import { SloApi } from "../api";

/**
 * A single system's SLO objective + its evaluated status. This is the exact
 * array element returned by `getObjectivesForSystem` (per-system) and, in bulk,
 * by `getBulkObjectivesForSystems` (per `systems[systemId]` element). The badge
 * reads `status.isBreaching` / `status.hasOpenDowntime` /
 * `status.errorBudgetRemainingPercent` off it unchanged.
 */
export interface SloBadgeObjective {
  objective: SloObjective;
  status: SloStatus;
}

/**
 * Context value provided by SloBadgeDataProvider.
 */
interface SloBadgeDataContextValue {
  /**
   * Objectives for a system from the bulk fetch, or `undefined` while the bulk
   * query is still loading / the system is absent from the response.
   */
  getObjectives: (systemId: string) => SloBadgeObjective[] | undefined;
  loading: boolean;
}

const SloBadgeDataContext = createContext<SloBadgeDataContextValue | undefined>(
  undefined,
);

interface SloBadgeDataProviderProps {
  systemIds: string[];
  children: React.ReactNode;
}

/**
 * Provider that bulk-fetches SLO objectives for multiple systems using TanStack
 * Query and provides them via context, so per-row `SystemSloBadge`s read the
 * bulk-fetched data instead of each issuing a per-system RPC.
 *
 * Realtime invalidation of `[["slo"]]` is handled centrally by
 * SignalAutoInvalidator — no per-component signal handlers needed here.
 */
export const SloBadgeDataProvider: React.FC<SloBadgeDataProviderProps> = ({
  systemIds,
  children,
}) => {
  const sloClient = usePluginClient(SloApi);

  const { data, isLoading } = sloClient.getBulkObjectivesForSystems.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const getObjectives = useCallback(
    (systemId: string): SloBadgeObjective[] | undefined =>
      data?.systems[systemId],
    [data],
  );

  const contextValue = useMemo(
    () => ({
      getObjectives,
      loading: isLoading,
    }),
    [getObjectives, isLoading],
  );

  return (
    <SloBadgeDataContext.Provider value={contextValue}>
      {children}
    </SloBadgeDataContext.Provider>
  );
};

export function useSloBadgeData(): SloBadgeDataContextValue {
  const context = useContext(SloBadgeDataContext);
  if (!context) {
    throw new Error("useSloBadgeData must be used within a SloBadgeDataProvider");
  }
  return context;
}

export function useSloBadgeDataOptional(): SloBadgeDataContextValue | undefined {
  return useContext(SloBadgeDataContext);
}
