import React, { createContext, useContext, useMemo } from "react";
import { usePluginClient, useApi, accessApiRef } from "@checkstack/frontend-api";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { catalogAccess, catalogResourceTypes } from "@checkstack/catalog-common";
import {
  healthCheckAccess,
  healthCheckResourceTypes,
} from "@checkstack/healthcheck-common";

export interface CatalogSystemHealthCheckData {
  /** Type-level: may the caller manage health-check configuration at all. */
  canManageCapability: boolean;
  /** Per-system MANAGE verdict (the backend gates assignments per system). */
  canManageSystem: (systemId: string) => boolean;
  /** Assigned-check count for the badge. */
  getCount: (systemId: string) => number;
}

const Ctx = createContext<CatalogSystemHealthCheckData | undefined>(undefined);

/**
 * Resolves the health-check row-action's gate + assigned-count for the WHOLE
 * visible system list ONCE, and provides it via context. Without this, every
 * catalog-manager row mounts `SystemHealthCheckAssignment`, which calls TWO
 * allocation-heavy access hooks (`useCanAccessType` + `useResourceAccess`, each
 * instantiating React Query observers) plus a counts query PER ROW - the
 * dominant GC-bound cost of opening the Systems tab. Folded around the catalog
 * tree via `CatalogBrowseDataBoundarySlot`, it collapses that to one call each.
 */
export const CatalogSystemHealthCheckDataProvider: React.FC<{
  systemIds: string[];
  children: React.ReactNode;
}> = ({ systemIds, children }) => {
  const accessApi = useApi(accessApiRef);
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const { allowed: canManageCapability } = accessApi.useCanAccessType({
    accessRule: healthCheckAccess.configuration.manage,
    objectType: healthCheckResourceTypes.configuration,
    parentType: catalogResourceTypes.system,
  });
  const { canAccess: canManageSystem } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: systemIds,
  });
  const { data: countsData } =
    healthCheckClient.getBulkAssignedHealthCheckCounts.useQuery(
      { systemIds },
      { enabled: systemIds.length > 0, staleTime: 30_000 },
    );

  const value = useMemo<CatalogSystemHealthCheckData>(
    () => ({
      canManageCapability,
      canManageSystem,
      getCount: (systemId) => countsData?.counts[systemId] ?? 0,
    }),
    [canManageCapability, canManageSystem, countsData],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useCatalogSystemHealthCheckDataOptional():
  | CatalogSystemHealthCheckData
  | undefined {
  return useContext(Ctx);
}
