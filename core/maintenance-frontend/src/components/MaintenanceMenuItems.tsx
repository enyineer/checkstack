import React from "react";
import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { useApi, permissionApiRef } from "@checkmate-monitor/frontend-api";
import { DropdownMenuItem } from "@checkmate-monitor/ui";
import { resolveRoute } from "@checkmate-monitor/common";
import { maintenanceRoutes } from "@checkmate-monitor/maintenance-common";

export const MaintenanceMenuItems = () => {
  const permissionApi = useApi(permissionApiRef);
  const { allowed: canManage, loading } = permissionApi.useResourcePermission(
    "maintenance",
    "manage"
  );

  if (loading || !canManage) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(maintenanceRoutes.routes.config)}>
      <DropdownMenuItem icon={<Wrench className="w-4 h-4" />}>
        Maintenances
      </DropdownMenuItem>
    </Link>
  );
};
