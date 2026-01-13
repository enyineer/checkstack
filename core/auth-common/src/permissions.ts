import type { Permission } from "@checkstack/common";

export const permissions = {
  usersRead: {
    id: "users.read",
    description: "List all users",
  },
  usersCreate: {
    id: "users.create",
    description: "Create new users (credential strategy)",
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
    description: "Manage authentication strategies and settings",
  },
  registrationManage: {
    id: "registration.manage",
    description: "Manage user registration settings",
  },
  applicationsManage: {
    id: "applications.manage",
    description: "Create, update, delete, and view external applications",
  },
  teamsRead: {
    id: "teams.read",
    description: "View teams and team memberships",
  },
  teamsManage: {
    id: "teams.manage",
    description: "Create, delete, and manage all teams and resource access",
  },
} satisfies Record<string, Permission>;

export const permissionList = Object.values(permissions);
