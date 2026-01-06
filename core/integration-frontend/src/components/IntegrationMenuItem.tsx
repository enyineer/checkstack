import { useNavigate } from "react-router-dom";
import { Webhook } from "lucide-react";
import { DropdownMenuItem } from "@checkmate-monitor/ui";
import { permissionApiRef, useApi } from "@checkmate-monitor/frontend-api";
import { resolveRoute } from "@checkmate-monitor/common";
import {
  integrationRoutes,
  permissions,
} from "@checkmate-monitor/integration-common";

export const IntegrationMenuItem = () => {
  const navigate = useNavigate();
  const permissionApi = useApi(permissionApiRef);
  const { allowed } = permissionApi.usePermission(
    permissions.integrationManage.id
  );

  if (!allowed) {
    return;
  }

  return (
    <DropdownMenuItem
      onClick={() => navigate(resolveRoute(integrationRoutes.routes.list))}
      icon={<Webhook className="h-4 w-4" />}
    >
      Integrations
    </DropdownMenuItem>
  );
};
