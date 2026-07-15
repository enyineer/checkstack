import React from "react";
import {
  usePluginClient,
  type SlotContext,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { RowAction } from "@checkstack/ui";
import { Activity } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  CatalogSystemActionsSlot,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import {
  healthcheckRoutes,
  healthCheckAccess,
  healthCheckResourceTypes,
} from "@checkstack/healthcheck-common";
import { resolveRoute } from "@checkstack/common";
import { HEALTHCHECK_LIST_PARAM } from "./healthCheckListState.logic";
import { useCatalogSystemHealthCheckDataOptional } from "./CatalogSystemHealthCheckDataProvider";

type Props = SlotContext<typeof CatalogSystemActionsSlot>;

/**
 * Presentational health-check wayfinding action for a system row: a RowAction
 * that opens the Health Checks list filtered to this system, badged with the
 * assigned-check count. Hidden unless the caller may manage checks AND this
 * system. Calls NO data/access hooks itself - the verdict + count are resolved
 * once (per visible list) and passed in.
 */
const HealthCheckActionView: React.FC<{
  systemId: string;
  canManageCapability: boolean;
  canManageSystem: boolean;
  count: number;
}> = ({ systemId, canManageCapability, canManageSystem, count }) => {
  const navigate = useNavigate();

  if (!canManageCapability || !canManageSystem) return null;

  const filteredListUrl = `${resolveRoute(
    healthcheckRoutes.routes.config,
  )}?${HEALTHCHECK_LIST_PARAM.system}=${encodeURIComponent(systemId)}`;
  const label =
    count > 0
      ? `${count} health check${count === 1 ? "" : "s"} assigned - view`
      : "View health checks";

  return (
    <RowAction
      icon={Activity}
      label={label}
      badge={count > 0 ? count : undefined}
      onClick={() => navigate(filteredListUrl)}
    />
  );
};

/**
 * Standalone path for surfaces WITHOUT the catalog bulk provider (e.g. the
 * system detail page): resolves the gate + count with its own hooks. On the
 * catalog manager the provider path (below) is taken instead, so a table of rows
 * never runs these per row.
 */
const HealthCheckActionStandalone: React.FC<{
  systemId: string;
  visibleSystemIds: string[];
}> = ({ systemId, visibleSystemIds }) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  // The same capability gate as the Health Checks list route this navigates to
  // (global manage, a healthcheck team grant, or - via parentType - a system
  // team grant).
  const { allowed: canManageCapability } = accessApi.useCanAccessType({
    accessRule: healthCheckAccess.configuration.manage,
    objectType: healthCheckResourceTypes.configuration,
    parentType: catalogResourceTypes.system,
  });
  // Managing what runs on a system requires MANAGE on the system. Bulk-resolved
  // over `visibleSystemIds` (identical-input queries dedupe to one call).
  const { canAccess: canManageSystem } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: visibleSystemIds,
  });
  const { data: countsData } =
    healthCheckClient.getBulkAssignedHealthCheckCounts.useQuery(
      { systemIds: visibleSystemIds },
      { enabled: visibleSystemIds.length > 0, staleTime: 30_000 },
    );

  return (
    <HealthCheckActionView
      systemId={systemId}
      canManageCapability={canManageCapability}
      canManageSystem={canManageSystem(systemId)}
      count={countsData?.counts[systemId] ?? 0}
    />
  );
};

/**
 * Fills catalog's `CatalogSystemActionsSlot`: a WAYFINDING link to the Health
 * Checks list filtered to this system (assignments are managed in the check
 * editor). On the catalog manager it reads its gate + count from the
 * `CatalogSystemHealthCheckDataProvider` (one resolution for the whole visible
 * list, no per-row access hooks); elsewhere it falls back to resolving them
 * itself. Only ONE branch renders per instance, so the heavy path is never
 * mounted when the provider is present.
 */
export const SystemHealthCheckAssignment: React.FC<Props> = ({
  systemId,
  visibleSystemIds,
}) => {
  const bulk = useCatalogSystemHealthCheckDataOptional();
  if (bulk) {
    return (
      <HealthCheckActionView
        systemId={systemId}
        canManageCapability={bulk.canManageCapability}
        canManageSystem={bulk.canManageSystem(systemId)}
        count={bulk.getCount(systemId)}
      />
    );
  }
  return (
    <HealthCheckActionStandalone
      systemId={systemId}
      visibleSystemIds={visibleSystemIds}
    />
  );
};
