import { createPermission, type Permission } from "@checkmate/common";

export const permissions = {
  /** Read access to maintenances - granted to all authenticated users by default */
  maintenanceRead: createPermission(
    "maintenance",
    "read",
    "View planned maintenances",
    { isAuthenticatedDefault: true, isPublicDefault: true }
  ),
  /** Manage maintenances - create, edit, delete, and add updates */
  maintenanceManage: createPermission(
    "maintenance",
    "manage",
    "Manage planned maintenances"
  ),
} as const satisfies Record<string, Permission>;

export const permissionList = Object.values(permissions);
