import { access, accessPair, type AccessRule } from "@checkstack/common";

/**
 * Access rules for the Auth plugin.
 *
 * Auth has fine-grained access rules for different operations
 * on users, roles, teams, strategies, etc.
 */
export const authAccess = {
  /**
   * User management access rules.
   */
  users: {
    read: access("users", "read", "List all users"),
    create: access(
      "users.create",
      "manage",
      "Create new users (credential strategy)"
    ),
    manage: access("users", "manage", "Delete users"),
  },

  /**
   * Role management access rules.
   */
  roles: {
    read: access("roles", "read", "Read and list roles"),
    create: access("roles.create", "manage", "Create new roles"),
    update: access(
      "roles.update",
      "manage",
      "Update role names and access rules"
    ),
    delete: access("roles.delete", "manage", "Delete roles"),
    manage: access("roles", "manage", "Assign roles to users"),
  },

  /**
   * Authentication strategy management.
   */
  strategies: access(
    "strategies",
    "manage",
    "Manage authentication strategies and settings"
  ),

  /**
   * Registration settings management.
   */
  registration: access(
    "registration",
    "manage",
    "Manage user registration settings"
  ),

  /**
   * External application management.
   */
  applications: access(
    "applications",
    "manage",
    "Create, update, delete, and view external applications"
  ),

  /**
   * Team management access rules.
   */
  teams: accessPair("teams", {
    read: "View teams and team memberships",
    manage: "Create, delete, and manage all teams and resource access",
  }),
};

/**
 * All access rules for registration with the plugin system.
 */
export const authAccessRules: AccessRule[] = [
  authAccess.users.read,
  authAccess.users.create,
  authAccess.users.manage,
  authAccess.roles.read,
  authAccess.roles.create,
  authAccess.roles.update,
  authAccess.roles.delete,
  authAccess.roles.manage,
  authAccess.strategies,
  authAccess.registration,
  authAccess.applications,
  authAccess.teams.read,
  authAccess.teams.manage,
];
