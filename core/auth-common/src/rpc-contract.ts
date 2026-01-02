import { oc } from "@orpc/contract";
import {
  createClientDefinition,
  type ProcedureMetadata,
} from "@checkmate/common";
import { z } from "zod";
import { permissions } from "./permissions";
import { pluginMetadata } from "./plugin-metadata";

// Base builder with full metadata support
const _base = oc.$meta<ProcedureMetadata>({});

// Zod schemas for return types
const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
});

const RoleDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().nullable(),
  permissions: z.array(z.string()),
  isSystem: z.boolean().optional(),
  isAssignable: z.boolean().optional(), // False for anonymous role
});

const PermissionDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
});

const StrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  configVersion: z.number(),
  configSchema: z.record(z.string(), z.unknown()), // JSON Schema representation
  config: z.record(z.string(), z.unknown()).optional(), // VersionedConfig.data (secrets redacted)
});

const EnabledStrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  type: z.enum(["credential", "social"]),
  icon: z.string().optional(), // Lucide icon name
  requiresManualRegistration: z.boolean(),
});

const RegistrationStatusSchema = z.object({
  allowRegistration: z.boolean(),
});

// ==========================================================================
// SERVICE-TO-SERVICE SCHEMAS (for auth provider plugins like LDAP)
// ==========================================================================

const FindUserByEmailInputSchema = z.object({
  email: z.string().email(),
});

const FindUserByEmailOutputSchema = z
  .object({
    id: z.string(),
  })
  .optional();

const UpsertExternalUserInputSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  providerId: z.string(), // e.g., "ldap"
  accountId: z.string(), // Provider-specific account ID (e.g., LDAP username)
  password: z.string(), // Hashed password
  autoUpdateUser: z.boolean().optional(), // Update existing user's name
});

const UpsertExternalUserOutputSchema = z.object({
  userId: z.string(),
  created: z.boolean(), // true if new user was created, false if existing
});

const CreateSessionInputSchema = z.object({
  userId: z.string(),
  token: z.string(),
  expiresAt: z.coerce.date(),
});

// Auth RPC Contract with full metadata
export const authContract = {
  // ==========================================================================
  // ANONYMOUS ENDPOINTS (userType: "anonymous")
  // These can be called without authentication (login/registration pages)
  // ==========================================================================

  getEnabledStrategies: _base
    .meta({ userType: "anonymous" })
    .output(z.array(EnabledStrategyDtoSchema)),

  getRegistrationStatus: _base
    .meta({ userType: "anonymous" })
    .output(RegistrationStatusSchema),

  // ==========================================================================
  // AUTHENTICATED ENDPOINTS (userType: "authenticated" - no specific permission)
  // ==========================================================================

  permissions: _base
    .meta({ userType: "authenticated" }) // Any authenticated user can check their own permissions
    .output(z.object({ permissions: z.array(z.string()) })),

  // ==========================================================================
  // USER MANAGEMENT (userType: "user" with permissions)
  // ==========================================================================

  getUsers: _base
    .meta({ userType: "user", permissions: [permissions.usersRead.id] })
    .output(z.array(UserDtoSchema)),

  deleteUser: _base
    .meta({ userType: "user", permissions: [permissions.usersManage.id] })
    .input(z.string())
    .output(z.void()),

  updateUserRoles: _base
    .meta({ userType: "user", permissions: [permissions.usersManage.id] })
    .input(
      z.object({
        userId: z.string(),
        roles: z.array(z.string()),
      })
    )
    .output(z.void()),

  // ==========================================================================
  // ROLE MANAGEMENT (userType: "user" with permissions)
  // ==========================================================================

  getRoles: _base
    .meta({ userType: "user", permissions: [permissions.rolesRead.id] })
    .output(z.array(RoleDtoSchema)),

  getPermissions: _base
    .meta({ userType: "user", permissions: [permissions.rolesRead.id] })
    .output(z.array(PermissionDtoSchema)),

  createRole: _base
    .meta({ userType: "user", permissions: [permissions.rolesCreate.id] })
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        permissions: z.array(z.string()),
      })
    )
    .output(z.void()),

  updateRole: _base
    .meta({ userType: "user", permissions: [permissions.rolesUpdate.id] })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        permissions: z.array(z.string()),
      })
    )
    .output(z.void()),

  deleteRole: _base
    .meta({ userType: "user", permissions: [permissions.rolesDelete.id] })
    .input(z.string())
    .output(z.void()),

  // ==========================================================================
  // STRATEGY MANAGEMENT (userType: "user" with permissions)
  // ==========================================================================

  getStrategies: _base
    .meta({ userType: "user", permissions: [permissions.strategiesManage.id] })
    .output(z.array(StrategyDtoSchema)),

  updateStrategy: _base
    .meta({ userType: "user", permissions: [permissions.strategiesManage.id] })
    .input(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.object({ success: z.boolean() })),

  reloadAuth: _base
    .meta({ userType: "user", permissions: [permissions.strategiesManage.id] })
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // REGISTRATION MANAGEMENT (userType: "user" with permissions)
  // ==========================================================================

  getRegistrationSchema: _base
    .meta({
      userType: "user",
      permissions: [permissions.registrationManage.id],
    })
    .output(z.record(z.string(), z.unknown())),

  setRegistrationStatus: _base
    .meta({
      userType: "user",
      permissions: [permissions.registrationManage.id],
    })
    .input(RegistrationStatusSchema)
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // INTERNAL SERVICE ENDPOINTS (userType: "service")
  // ==========================================================================

  /**
   * Get permissions assigned to the anonymous role.
   * Used by core AuthService for permission checks on public endpoints.
   */
  getAnonymousPermissions: _base
    .meta({ userType: "service" })
    .output(z.array(z.string())),

  /**
   * Find a user by email address.
   * Used by external auth providers (e.g., LDAP) to check if a user exists.
   */
  findUserByEmail: _base
    .meta({ userType: "service" })
    .input(FindUserByEmailInputSchema)
    .output(FindUserByEmailOutputSchema),

  /**
   * Upsert a user from an external auth provider.
   * Creates user + account if new, or updates user if autoUpdateUser is true.
   * Used by external auth providers (e.g., LDAP) to sync users.
   */
  upsertExternalUser: _base
    .meta({ userType: "service" })
    .input(UpsertExternalUserInputSchema)
    .output(UpsertExternalUserOutputSchema),

  /**
   * Create a session for a user.
   * Used by external auth providers (e.g., LDAP) after successful authentication.
   */
  createSession: _base
    .meta({ userType: "service" })
    .input(CreateSessionInputSchema)
    .output(z.object({ sessionId: z.string() })),

  /**
   * Filter a list of user IDs to only those who have a specific permission.
   * Used by SignalService to send signals only to authorized users.
   */
  filterUsersByPermission: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        userIds: z.array(z.string()),
        permission: z.string(), // Fully-qualified permission ID
      })
    )
    .output(z.array(z.string())), // Returns filtered user IDs
};

// Export contract type
export type AuthContract = typeof authContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(AuthApi);
export const AuthApi = createClientDefinition(authContract, pluginMetadata);
