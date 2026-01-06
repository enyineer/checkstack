import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { DropdownMenuItem } from "@checkmate-monitor/ui";
import { resolveRoute } from "@checkmate-monitor/common";
import { notificationRoutes } from "@checkmate-monitor/notification-common";

export const NotificationUserMenuItems = () => {
  return (
    <Link to={resolveRoute(notificationRoutes.routes.settings)}>
      <DropdownMenuItem icon={<Bell className="h-4 w-4" />}>
        Notification Settings
      </DropdownMenuItem>
    </Link>
  );
};
