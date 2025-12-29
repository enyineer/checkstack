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
  rolesRead: {
    id: "roles.read",
    description: "Read and list roles",
  },
  rolesCreate: {
    id: "roles.create",
    description: "Create new roles",
  },
  rolesUpdate: {
    id: "roles.update",
    description: "Update role names and permissions",
  },
  rolesDelete: {
    id: "roles.delete",
    description: "Delete roles",
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
