import React from "react";
import { Link } from "react-router-dom";
import { Server } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  infrastructureRoutes,
  getInfrastructureTabs,
} from "@checkstack/infrastructure-common";

/**
 * User menu item pointing to Infrastructure Settings.
 * Only visible if the user has read access to at least one infrastructure tab.
 */
export const InfrastructureUserMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  // Check if user has access to ANY infrastructure tab's read permission
  const tabs = getInfrastructureTabs();
  const canReadAny = tabs.some((tab) => {
    const qualifiedId = `${tab.pluginId}.${tab.readAccess.id}`;
    return userPerms.includes("*") || userPerms.includes(qualifiedId);
  });

  if (!canReadAny) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(infrastructureRoutes.routes.config)}>
      <DropdownMenuItem icon={<Server className="h-4 w-4" />}>
        Infrastructure Settings
      </DropdownMenuItem>
    </Link>
  );
};
