import React from "react";
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import { useApi, permissionApiRef } from "@checkmate-monitor/frontend-api";
import { DropdownMenuItem } from "@checkmate-monitor/ui";
import { resolveRoute } from "@checkmate-monitor/common";
import { catalogRoutes } from "@checkmate-monitor/catalog-common";

export const CatalogUserMenuItems = () => {
  const permissionApi = useApi(permissionApiRef);
  const { allowed: canManage, loading } =
    permissionApi.useManagePermission("catalog");

  if (loading || !canManage) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(catalogRoutes.routes.config)}>
      <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>
        Catalog Settings
      </DropdownMenuItem>
    </Link>
  );
};
