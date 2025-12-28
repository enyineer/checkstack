import React from "react";
import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import { useApi, permissionApiRef } from "@checkmate/frontend-api";
import { DropdownMenuItem } from "@checkmate/ui";

export const HealthCheckMenuItems = () => {
  const permissionApi = useApi(permissionApiRef);
  const { allowed: canRead, loading } = permissionApi.useResourcePermission(
    "healthcheck",
    "read"
  );

  if (loading || !canRead) {
    return <React.Fragment />;
  }

  return (
    <Link to="/healthcheck/config">
      <DropdownMenuItem icon={<Activity className="w-4 h-4" />}>
        Health Checks
      </DropdownMenuItem>
    </Link>
  );
};
