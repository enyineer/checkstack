import { createPermission } from "@checkmate-monitor/common";

export const permissions = {
  /** Configure retention policy and send broadcasts */
  notificationAdmin: createPermission(
    "notification",
    "manage",
    "Configure notification settings and send broadcasts"
  ),
};

export const permissionList = Object.values(permissions);
