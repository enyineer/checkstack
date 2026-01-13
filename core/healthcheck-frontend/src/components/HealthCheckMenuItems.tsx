import React from "react";
import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  healthcheckRoutes,
  healthCheckAccess,
  pluginMetadata,
} from "@checkstack/healthcheck-common";

export const HealthCheckMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${healthCheckAccess.configuration.read.id}`;
  const canRead = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canRead) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(healthcheckRoutes.routes.config)}>
      <DropdownMenuItem icon={<Activity className="w-4 h-4" />}>
        Health Checks
      </DropdownMenuItem>
    </Link>
  );
};
