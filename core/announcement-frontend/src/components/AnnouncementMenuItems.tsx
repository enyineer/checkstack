import React from "react";
import { Link } from "react-router-dom";
import { Megaphone } from "lucide-react";
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  announcementRoutes,
  announcementAccess,
  pluginMetadata,
} from "@checkstack/announcement-common";

export const AnnouncementMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = `${pluginMetadata.pluginId}.${announcementAccess.manage.id}`;
  const canManage = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canManage) {
    return <React.Fragment />;
  }

  return (
    <Link to={resolveRoute(announcementRoutes.routes.manage)}>
      <DropdownMenuItem icon={<Megaphone className="w-4 h-4" />}>
        Announcements
      </DropdownMenuItem>
    </Link>
  );
};
