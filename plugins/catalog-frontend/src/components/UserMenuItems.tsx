import React from "react";
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import { useApi, permissionApiRef } from "@checkmate/frontend-api";
import { DropdownMenuItem } from "@checkmate/ui";

export const CatalogUserMenuItems = () => {
  const permissionApi = useApi(permissionApiRef);
  const canManage = permissionApi.usePermission("catalog.manage");

  if (!canManage) {
    return <React.Fragment />;
  }

  return (
    <Link to="/catalog/config">
      <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>
        Catalog Settings
      </DropdownMenuItem>
    </Link>
  );
};
