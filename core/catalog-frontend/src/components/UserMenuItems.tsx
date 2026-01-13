import React from "react";
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  catalogRoutes,
  catalogAccess,
  pluginMetadata,
} from "@checkstack/catalog-common";

export const CatalogUserMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  // Use the access rule's id directly
  const qualifiedId = `${pluginMetadata.pluginId}.${catalogAccess.system.manage.id}`;
  const canManage = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canManage) {
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
