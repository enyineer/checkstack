import { createPermission, type Permission } from "@checkmate-monitor/common";

export const permissions = {
  /** Read access to incidents - granted to all users by default */
  incidentRead: createPermission("incident", "read", "View incidents", {
    isAuthenticatedDefault: true,
    isPublicDefault: true,
  }),
  /** Manage incidents - create, edit, resolve, and delete */
  incidentManage: createPermission("incident", "manage", "Manage incidents"),
} as const satisfies Record<string, Permission>;

export const permissionList = Object.values(permissions);
