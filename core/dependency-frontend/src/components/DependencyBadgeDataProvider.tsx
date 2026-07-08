import React, { createContext, useContext, useCallback, useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  DependencyApi,
  type DependencyWarning,
} from "@checkstack/dependency-common";

/**
 * Context value provided by DependencyBadgeDataProvider.
 */
interface DependencyBadgeDataContextValue {
  getWarning: (systemId: string) => DependencyWarning | undefined;
}

const DependencyBadgeDataContext = createContext<
  DependencyBadgeDataContextValue | undefined
>(undefined);

interface DependencyBadgeDataProviderProps {
  systemIds: string[];
  children: React.ReactNode;
}

/**
 * Provider that bulk-fetches dependency warnings for multiple systems using
 * TanStack Query and provides them via context, so the per-row DependencyBadge
 * reads the bulk-fetched warning from context instead of each issuing a
 * per-system `getWarningsForSystem` RPC.
 *
 * The bulk `getWarnings` returns a Record keyed by system id; a system with no
 * warning is simply ABSENT from the record, which is exactly equivalent to the
 * singular endpoint returning `null` for that system (both handlers derive from
 * the same `evaluateWarnings` computation). `getWarning` therefore returns
 * `undefined` while loading, when no provider is mounted, or when the system has
 * no warning — matching the badge's existing `if (!data) return;` guard.
 *
 * Realtime invalidation of `[["dependency"]]` is handled centrally by
 * SignalAutoInvalidator — no per-component signal handlers needed here.
 */
export const DependencyBadgeDataProvider: React.FC<
  DependencyBadgeDataProviderProps
> = ({ systemIds, children }) => {
  const depClient = usePluginClient(DependencyApi);

  const { data } = depClient.getWarnings.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const getWarning = useCallback(
    (systemId: string): DependencyWarning | undefined =>
      data?.warnings[systemId],
    [data],
  );

  const contextValue = useMemo(() => ({ getWarning }), [getWarning]);

  return (
    <DependencyBadgeDataContext.Provider value={contextValue}>
      {children}
    </DependencyBadgeDataContext.Provider>
  );
};

export function useDependencyBadgeDataOptional():
  | DependencyBadgeDataContextValue
  | undefined {
  return useContext(DependencyBadgeDataContext);
}
