import React, { createContext, useContext, useCallback, useMemo } from "react";
import { usePluginClient, useQueryClient } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import {
  HealthCheckApi,
  HEALTH_CHECK_RUN_COMPLETED,
  type SystemHealthStatusResponse,
} from "@checkstack/healthcheck-common";
import {
  IncidentApi,
  INCIDENT_UPDATED,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import {
  MaintenanceApi,
  MAINTENANCE_UPDATED,
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
 */
export const SystemBadgeDataProvider: React.FC<
  SystemBadgeDataProviderProps
> = ({ systemIds, children }) => {
  const queryClient = useQueryClient();
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
  // SIGNAL HANDLERS - Invalidate queries on updates
  // -------------------------------------------------------------------------

  const refetchHealth = useCallback(
    (systemId: string) => {
      if (systemIds.includes(systemId)) {
        // Invalidate the bulk query to refetch
        queryClient.invalidateQueries({ queryKey: ["healthcheck"] });
      }
    },
    [systemIds, queryClient]
  );

  useSignal(HEALTH_CHECK_RUN_COMPLETED, ({ systemId }) => {
    refetchHealth(systemId);
  });

  const refetchIncidents = useCallback(
    (affectedSystemIds: string[]) => {
      const hasAffected = affectedSystemIds.some((id) =>
        systemIds.includes(id)
      );
      if (hasAffected) {
        queryClient.invalidateQueries({ queryKey: ["incident"] });
      }
    },
    [systemIds, queryClient]
  );

  useSignal(INCIDENT_UPDATED, ({ systemIds: affectedIds }) => {
    refetchIncidents(affectedIds);
  });

  const refetchMaintenances = useCallback(
    (affectedSystemIds: string[]) => {
      const hasAffected = affectedSystemIds.some((id) =>
        systemIds.includes(id)
      );
      if (hasAffected) {
        queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      }
    },
    [systemIds, queryClient]
  );

  useSignal(MAINTENANCE_UPDATED, ({ systemIds: affectedIds }) => {
    refetchMaintenances(affectedIds);
  });

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
