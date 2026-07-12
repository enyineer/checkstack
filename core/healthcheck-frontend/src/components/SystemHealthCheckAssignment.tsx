import React from "react";
import {
  usePluginClient,
  type SlotContext,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import { Button } from "@checkstack/ui";
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

type Props = SlotContext<typeof CatalogSystemActionsSlot>;

/**
 * Extension slot button for the catalog system actions bar - a WAYFINDING
 * link, not a management surface: assignments are managed in the check
 * editor's Assignment section. Opens the Health Checks list filtered to this
 * system, from where each check (and its assignment settings) is one click
 * away.
 */
export const SystemHealthCheckAssignment: React.FC<Props> = ({
  systemId,
  visibleSystemIds,
}) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  // The same capability gate as the Health Checks list route this navigates
  // to (global manage, a healthcheck team grant, or - via parentType - a
  // system team grant). The old global-only `useAccess` hid the button from
  // every team-scoped user.
  const { allowed: canManageCapability } = accessApi.useCanAccessType({
    accessRule: healthCheckAccess.configuration.manage,
    objectType: healthCheckResourceTypes.configuration,
    parentType: catalogResourceTypes.system,
  });
  // Managing what runs on a system requires MANAGE on the system (enforced
  // backend-side by `associateSystem` / `createAndAssign`). Resolve the
  // manageable subset for the WHOLE visible list in ONE request: every row
  // passes the same `visibleSystemIds`, so these identical-input queries
  // dedupe to a single `listMyAccessibleResources` call (same pattern as the
  // counts query below). `canManageSystem(systemId)` then checks THIS row.
  const { canAccess: canManageSystem } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: visibleSystemIds,
  });
  const navigate = useNavigate();

  // Assigned-check counts for the badge, bulk-fetched for the WHOLE visible list
  // in ONE request. Every row of the list passes the same `visibleSystemIds`, so
  // these identical-input queries dedupe to a single network call instead of the
  // old getSystemAssociations N+1 (one pooled connection per row, contending with
  // the run executor). Read-gated per system on the backend (`recordKey`), so a
  // count for a system the caller cannot read is simply absent. Auto-invalidated
  // with the rest of `[["healthcheck"]]` when an assignment changes, so the badge
  // stays current.
  const { data: countsData } =
    healthCheckClient.getBulkAssignedHealthCheckCounts.useQuery(
      { systemIds: visibleSystemIds },
      { enabled: visibleSystemIds.length > 0, staleTime: 30_000 },
    );
  const assignedCount = countsData?.counts[systemId] ?? 0;

  if (!canManageCapability || !canManageSystem(systemId)) return;

  const filteredListUrl = `${resolveRoute(
    healthcheckRoutes.routes.config,
  )}?${HEALTHCHECK_LIST_PARAM.system}=${encodeURIComponent(systemId)}`;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => navigate(filteredListUrl)}
      className="h-8 gap-1.5 border-dashed border-input hover:border-primary/30 hover:bg-primary/5"
    >
      <Activity className="h-3.5 w-3.5 text-primary" />
      <span className="text-xs font-medium">Manage health checks</span>
      {assignedCount > 0 && (
        <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
          {assignedCount}
        </span>
      )}
    </Button>
  );
};
