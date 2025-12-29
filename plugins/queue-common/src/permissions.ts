import { createPermission } from "@checkmate/common";

/**
 * Permissions for queue settings
 */
export const permissions = {
  queueRead: createPermission("queue", "read", "Read Queue Settings"),
  queueManage: createPermission("queue", "manage", "Update Queue Settings"),
};

export const permissionList = Object.values(permissions);
