import React from "react";
import { Link } from "react-router-dom";
import { ListOrdered } from "lucide-react";
import { useApi, permissionApiRef } from "@checkmate/frontend-api";
import { DropdownMenuItem } from "@checkmate/ui";
import { resolveRoute } from "@checkmate/common";
import { queueRoutes } from "@checkmate/queue-common";

export const QueueUserMenuItems = () => {
  const permissionApi = useApi(permissionApiRef);
  const { allowed: canRead, loading } = permissionApi.useResourcePermission(
    "queue",
    "read"
  );

  if (loading || !canRead) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(queueRoutes.routes.config)}>
      <DropdownMenuItem icon={<ListOrdered className="h-4 w-4" />}>
        Queue Settings
      </DropdownMenuItem>
    </Link>
  );
};
