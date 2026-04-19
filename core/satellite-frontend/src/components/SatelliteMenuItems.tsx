import React from "react";
import { Link } from "react-router-dom";
import { Satellite } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  satelliteRoutes,
  satelliteAccess,
  pluginMetadata,
} from "@checkstack/satellite-common";

export const SatelliteMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${satelliteAccess.satellite.read.id}`;
  const canRead = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canRead) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(satelliteRoutes.routes.list)}>
      <DropdownMenuItem icon={<Satellite className="w-4 h-4" />}>
        Satellites
      </DropdownMenuItem>
    </Link>
  );
};
