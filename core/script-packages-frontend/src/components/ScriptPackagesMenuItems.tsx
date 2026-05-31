import React from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  scriptPackagesRoutes,
  scriptPackagesAccess,
  pluginMetadata,
} from "@checkstack/script-packages-common";

/**
 * "Script Packages" entry in the user/settings menu. Gated on
 * `script-packages.manage` (the page itself is also access-gated by the
 * route); hiding the link is the cleaner UX for unauthorised users.
 */
export const ScriptPackagesMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${scriptPackagesAccess.manage.id}`;
  const canManage = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canManage) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(scriptPackagesRoutes.routes.settings)}>
      <DropdownMenuItem icon={<Package className="w-4 h-4" />}>
        Script Packages
      </DropdownMenuItem>
    </Link>
  );
};
