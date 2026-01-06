import { createPermission, Permission } from "@checkmate-monitor/common";

export const permissions = {
  queueRead: createPermission(
    "queue-bullmq",
    "read",
    "View queue configuration and statistics"
  ),
  queueWrite: createPermission(
    "queue-bullmq",
    "manage",
    "Modify queue configuration"
  ),
};

export const permissionList: Permission[] = Object.values(permissions);
