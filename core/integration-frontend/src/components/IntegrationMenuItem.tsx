import { useNavigate } from "react-router-dom";
import { Webhook } from "lucide-react";
import { DropdownMenuItem } from "@checkstack/ui";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  integrationRoutes,
  integrationAccess,
  pluginMetadata,
} from "@checkstack/integration-common";
import React from "react";

export const IntegrationMenuItem = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const navigate = useNavigate();
  const qualifiedId = `${pluginMetadata.pluginId}.${integrationAccess.manage.id}`;
  const allowed = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!allowed) {
    return <React.Fragment />;
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
