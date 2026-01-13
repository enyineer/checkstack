import React from "react";
import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  maintenanceRoutes,
  maintenanceAccess,
  pluginMetadata,
} from "@checkstack/maintenance-common";

export const MaintenanceMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${maintenanceAccess.maintenance.manage.id}`;
  const canManage = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canManage) {
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
