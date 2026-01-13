import { oc } from "@orpc/contract";
import {
  createClientDefinition,
  type ProcedureMetadata,
  lucideIconSchema,
} from "@checkstack/common";
import { z } from "zod";
import { authAccess } from "./access";
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
  accessRules: z.array(z.string()),
  isSystem: z.boolean().optional(),
  isAssignable: z.boolean().optional(), // False for anonymous role
});

const AccessRuleDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
});

const StrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  icon: lucideIconSchema.optional(),
  enabled: z.boolean(),
  configVersion: z.number(),
  configSchema: z.record(z.string(), z.unknown()), // JSON Schema representation
  config: z.record(z.string(), z.unknown()).optional(), // VersionedConfig.data (secrets redacted)
  adminInstructions: z.string().optional(), // Markdown instructions for admins
});

const EnabledStrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  type: z.enum(["credential", "social"]),
  icon: lucideIconSchema.optional(),
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

const CreateCredentialUserInputSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string(), // Validated against passwordSchema on backend
});

const CreateCredentialUserOutputSchema = z.object({
  userId: z.string(),
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
  // AUTHENTICATED ENDPOINTS (userType: "authenticated" - no specific access rule)
  // ==========================================================================

  accessRules: _base
    .meta({ userType: "authenticated" }) // Any authenticated user can check their own access rules
    .output(z.object({ accessRules: z.array(z.string()) })),

  // ==========================================================================
  // USER MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getUsers: _base
    .meta({ userType: "user", access: [authAccess.users.read] })
    .output(z.array(UserDtoSchema)),

  deleteUser: _base
    .meta({ userType: "user", access: [authAccess.users.manage] })
    .input(z.string())
    .output(z.void()),

  createCredentialUser: _base
    .meta({ userType: "user", access: [authAccess.users.create] })
    .input(CreateCredentialUserInputSchema)
    .output(CreateCredentialUserOutputSchema),

  updateUserRoles: _base
    .meta({ userType: "user", access: [authAccess.users.manage] })
    .input(
      z.object({
        userId: z.string(),
        roles: z.array(z.string()),
      })
    )
    .output(z.void()),

  // ==========================================================================
  // ROLE MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getRoles: _base
    .meta({ userType: "user", access: [authAccess.roles.read] })
    .output(z.array(RoleDtoSchema)),

  getAccessRules: _base
    .meta({ userType: "user", access: [authAccess.roles.read] })
    .output(z.array(AccessRuleDtoSchema)),

  createRole: _base
    .meta({ userType: "user", access: [authAccess.roles.create] })
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        accessRules: z.array(z.string()),
      })
    )
    .output(z.void()),

  updateRole: _base
    .meta({ userType: "user", access: [authAccess.roles.update] })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        accessRules: z.array(z.string()),
      })
    )
    .output(z.void()),

  deleteRole: _base
    .meta({ userType: "user", access: [authAccess.roles.delete] })
    .input(z.string())
    .output(z.void()),

  // ==========================================================================
  // STRATEGY MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getStrategies: _base
    .meta({ userType: "user", access: [authAccess.strategies] })
    .output(z.array(StrategyDtoSchema)),

  updateStrategy: _base
    .meta({ userType: "user", access: [authAccess.strategies] })
    .input(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.object({ success: z.boolean() })),

  reloadAuth: _base
    .meta({ userType: "user", access: [authAccess.strategies] })
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // REGISTRATION MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getRegistrationSchema: _base
    .meta({
      userType: "user",
      access: [authAccess.registration],
    })
    .output(z.record(z.string(), z.unknown())),

  setRegistrationStatus: _base
    .meta({
      userType: "user",
      access: [authAccess.registration],
    })
    .input(RegistrationStatusSchema)
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // INTERNAL SERVICE ENDPOINTS (userType: "service")
  // ==========================================================================

  /**
   * Get access rules assigned to the anonymous role.
   * Used by core AuthService for access checks on public endpoints.
   */
  getAnonymousAccessRules: _base
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
   * Get a user by their ID.
   * Used by notification backend to fetch user email for contact resolution.
   */
  getUserById: _base
    .meta({ userType: "service" })
    .input(z.object({ userId: z.string() }))
    .output(
      z
        .object({
          id: z.string(),
          email: z.string(),
          name: z.string().nullable(),
        })
        .optional()
    ),

  /**
   * Filter a list of user IDs to only those who have a specific access rule.
   * Used by SignalService to send signals only to authorized users.
   */
  filterUsersByAccessRule: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        userIds: z.array(z.string()),
        accessRule: z.string(), // Fully-qualified access rule ID
      })
    )
    .output(z.array(z.string())), // Returns filtered user IDs

  // ==========================================================================
  // APPLICATION MANAGEMENT (userType: "user" with access)
  // External API applications (API keys) with RBAC integration
  // ==========================================================================

  getApplications: _base
    .meta({
      userType: "user",
      access: [authAccess.applications],
    })
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional().nullable(),
          roles: z.array(z.string()),
          createdById: z.string(),
          createdAt: z.coerce.date(),
          lastUsedAt: z.coerce.date().optional().nullable(),
        })
      )
    ),

  createApplication: _base
    .meta({
      userType: "user",
      access: [authAccess.applications],
    })
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
      })
    )
    .output(
      z.object({
        application: z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional().nullable(),
          roles: z.array(z.string()),
          createdById: z.string(),
          createdAt: z.coerce.date(),
        }),
        secret: z.string(), // Full secret - ONLY shown once!
      })
    ),

  updateApplication: _base
    .meta({
      userType: "user",
      access: [authAccess.applications],
    })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional().nullable(),
        roles: z.array(z.string()).optional(),
      })
    )
    .output(z.void()),

  deleteApplication: _base
    .meta({
      userType: "user",
      access: [authAccess.applications],
    })
    .input(z.string())
    .output(z.void()),

  regenerateApplicationSecret: _base
    .meta({
      userType: "user",
      access: [authAccess.applications],
    })
    .input(z.string())
    .output(z.object({ secret: z.string() })), // New secret - shown once

  // ==========================================================================
  // TEAM MANAGEMENT (userType: "authenticated" with access)
  // Resource-level access control via teams
  // Both users and applications can manage teams with proper access
  // ==========================================================================

  getTeams: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.read],
    })
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional().nullable(),
          memberCount: z.number(),
          isManager: z.boolean(),
        })
      )
    ),

  getTeam: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.read],
    })
    .input(z.object({ teamId: z.string() }))
    .output(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional().nullable(),
          members: z.array(
            z.object({ id: z.string(), name: z.string(), email: z.string() })
          ),
          managers: z.array(
            z.object({ id: z.string(), name: z.string(), email: z.string() })
          ),
        })
        .optional()
    ),

  createTeam: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.manage],
    })
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
      })
    )
    .output(z.object({ id: z.string() })),

  updateTeam: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.read],
    })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional().nullable(),
      })
    )
    .output(z.void()),

  deleteTeam: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.manage],
    })
    .input(z.string())
    .output(z.void()),

  addUserToTeam: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.read],
    })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  removeUserFromTeam: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.read],
    })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  addTeamManager: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.manage],
    })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  removeTeamManager: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.manage],
    })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  getResourceTeamAccess: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.read],
    })
    .input(z.object({ resourceType: z.string(), resourceId: z.string() }))
    .output(
      z.array(
        z.object({
          teamId: z.string(),
          teamName: z.string(),
          canRead: z.boolean(),
          canManage: z.boolean(),
        })
      )
    ),

  setResourceTeamAccess: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.manage],
    })
    .input(
      z.object({
        resourceType: z.string(),
        resourceId: z.string(),
        teamId: z.string(),
        canRead: z.boolean().optional(),
        canManage: z.boolean().optional(),
      })
    )
    .output(z.void()),

  removeResourceTeamAccess: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.manage],
    })
    .input(
      z.object({
        resourceType: z.string(),
        resourceId: z.string(),
        teamId: z.string(),
      })
    )
    .output(z.void()),

  // Resource-level access settings (teamOnly flag)
  getResourceAccessSettings: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.read],
    })
    .input(z.object({ resourceType: z.string(), resourceId: z.string() }))
    .output(z.object({ teamOnly: z.boolean() })),

  setResourceAccessSettings: _base
    .meta({
      userType: "authenticated",
      access: [authAccess.teams.manage],
    })
    .input(
      z.object({
        resourceType: z.string(),
        resourceId: z.string(),
        teamOnly: z.boolean(),
      })
    )
    .output(z.void()),

  // ==========================================================================
  // S2S ENDPOINTS FOR TEAM ACCESS (userType: "service")
  // ==========================================================================

  checkResourceTeamAccess: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        userId: z.string(),
        userType: z.enum(["user", "application"]),
        resourceType: z.string(),
        resourceId: z.string(),
        action: z.enum(["read", "manage"]),
        hasGlobalAccess: z.boolean(),
      })
    )
    .output(z.object({ hasAccess: z.boolean() })),

  getAccessibleResourceIds: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        userId: z.string(),
        userType: z.enum(["user", "application"]),
        resourceType: z.string(),
        resourceIds: z.array(z.string()),
        action: z.enum(["read", "manage"]),
        hasGlobalAccess: z.boolean(),
      })
    )
    .output(z.array(z.string())),

  deleteResourceGrants: _base
    .meta({ userType: "service" })
    .input(z.object({ resourceType: z.string(), resourceId: z.string() }))
    .output(z.void()),
};

// Export contract type
export type AuthContract = typeof authContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(AuthApi);
export const AuthApi = createClientDefinition(authContract, pluginMetadata);
