import React from "react";
import { Link } from "react-router-dom";
import { Webhook } from "lucide-react";
import { DropdownMenuItem } from "@checkstack/ui";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  integrationRoutes,
  integrationAccess,
  pluginMetadata,
} from "@checkstack/integration-common";

/**
 * "Integrations" entry in the user menu. Links to the integrations landing
 * page (provider list); each provider links on to its connection-management
 * page. Gated on `integration.manage` — mirrors the access check the routes
 * themselves enforce, but hiding the link is the cleaner UX for users who
 * can't manage connections.
 */
export const IntegrationMenuItem = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${integrationAccess.manage.id}`;
  const allowed = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!allowed) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(integrationRoutes.routes.list)}>
      <DropdownMenuItem icon={<Webhook className="h-4 w-4" />}>
        Integrations
      </DropdownMenuItem>
    </Link>
  );
};
