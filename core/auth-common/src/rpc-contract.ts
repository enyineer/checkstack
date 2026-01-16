import {
  createClientDefinition,
  proc,
  lucideIconSchema,
} from "@checkstack/common";
import { z } from "zod";
import { authAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";

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
  isAssignable: z.boolean().optional(),
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
  configSchema: z.record(z.string(), z.unknown()),
  config: z.record(z.string(), z.unknown()).optional(),
  adminInstructions: z.string().optional(),
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

// Service-to-service schemas
const FindUserByEmailInputSchema = z.object({
  email: z.string().email(),
});

const FindUserByEmailOutputSchema = z.object({ id: z.string() }).optional();

const UpsertExternalUserInputSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  providerId: z.string(),
  accountId: z.string(),
  password: z.string(),
  autoUpdateUser: z.boolean().optional(),
});

const UpsertExternalUserOutputSchema = z.object({
  userId: z.string(),
  created: z.boolean(),
});

const CreateSessionInputSchema = z.object({
  userId: z.string(),
  token: z.string(),
  expiresAt: z.coerce.date(),
});

const CreateCredentialUserInputSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string(),
});

const CreateCredentialUserOutputSchema = z.object({
  userId: z.string(),
});

// Auth RPC Contract with full metadata
export const authContract = {
  // ==========================================================================
  // ANONYMOUS ENDPOINTS (userType: "anonymous")
  // ==========================================================================

  getEnabledStrategies: proc({
    operationType: "query",
    userType: "anonymous",
    access: [],
  }).output(z.array(EnabledStrategyDtoSchema)),

  getRegistrationStatus: proc({
    operationType: "query",
    userType: "anonymous",
    access: [],
  }).output(RegistrationStatusSchema),

  // ==========================================================================
  // AUTHENTICATED ENDPOINTS (userType: "authenticated")
  // ==========================================================================

  accessRules: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  }).output(z.object({ accessRules: z.array(z.string()) })),

  // ==========================================================================
  // USER MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getUsers: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.users.read],
  }).output(z.array(UserDtoSchema)),

  deleteUser: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.users.manage],
  })
    .input(z.string())
    .output(z.void()),

  createCredentialUser: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.users.create],
  })
    .input(CreateCredentialUserInputSchema)
    .output(CreateCredentialUserOutputSchema),

  updateUserRoles: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.users.manage],
  })
    .input(z.object({ userId: z.string(), roles: z.array(z.string()) }))
    .output(z.void()),

  // ==========================================================================
  // ROLE MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getRoles: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.roles.read],
  }).output(z.array(RoleDtoSchema)),

  getAccessRules: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.roles.read],
  }).output(z.array(AccessRuleDtoSchema)),

  createRole: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.roles.create],
  })
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        accessRules: z.array(z.string()),
      })
    )
    .output(z.void()),

  updateRole: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.roles.update],
  })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        accessRules: z.array(z.string()),
      })
    )
    .output(z.void()),

  deleteRole: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.roles.delete],
  })
    .input(z.string())
    .output(z.void()),

  // ==========================================================================
  // STRATEGY MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getStrategies: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.strategies],
  }).output(z.array(StrategyDtoSchema)),

  updateStrategy: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.strategies],
  })
    .input(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.object({ success: z.boolean() })),

  reloadAuth: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.strategies],
  }).output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // REGISTRATION MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getRegistrationSchema: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.registration],
  }).output(z.record(z.string(), z.unknown())),

  setRegistrationStatus: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.registration],
  })
    .input(RegistrationStatusSchema)
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // INTERNAL SERVICE ENDPOINTS (userType: "service")
  // ==========================================================================

  getAnonymousAccessRules: proc({
    operationType: "query",
    userType: "service",
    access: [],
  }).output(z.array(z.string())),

  findUserByEmail: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(FindUserByEmailInputSchema)
    .output(FindUserByEmailOutputSchema),

  upsertExternalUser: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(UpsertExternalUserInputSchema)
    .output(UpsertExternalUserOutputSchema),

  createSession: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(CreateSessionInputSchema)
    .output(z.object({ sessionId: z.string() })),

  getUserById: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
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

  filterUsersByAccessRule: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        userIds: z.array(z.string()),
        accessRule: z.string(),
      })
    )
    .output(z.array(z.string())),

  // ==========================================================================
  // APPLICATION MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getApplications: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.applications],
  }).output(
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

  createApplication: proc({
    operationType: "mutation",
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
        secret: z.string(),
      })
    ),

  updateApplication: proc({
    operationType: "mutation",
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

  deleteApplication: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.applications],
  })
    .input(z.string())
    .output(z.void()),

  regenerateApplicationSecret: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.applications],
  })
    .input(z.string())
    .output(z.object({ secret: z.string() })),

  // ==========================================================================
  // TEAM MANAGEMENT (userType: "authenticated" with access)
  // ==========================================================================

  getTeams: proc({
    operationType: "query",
    userType: "authenticated",
    access: [authAccess.teams.read],
  }).output(
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

  getTeam: proc({
    operationType: "query",
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

  createTeam: proc({
    operationType: "mutation",
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

  updateTeam: proc({
    operationType: "mutation",
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

  deleteTeam: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [authAccess.teams.manage],
  })
    .input(z.string())
    .output(z.void()),

  addUserToTeam: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [authAccess.teams.read],
  })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  removeUserFromTeam: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [authAccess.teams.read],
  })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  addTeamManager: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [authAccess.teams.manage],
  })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  removeTeamManager: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [authAccess.teams.manage],
  })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  getResourceTeamAccess: proc({
    operationType: "query",
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

  setResourceTeamAccess: proc({
    operationType: "mutation",
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

  removeResourceTeamAccess: proc({
    operationType: "mutation",
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

  getResourceAccessSettings: proc({
    operationType: "query",
    userType: "authenticated",
    access: [authAccess.teams.read],
  })
    .input(z.object({ resourceType: z.string(), resourceId: z.string() }))
    .output(z.object({ teamOnly: z.boolean() })),

  setResourceAccessSettings: proc({
    operationType: "mutation",
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

  checkResourceTeamAccess: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
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

  getAccessibleResourceIds: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
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

  deleteResourceGrants: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(z.object({ resourceType: z.string(), resourceId: z.string() }))
    .output(z.void()),
};

// Export contract type
export type AuthContract = typeof authContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(AuthApi);
export const AuthApi = createClientDefinition(authContract, pluginMetadata);
