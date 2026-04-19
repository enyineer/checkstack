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
import { CatalogSystemActionsSlot } from "@checkstack/catalog-common";
import {
  healthcheckRoutes,
  healthCheckAccess,
} from "@checkstack/healthcheck-common";
import { resolveRoute } from "@checkstack/common";

type Props = SlotContext<typeof CatalogSystemActionsSlot>;

/**
 * Extension slot button for the catalog system actions bar.
 * Navigates to the full-page Assignment IDE for the given system.
 */
export const SystemHealthCheckAssignment: React.FC<Props> = ({
  systemId,
}) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useAccess(
    healthCheckAccess.configuration.manage,
  );
  const navigate = useNavigate();

  // Fetch associations count for the badge
  const { data: associations = [] } =
    healthCheckClient.getSystemAssociations.useQuery(
      { systemId },
      { enabled: true },
    );

  if (!canManage) return;

  const assignmentUrl = resolveRoute(healthcheckRoutes.routes.assignments, {
    systemId,
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => navigate(assignmentUrl)}
      className="h-8 gap-1.5 border-dashed border-input hover:border-primary/30 hover:bg-primary/5"
    >
      <Activity className="h-3.5 w-3.5 text-primary" />
      <span className="text-xs font-medium">Health Checks</span>
      {associations.length > 0 && (
        <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
          {associations.length}
        </span>
      )}
    </Button>
  );
};
