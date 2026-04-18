import { Link } from "react-router-dom";
import { Target, Settings } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { sloRoutes, sloAccess, pluginMetadata } from "@checkstack/slo-common";

export const SloMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${sloAccess.slo.manage.id}`;
  const canManage = userPerms.includes("*") || userPerms.includes(qualifiedId);

  return (
    <>
      <Link to={resolveRoute(sloRoutes.routes.overview)}>
        <DropdownMenuItem icon={<Target className="w-4 h-4" />}>
          SLO Dashboard
        </DropdownMenuItem>
      </Link>
      {canManage && (
        <Link to={resolveRoute(sloRoutes.routes.config)}>
          <DropdownMenuItem icon={<Settings className="w-4 h-4" />}>
            SLO Management
          </DropdownMenuItem>
        </Link>
      )}
    </>
  );
};
