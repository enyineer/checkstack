import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  incidentRoutes,
  incidentAccess,
  pluginMetadata,
} from "@checkstack/incident-common";

export const IncidentMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${incidentAccess.incident.manage.id}`;
  const canManage = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canManage) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(incidentRoutes.routes.config)}>
      <DropdownMenuItem icon={<AlertTriangle className="w-4 h-4" />}>
        Incidents
      </DropdownMenuItem>
    </Link>
  );
};
