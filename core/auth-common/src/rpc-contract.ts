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
  /**
   * Whether an anonymous caller can actually USE this rule (a `public` procedure
   * requires it). The role editor uses this to warn/disable granting inert
   * permissions to the anonymous role. Absent/false => only authenticated
   * procedures need it, so granting it to the anonymous role has no effect.
   */
  anonymousUsable: z.boolean().optional(),
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
  type: z.enum(["credential", "social", "ldap", "saml"]), // Kept for backward compatibility, but we should use clientFlow
  icon: lucideIconSchema.optional(),
  requiresManualRegistration: z.boolean(),
  clientFlow: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("oauth") }),
      z.object({ type: z.literal("redirect"), target: z.string() }),
      z.object({
        type: z.literal("form"),
        target: z.string(),
        fields: z.array(
          z.object({
            name: z.string(),
            label: z.string(),
            type: z.enum(["text", "password"]),
            placeholder: z.string().optional(),
          }),
        ),
      }),
      z.object({ type: z.literal("credential") }),
    ])
    .optional(),
});

const RegistrationStatusSchema = z.object({
  allowRegistration: z.boolean(),
});

/** AI platform OAuth AS + MCP server settings (admin-managed). */
const McpOAuthSettingsSchema = z.object({
  enabled: z.boolean(),
  allowDynamicClientRegistration: z.boolean(),
  dcrRateLimitMax: z.number().int().positive(),
  dcrRateLimitWindowSeconds: z.number().int().positive(),
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
  /** Role IDs to assign based on current directory group membership */
  syncRoles: z.array(z.string()).optional(),
  /** All role IDs that are managed by directory mappings (used to remove roles when user leaves groups) */
  managedRoleIds: z.array(z.string()).optional(),
});

const UpsertExternalUserOutputSchema = z.object({
  userId: z.string(),
  created: z.boolean(),
});

