import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { DropdownMenuItem } from "@checkmate/ui";
import { resolveRoute } from "@checkmate/common";
import { notificationRoutes } from "@checkmate/notification-common";

export const NotificationUserMenuItems = () => {
  return (
    <Link to={resolveRoute(notificationRoutes.routes.settings)}>
      <DropdownMenuItem icon={<Bell className="h-4 w-4" />}>
        Notification Settings
      </DropdownMenuItem>
    </Link>
  );
};
