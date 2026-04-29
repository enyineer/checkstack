import React, { createContext, useContext, useCallback, useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  HealthCheckApi,
  type SystemHealthStatusResponse,
} from "@checkstack/healthcheck-common";
import {
  IncidentApi,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import {
  MaintenanceApi,
  type MaintenanceWithSystems,
} from "@checkstack/maintenance-common";

/**
 * Data structure for system badge data.
 */
export interface SystemBadgeData {
  health?: SystemHealthStatusResponse;
  incidents: IncidentWithSystems[];
  maintenances: MaintenanceWithSystems[];
}

/**
 * Context value provided by SystemBadgeDataProvider.
 */
interface SystemBadgeDataContextValue {
  getSystemBadgeData: (systemId: string) => SystemBadgeData | undefined;
  loading: boolean;
}

const SystemBadgeDataContext = createContext<
  SystemBadgeDataContextValue | undefined
>(undefined);

interface SystemBadgeDataProviderProps {
  systemIds: string[];
  children: React.ReactNode;
}

/**
 * Provider that bulk-fetches badge data (health, incidents, maintenances)
 * for multiple systems using TanStack Query and provides it via context.
 *
 * Realtime invalidation of `[["healthcheck"]]`, `[["incident"]]`, and
 * `[["maintenance"]]` is handled centrally by SignalAutoInvalidator — no
 * per-component signal handlers needed here.
 */
export const SystemBadgeDataProvider: React.FC<
  SystemBadgeDataProviderProps
> = ({ systemIds, children }) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const incidentClient = usePluginClient(IncidentApi);
  const maintenanceClient = usePluginClient(MaintenanceApi);

  // -------------------------------------------------------------------------
  // BULK QUERIES
  // -------------------------------------------------------------------------

  // Fetch bulk health status
  const { data: healthData, isLoading: healthLoading } =
    healthCheckClient.getBulkSystemHealthStatus.useQuery(
      { systemIds },
      { enabled: systemIds.length > 0, staleTime: 30_000 }
    );

  // Fetch bulk incidents
  const { data: incidentData, isLoading: incidentLoading } =
    incidentClient.getBulkIncidentsForSystems.useQuery(
      { systemIds },
      { enabled: systemIds.length > 0, staleTime: 30_000 }
    );

  // Fetch bulk maintenances
  const { data: maintenanceData, isLoading: maintenanceLoading } =
    maintenanceClient.getBulkMaintenancesForSystems.useQuery(
      { systemIds },
      { enabled: systemIds.length > 0, staleTime: 30_000 }
    );

  const loading = healthLoading || incidentLoading || maintenanceLoading;

  // -------------------------------------------------------------------------
  // CONTEXT VALUE
  // -------------------------------------------------------------------------

  const getSystemBadgeData = useCallback(
    (systemId: string): SystemBadgeData | undefined => {
      const health = healthData?.statuses[systemId];
      const incidents = incidentData?.incidents[systemId];
      const maintenances = maintenanceData?.maintenances[systemId];

      // Return undefined if no data loaded yet
      if (!health && !incidents && !maintenances) {
        return undefined;
      }

      return {
        health,
        incidents: incidents || [],
        maintenances: maintenances || [],
      };
    },
    [healthData, incidentData, maintenanceData]
  );

  const contextValue = useMemo(
    () => ({
      getSystemBadgeData,
      loading,
    }),
    [getSystemBadgeData, loading]
  );

  return (
    <SystemBadgeDataContext.Provider value={contextValue}>
      {children}
    </SystemBadgeDataContext.Provider>
  );
};

export function useSystemBadgeData(): SystemBadgeDataContextValue {
  const context = useContext(SystemBadgeDataContext);
  if (!context) {
    throw new Error(
      "useSystemBadgeData must be used within a SystemBadgeDataProvider"
    );
  }
  return context;
}

export function useSystemBadgeDataOptional():
  | SystemBadgeDataContextValue
  | undefined {
  return useContext(SystemBadgeDataContext);
}
