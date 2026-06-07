import { access, accessPair, type AccessRule } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";

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
    read: access("users", "read", "List all users", {
      pluginId: pluginMetadata.pluginId,
    }),
    create: access(
      "users.create",
      "manage",
      "Create new users (credential strategy)",
      { pluginId: pluginMetadata.pluginId },
    ),
    manage: access("users", "manage", "Delete users", {
      pluginId: pluginMetadata.pluginId,
    }),
  },

  /**
   * Role management access rules.
   */
  roles: {
    read: access("roles", "read", "Read and list roles", {
      pluginId: pluginMetadata.pluginId,
    }),
    create: access("roles.create", "manage", "Create new roles", {
      pluginId: pluginMetadata.pluginId,
    }),
    update: access(
      "roles.update",
      "manage",
      "Update role names and access rules",
      { pluginId: pluginMetadata.pluginId },
    ),
    delete: access("roles.delete", "manage", "Delete roles", {
      pluginId: pluginMetadata.pluginId,
    }),
    manage: access("roles", "manage", "Assign roles to users", {
      pluginId: pluginMetadata.pluginId,
    }),
  },

  /**
   * Authentication strategy management.
   */
  strategies: access(
    "strategies",
    "manage",
    "Manage authentication strategies and settings",
    { pluginId: pluginMetadata.pluginId },
  ),

  /**
   * Registration settings management.
   */
  registration: access(
    "registration",
    "manage",
    "Manage user registration settings",
    { pluginId: pluginMetadata.pluginId },
  ),

  /**
   * External application management.
   */
  applications: access(
    "applications",
    "manage",
    "Create, update, delete, and view external applications",
    { pluginId: pluginMetadata.pluginId },
  ),

  /**
   * Team management access rules.
   */
  teams: accessPair(
    "teams",
    {
      read: { description: "View teams and team memberships" },
      manage: {
        description: "Create, delete, and manage all teams and resource access",
      },
    },
    { pluginId: pluginMetadata.pluginId },
  ),
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
