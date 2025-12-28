import type { Permission } from "@checkmate/common";

export const permissions = {
  usersRead: {
    id: "users.read",
    description: "List all users",
  },
  usersManage: {
    id: "users.manage",
    description: "Delete users",
  },
  rolesManage: {
    id: "roles.manage",
    description: "Assign roles to users",
  },
  strategiesManage: {
    id: "strategies.manage",
    description: "Enable/disable auth strategies",
  },
} satisfies Record<string, Permission>;

export const permissionList = Object.values(permissions);
