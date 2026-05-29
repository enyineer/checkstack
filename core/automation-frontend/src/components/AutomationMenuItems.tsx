import React from "react";
import { Link } from "react-router-dom";
import { Workflow } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  automationRoutes,
  automationAccess,
  pluginMetadata,
} from "@checkstack/automation-common";

/**
 * "Automations" entry in the user menu. Only renders for users with
 * `automation.read` access — mirrors `incident-frontend`'s pattern of
 * gating the menu item rather than the underlying route (the route is
 * also access-gated by `createFrontendPlugin`, but hiding the link is
 * the cleaner UX for unauthorised users).
 */
export const AutomationMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${automationAccess.read.id}`;
  const canRead = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canRead) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(automationRoutes.routes.list)}>
      <DropdownMenuItem icon={<Workflow className="w-4 h-4" />}>
        Automations
      </DropdownMenuItem>
    </Link>
  );
};
