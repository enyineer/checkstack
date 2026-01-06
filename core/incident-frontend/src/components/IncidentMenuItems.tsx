import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useApi, permissionApiRef } from "@checkmate-monitor/frontend-api";
import { DropdownMenuItem } from "@checkmate-monitor/ui";
import { resolveRoute } from "@checkmate-monitor/common";
import { incidentRoutes } from "@checkmate-monitor/incident-common";

export const IncidentMenuItems = () => {
  const permissionApi = useApi(permissionApiRef);
  const { allowed: canManage, loading } = permissionApi.useResourcePermission(
    "incident",
    "manage"
  );

  if (loading || !canManage) {
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