const CreateSessionInputSchema = z.object({
  userId: z.string(),
  ipAddress: z.string().optional().nullable(),
  userAgent: z.string().optional().nullable(),
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

  getOnboardingStatus: proc({
    operationType: "query",
    userType: "anonymous",
    access: [],
  }).output(z.object({ needsOnboarding: z.boolean() })),

  completeOnboarding: proc({
    operationType: "mutation",
    userType: "anonymous",
    access: [],
  })
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  validateResetToken: proc({
    operationType: "query",
    userType: "anonymous",
    access: [],
  })
    .input(z.object({ token: z.string().min(1).max(128) }))
    .output(
      z.object({
        valid: z.boolean(),
        reason: z.enum(["invalid", "expired"]).optional(),
      }),
    ),

  // ==========================================================================
  // AUTHENTICATED ENDPOINTS (userType: "authenticated")
  // ==========================================================================

  // Public so ANONYMOUS callers also get their effective rules (the configurable
  // "anonymous" role's grants), not an empty set. The frontend gates nav/links
  // on these, so an anonymous visitor must see exactly what the anonymous role
  // is allowed - which an admin can change.
  accessRules: proc({
    operationType: "query",
    userType: "public",
    access: [],
  }).output(
    z.object({
      accessRules: z.array(z.string()),
      // Whether the caller is a member OR manager of at least one team. Lets the
      // frontend reveal the (self-scoping) Teams page/nav to a team-scoped user
      // who holds no global `auth.teams.read` rule. Anonymous callers get false.
      isInAnyTeam: z.boolean(),
    }),
  ),

  getCurrentUserProfile: proc({
    operationType: "query",
    userType: "user",
    access: [],
  }).output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      hasCredentialAccount: z.boolean(),
    }),
  ),

  updateCurrentUser: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
      }),
    )
    .output(z.void()),

  // ==========================================================================
  // USER MANAGEMENT (userType: "user" with access)
  // ==========================================================================

  getUsers: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.users.read],
  }).output(z.array(UserDtoSchema)),

  // Minimal user directory search for team management. Gated on `teams.read`
  // (NOT `users.read`) so a team manager — who needs to find users to add to
  // their team but is not a platform admin — can use it. Returns only
  // id/name/email, not full admin user data.
  searchUsers: proc({
    operationType: "query",
    userType: "user",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(z.object({ query: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
        }),
      ),
    ),

  // Resolve opaque (resourceType, resourceId) grant rows to display names via
  // the owning plugin's registered resolver, so the Teams page can show a
  // team's grants by name instead of raw ids. Read-level (anyone viewing teams).
  resolveResourceNames: proc({
    operationType: "query",
    userType: "user",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(
      z.object({
        resourceType: z.string(),
        resourceIds: z.array(z.string()),
      }),
    )
    .output(z.object({ names: z.record(z.string(), z.string()) })),

  // Search an owning plugin's resources of a type, for the "grant a team access
  // to a resource" picker on the Teams page. Gated on teams.manage — granting a
  // team access to a resource is an admin action.
  searchResources: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.teams.manage],
  })
    .input(
      z.object({
        resourceType: z.string(),
        query: z.string(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .output(
      z.object({
        results: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    ),

  deleteUser: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.users.manage],
  })
    .route({ method: "DELETE" })
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
    .route({ method: "PATCH" })
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
      }),
    )
    .output(z.void()),

  updateRole: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.roles.update],
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        accessRules: z.array(z.string()),
      }),
    )
    .output(z.void()),

  deleteRole: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.roles.delete],
  })
    .route({ method: "DELETE" })
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
    .route({ method: "PATCH" })
    .input(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
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
  // AI PLATFORM: OAuth AS + MCP server settings (admin-gated)
  // ==========================================================================

  /** Current OAuth-AS / MCP server settings (enable, DCR toggle, rate-limit). */
  getMcpOAuthSettings: proc({
    operationType: "query",
    userType: "user",
    access: [authAccess.strategies],
  }).output(McpOAuthSettingsSchema),

  /** Update the OAuth-AS / MCP server settings; reloads better-auth to apply. */
  setMcpOAuthSettings: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.strategies],
  })
    .input(McpOAuthSettingsSchema)
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
    serviceScope: ["auth-*"],
  })
    .input(UpsertExternalUserInputSchema)
    .output(UpsertExternalUserOutputSchema),

  createSession: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(CreateSessionInputSchema)
    .output(z.object({ sessionId: z.string(), setCookies: z.array(z.string()) })),

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
        .optional(),
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
      }),
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
      }),
    ),
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
      }),
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
      }),
    ),

  updateApplication: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.applications],
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional().nullable(),
        roles: z.array(z.string()).optional(),
      }),
    )
    .output(z.void()),

  deleteApplication: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.applications],
  })
    .route({ method: "DELETE" })
    .input(z.string())
    .output(z.void()),

  regenerateApplicationSecret: proc({
    operationType: "mutation",
    userType: "user",
    access: [authAccess.applications],
  })
    .input(z.string())
    .output(z.object({ secret: z.string() })),

  /**
   * S2S: resolve an application's CURRENT roles, access rules, and team
   * memberships. Used by the core auth service to build an `application`
   * principal from an app-principal token (automation `runAs` service
   * accounts) - resolved live on every call, never frozen into the token.
   * Returns `null` when the application no longer exists.
   */
  enrichApplicationPrincipal: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ applicationId: z.string() }))
    .output(
      z
        .object({
          id: z.string(),
          name: z.string(),
          roles: z.array(z.string()),
          accessRules: z.array(z.string()),
          teamIds: z.array(z.string()),
        })
        .nullable(),
    ),

  /**
   * List the applications the calling user may BIND as an automation's
   * service account. An application is bindable only when its resolved
   * access rules are a subset of the caller's (a user can never grant an
   * automation more authority than they hold); `*`-holders may bind any
   * application. Drives the "Run as" picker in the automation editor.
   */
  getBindableApplications: proc({
    operationType: "query",
    userType: "user",
    access: [],
  })
    .input(
      z
        .object({
          // Opt in to resolving and returning each app's effective access
          // rules. The UI picker leaves this off (it only needs id/name) so an
          // admin caller skips per-app rule resolution entirely; the AI propose
          // / service-account flow sets it to match a runAs against an action's
          // `requiredAccessRules`.
          includeAccessRules: z.boolean().optional(),
        })
        .optional(),
    )
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable().optional(),
          // The app's resolved effective access rules, present only when
          // `includeAccessRules` was requested. Safe to expose: every returned
          // app is bindable by the caller, so its rules are a subset of the
          // caller's own (or the caller is a `*` admin). Lets propose-time
          // validation check a chosen runAs without a separate lookup.
          accessRules: z.array(z.string()).optional(),
        }),
      ),
    ),

  // ==========================================================================
  // TEAM MANAGEMENT (userType: "authenticated" with access)
  // ==========================================================================

  getTeams: proc({
    operationType: "query",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  }).output(
    z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional().nullable(),
        memberCount: z.number(),
        isManager: z.boolean(),
      }),
    ),
  ),

  getTeam: proc({
    operationType: "query",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(z.object({ teamId: z.string() }))
    .output(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional().nullable(),
          members: z.array(
            z.object({ id: z.string(), name: z.string(), email: z.string() }),
          ),
          managers: z.array(
            z.object({ id: z.string(), name: z.string(), email: z.string() }),
          ),
        })
        .optional(),
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
      }),
    )
    .output(z.object({ id: z.string() })),

  updateTeam: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional().nullable(),
      }),
    )
    .output(z.void()),

  deleteTeam: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [authAccess.teams.manage],
  })
    .route({ method: "DELETE" })
    .input(z.string())
    .output(z.void()),

  // Membership & manager mutations are gated at `teams.read` (NOT
  // `teams.manage`): the real authorization is the handler's
  // `assertTeamManagementAccess`, which allows a GLOBAL `teams.manage` holder OR
  // a manager of THIS specific team. Gating at `teams.manage` here would make
  // the middleware reject a team manager (who lacks the global rule) before the
  // handler runs, so a team manager could never manage their own team's
  // membership. Team CREATE/DELETE stay at `teams.manage` (admin-only).
  addUserToTeam: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  removeUserFromTeam: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .route({ method: "DELETE" })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  addTeamManager: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  removeTeamManager: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .route({ method: "DELETE" })
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .output(z.void()),

  // --- Generic relation-tuple API (Target B) ---------------------------------
  // The access layer is one relation store. A team holds `viewer` (read),
  // `editor` (read+manage), or `owner` on an object `{objectType}:{objectId}`;
  // a `public` viewer marker (isPublic) means "the global RBAC path is open"
  // (its absence, with team grants, = private). `creator` is a type-level grant
  // (see setCreateGrant). The frontend maps read=viewer, manage=editor.

  // Who has access to an object + whether it is public (powers "Who can change
  // this"). Replaces getResourceTeamAccess + getResourceAccessSettings.
  listObjectRelations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(z.object({ objectType: z.string(), objectId: z.string() }))
    .output(
      z.object({
        teams: z.array(
          z.object({
            teamId: z.string(),
            teamName: z.string(),
            relation: z.enum(["viewer", "editor", "owner"]),
          }),
        ),
        isPublic: z.boolean(),
      }),
    ),

  // Batched variant of listObjectRelations: owning team(s) + privacy for MANY
  // objects of one type in a single call, so a table can render an owner
  // indicator per row without an N+1. Every requested id gets an entry back.
  listObjectRelationsBulk: proc({
    operationType: "query",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(
      z.object({
        objectType: z.string(),
        objectIds: z.array(z.string()),
      }),
    )
    .output(
      z.object({
        objects: z.array(
          z.object({
            objectId: z.string(),
            teams: z.array(
              z.object({
                teamId: z.string(),
                teamName: z.string(),
                relation: z.enum(["viewer", "editor", "owner"]),
              }),
            ),
            isPublic: z.boolean(),
          }),
        ),
      }),
    ),

  // Set a team's access relation on an object (replaces its existing relation
  // there). Replaces setResourceTeamAccess.
  // Grant/downgrade a team's access on an object. Delegation authz: the caller
  // must be able to MANAGE this specific object (a global `auth.teams.manage`
  // admin, the object's own `<type>.manage` rule on a non-private object, or
  // membership of a team with an editor/owner grant on it). `access: []` - the
  // handler enforces the per-object verdict, so a resource-manager without the
  // global teams rule isn't rejected by the middleware. A viewer-only team
  // cannot reach this and so cannot elevate its own or another team's access.
  writeRelation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [],
  })
    .input(
      z.object({
        objectType: z.string(),
        objectId: z.string(),
        teamId: z.string(),
        relation: z.enum(["viewer", "editor"]),
      }),
    )
    .output(z.void()),

  // Remove all of a team's access relations on an object. Same per-object
  // delegation authz as writeRelation (handler-enforced).
  removeRelation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [],
  })
    .route({ method: "DELETE" })
    .input(
      z.object({
        objectType: z.string(),
        objectId: z.string(),
        teamId: z.string(),
      }),
    )
    .output(z.void()),

  // Toggle the public marker (privacy). Same per-object delegation authz as
  // writeRelation (handler-enforced).
  setObjectPublic: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [],
  })
    .input(
      z.object({
        objectType: z.string(),
        objectId: z.string(),
        isPublic: z.boolean(),
      }),
    )
    .output(z.void()),

  // Whether the CALLER may edit this object's team access (add/remove teams,
  // toggle manage/privacy). Runs the SAME delegation authz as the write
  // procedures so the editor shows write controls exactly when a write would be
  // accepted - no frontend/backend drift. access: [] - handler computes it.
  canManageObjectAccess: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  })
    .input(z.object({ objectType: z.string(), objectId: z.string() }))
    .output(z.object({ allowed: z.boolean() })),

  // The teams the CALLER belongs to. No access rule: a caller may always read
  // their own memberships. Used by the create-form team-ownership picker.
  getMyTeams: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  }).output(
    z.object({
      teams: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),

  // All object relations held by a team (the inverse of listObjectRelations).
  // Drives the per-team grant list on the Teams page. objectId is opaque; the
  // UI resolves names via resolveResourceNames.
  listSubjectRelations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(z.object({ teamId: z.string() }))
    .output(
      z.object({
        grants: z.array(
          z.object({
            objectType: z.string(),
            objectId: z.string(),
            relation: z.enum(["viewer", "editor", "owner"]),
          }),
        ),
      }),
    ),

  // The team-scopable resource kinds known to the platform (derived from
  // registered contracts). Drives the teams admin UI for create-capability.
  getResourceKinds: proc({
    operationType: "query",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  }).output(
    z.object({
      kinds: z.array(
        z.object({
          resourceType: z.string(),
          label: z.string(),
          pluginId: z.string(),
          createCapable: z.boolean(),
        }),
      ),
    }),
  ),

  // The caller's own teams that hold MANAGE on ALL of the given resources.
  // Used by create forms to restrict the owning-team picker to teams that
  // actually manage the selected parent(s) — e.g. for an incident, the teams
  // that manage every selected system. Empty resourceIds => no teams.
  getMyManagingTeams: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  })
    .input(
      z.object({
        resourceType: z.string(),
        resourceIds: z.array(z.string()),
      }),
    )
    .output(z.object({ teamIds: z.array(z.string()) })),

  // --- Create-capability grants: which teams may CREATE a resource type ---
  // Distinct from membership: an admin grants a team the authority to create
  // resources of a type; members of that team may then create (and own) them
  // without the global manage rule. Absence => team-based create not allowed.

  // Grant/revoke a team's `creator` relation on a type-level object (its
  // authority to CREATE resources of a type). Replaces grantResourceCreate +
  // revokeResourceCreate with one toggle.
  setCreateGrant: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [authAccess.teams.manage],
  })
    .input(
      z.object({
        objectType: z.string(),
        teamId: z.string(),
        allowed: z.boolean(),
      }),
    )
    .output(z.void()),

  // The resource types a given team is allowed to create. Drives the per-team
  // create-capability UI. (maps to the team's `creator` tuples.)
  listTeamCreateGrants: proc({
    operationType: "query",
    userType: "authenticated",
    access: [], // team-scoped: handler authorizes (member/manager) - see auth-backend router
  })
    .input(z.object({ teamId: z.string() }))
    .output(z.object({ resourceTypes: z.array(z.string()) })),

  // Can the CURRENT caller create an object of `objectType` via a TEAM grant?
  // This is the frontend-facing mirror of the S2S `authorizeCreate` matrix,
  // minus the global-RBAC path (the frontend already checks the manage rule via
  // `useAccess`, and ORs it with this). It answers TRUE when the caller belongs
  // to a team that either:
  //   - holds a `creator` grant on `objectType` (per-type create capability), OR
  //   - holds a MANAGE grant on at least one object of `parentType` (the parent
  //     gate: e.g. "you manage a system, so you may open an incident for it").
  // `parentType` is supplied by the caller because auth is domain-agnostic — it
  // comes from the plugin's own `instanceAccess.create.parent.resourceType`.
  // Drives create-button/page visibility so team-scoped users see the actions
  // the backend would actually let them perform. Returns false for anonymous
  // callers and users with no teams.
  canCreate: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  })
    .input(
      z.object({
        objectType: z.string(),
        parentType: z.string().optional(),
        // Sibling self-service: also allow when the caller holds a `creator`
        // grant on any of these types (mirrors the backend
        // `instanceAccess.create.alsoAcceptCreatorOf`). Supplied by the caller
        // from the plugin's own contract so auth stays domain-agnostic.
        alsoAcceptCreatorOf: z.array(z.string()).optional(),
      }),
    )
    .output(z.object({ allowed: z.boolean() })),

  // The set of resource types the CURRENT caller can create or manage ANY object
  // of via a TEAM grant (a `creator` grant, or an `editor`/`owner` grant on at
  // least one object of the type). Drives capability-aware NAV/ROUTE gating so a
  // team-scoped user who holds no global manage rule still sees the management
  // surfaces they can actually use. The frontend ORs the global RBAC rule on top.
  // Anonymous callers and users with no teams get an empty list.
  myManageableTypes: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  }).output(z.object({ types: z.array(z.string()) })),

  // Which of the given `resourceIds` (of `objectType`) may the CURRENT caller
  // act on at `action` level via a TEAM grant? The frontend-facing mirror of
  // the S2S `listAccessibleObjectIds`, resolved with `hasGlobalAccess: false` —
  // it returns ONLY the team-derived subset. The frontend ORs the global-RBAC
  // path (`useAccess(rule)`) on top, so a global-manage holder sees every row
  // and a team-scoped user sees exactly the rows their teams grant. This powers
  // per-row edit/delete gating so a user managing system X never sees a manage
  // action for system Y they cannot touch. Empty input or no teams => empty.
  listMyAccessibleResources: proc({
    operationType: "query",
    userType: "authenticated",
    access: [],
  })
    .input(
      z.object({
        objectType: z.string(),
        resourceIds: z.array(z.string()),
        action: z.enum(["read", "manage"]),
      }),
    )
    .output(z.object({ accessibleIds: z.array(z.string()) })),

  // ==========================================================================
  // S2S ENDPOINTS FOR TEAM ACCESS (userType: "service")
  // ==========================================================================

  check: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        userId: z.string(),
        userType: z.enum(["user", "application"]),
        objectType: z.string(),
        objectId: z.string(),
        action: z.enum(["read", "manage"]),
        hasGlobalAccess: z.boolean(),
      }),
    )
    .output(z.object({ hasAccess: z.boolean() })),

  listAccessibleObjectIds: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        userId: z.string(),
        userType: z.enum(["user", "application"]),
        objectType: z.string(),
        objectIds: z.array(z.string()),
        action: z.enum(["read", "manage"]),
        hasGlobalAccess: z.boolean(),
      }),
    )
    .output(z.array(z.string())),

  // Delete every tuple for an object (called when a resource is deleted, to
  // clean up its grants). Replaces deleteResourceGrants.
  deleteObjectRelations: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .route({ method: "DELETE" })
    .input(z.object({ objectType: z.string(), objectId: z.string() }))
    .output(z.void()),

  // Does the caller hold ANY team grant of the given level on a concrete object
  // of this TYPE? Lets the list/record post-filter tell a categorically
  // unauthorized caller (-> 403) from one legitimately scoped to empty (-> 200).
  hasAnyTypeGrant: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        userId: z.string(),
        userType: z.enum(["user", "application"]),
        objectType: z.string(),
        action: z.enum(["read", "manage"]),
        /**
         * Also count a type-level `creator` grant (for the `typeScoped` gate, so
         * a team member who may create the type is authorized before owning any
         * instance). Optional; defaults to false to preserve the list/record
         * post-filter semantics.
         */
        includeCreator: z.boolean().optional(),
      }),
    )
    .output(z.object({ hasGrant: z.boolean() })),

  // Decide whether a caller may CREATE an object of `objectType`, and which team
  // (if any) should own it. Resolves the create-authorization matrix:
  //  - global manage + no team        -> { ownerTeamId: null }   (global object)
  //  - global manage + team T          -> { ownerTeamId: T }      (admin for team)
  //  - member, requested team T (in T, T has creator grant) -> { ownerTeamId: T }
  //  - member, no team, exactly 1 eligible team -> { ownerTeamId: that team }
  //  - member, no team, >1 eligible    -> BAD_REQUEST OWNER_TEAM_REQUIRED
  //  - otherwise                        -> FORBIDDEN
  authorizeCreate: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        userId: z.string(),
        userType: z.enum(["user", "application"]),
        objectType: z.string(),
        requestedTeamId: z.string().optional(),
        hasGlobalManage: z.boolean(),
        // When the caller was already authorized to create by another gate
        // (e.g. manage on a parent object), skip the per-type creator
        // requirement and only resolve the owning team.
        alreadyAuthorized: z.boolean().optional(),
      }),
    )
    .output(
      z.object({
        ownerTeamId: z.string().nullable(),
        // Whether the new object should default to private. True when a team
        // member (without global manage) creates for their team; false for
        // admin/global creates (which stay globally readable).
        isPrivate: z.boolean(),
      }),
    ),

  // Does the caller hold a type-level `creator` capability on `objectType` for
  // any of their teams? Strictly the `creator` grant - an instance editor/owner
  // grant does NOT count. Backs the `create.alsoAcceptCreatorOf` sibling gate so
  // a caller who may create type A is authorized to create type B.
  hasCreateCapability: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        userId: z.string(),
        userType: z.enum(["user", "application"]),
        objectType: z.string(),
      }),
    )
    .output(z.object({ hasCapability: z.boolean() })),

  // Record ownership of a freshly-created object: the team gets the `owner`
  // relation and, unless isPrivate, the `public` viewer marker. Called by create
  // handlers after the object row is persisted.
  setOwner: proc({
    operationType: "mutation",
    userType: "service",
    access: [],
  })
    .input(
      z.object({
        objectType: z.string(),
        objectId: z.string(),
        teamId: z.string(),
        isPrivate: z.boolean().optional(),
      }),
    )
    .output(z.void()),

  getOwnStrategyConfig: proc({
    operationType: "query",
    userType: "service",
    access: [],
  }).output(z.object({ config: z.record(z.string(), z.unknown()) })),
};

// Export contract type
export type AuthContract = typeof authContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(AuthApi);
export const AuthApi = createClientDefinition(authContract, pluginMetadata);
