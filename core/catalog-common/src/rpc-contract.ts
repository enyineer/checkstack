import { createClientDefinition, proc } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";
import { z } from "zod";
import {
  SystemSchema,
  GroupSchema,
  ViewSchema,
  SystemContactSchema,
  ContactTypeSchema,
  SystemLinkSchema,
  EnvironmentSchema,
  CreateEnvironmentSchema,
  UpdateEnvironmentSchema,
} from "./types";
import { catalogAccess } from "./access";

// Shared catalog display-name validation. Bare `z.string()` previously let
// empty, whitespace-only, and unbounded (100KB+) names through to the DB - the
// huge ones surfaced as 500s (parameter binding blew up), the empty ones as
// confusing rows. Trim first so " " collapses to "" and fails `.min(1)`; cap at
// 200 chars (well inside the `systems.name` unique btree index limit).
const NameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(200, "Name must be at most 200 characters");

// Input schemas that match the service layer expectations
const CreateSystemInputSchema = z.object({
  name: NameSchema,
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateSystemInputSchema = z.object({
  id: z.string(),
  data: z.object({
    name: NameSchema.optional(),
    description: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});

const CreateGroupInputSchema = z.object({
  name: NameSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateGroupInputSchema = z.object({
  id: z.string(),
  data: z.object({
    name: NameSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});

const CreateViewInputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  configuration: z.unknown(),
});

// Catalog RPC Contract using oRPC's contract-first pattern
export const catalogContract = {
  // ==========================================================================
  // ENTITY READ ENDPOINTS (userType: "public" - accessible by anyone with access)
  // ==========================================================================

  getEntities: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.system.read],
  }).output(
    z.object({
      systems: z.array(SystemSchema),
      groups: z.array(GroupSchema),
    }),
  ),

  getSystems: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.system.read],
  }).output(z.object({ systems: z.array(SystemSchema) })),

  getSystem: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.system.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({ systemId: z.string() }))
    .output(SystemSchema.nullable()),

  getGroups: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.group.read],
  }).output(z.array(GroupSchema)),

  /**
   * Returns the catalog groups a system belongs to. Used by host plugins
   * (catalog) and emitting plugins (e.g. anomaly) to walk parent
   * subscriptions and surface inheritance hints. Server-side join — no
   * client-side filtering of `getGroups()` needed.
   */
  getSystemGroups: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.system.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(GroupSchema)),

  // ==========================================================================
  // SYSTEM MANAGEMENT (userType: "authenticated" with manage access)
  // ==========================================================================

  createSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
    .input(CreateSystemInputSchema)
    .output(SystemSchema),

  updateSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
    .route({ method: "PATCH" })
    .input(UpdateSystemInputSchema)
    .output(SystemSchema),

  deleteSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
    .route({ method: "DELETE" })
    .input(z.string())
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // SYSTEM CONTACTS MANAGEMENT
  // ==========================================================================

  // Gated to authenticated callers: contacts carry PII (userId, userName,
  // userEmail). A "public" read leaked those to anonymous status-page visitors.
  // The detail-page UI renders "No contacts assigned" when this returns empty,
  // so anonymous viewers degrade gracefully rather than erroring.
  getSystemContacts: proc({
    operationType: "query",
    userType: "authenticated",
    access: [catalogAccess.system.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(SystemContactSchema)),

  addSystemContact: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        type: ContactTypeSchema,
        userId: z.string().optional(),
        email: z.string().email().optional(),
        label: z.string().optional(),
      }),
    )
    .output(SystemContactSchema),

  removeSystemContact: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
    .route({ method: "DELETE" })
    .input(z.string())
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // SYSTEM LINKS MANAGEMENT
  // Free-form URLs (Jira boards, dashboards, runbooks) attached to a system.
  // ==========================================================================

  getSystemLinks: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.system.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(SystemLinkSchema)),

  addSystemLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        label: z.string().max(120).optional(),
        url: z.string().url("Must be a valid URL"),
      }),
    )
    .output(SystemLinkSchema),

  removeSystemLink: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
    .route({ method: "DELETE" })
    .input(z.string())
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // GROUP MANAGEMENT (userType: "authenticated" with manage access)
  // ==========================================================================

  createGroup: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.group.manage],
  })
    .input(CreateGroupInputSchema)
    .output(GroupSchema),

  updateGroup: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.group.manage],
  })
    .route({ method: "PATCH" })
    .input(UpdateGroupInputSchema)
    .output(GroupSchema),

  deleteGroup: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.group.manage],
  })
    .route({ method: "DELETE" })
    .input(z.string())
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // SYSTEM-GROUP RELATIONSHIPS (userType: "authenticated" with manage access)
  // ==========================================================================

  addSystemToGroup: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
    .input(
      z.object({
        groupId: z.string(),
        systemId: z.string(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  removeSystemFromGroup: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
    .route({ method: "DELETE" })
    .input(
      z.object({
        groupId: z.string(),
        systemId: z.string(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // ENVIRONMENT MANAGEMENT
  // Instance-wide catalog primitive: free-form custom fields, M:N with systems.
  // ==========================================================================

  listEnvironments: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.environment.read],
  }).output(z.array(EnvironmentSchema)),

  getEnvironment: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.environment.read],
  })
    .input(z.object({ environmentId: z.string() }))
    .output(EnvironmentSchema.nullable()),

  createEnvironment: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.environment.manage],
  })
    .input(CreateEnvironmentSchema)
    .output(EnvironmentSchema),

  updateEnvironment: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.environment.manage],
  })
    .route({ method: "PATCH" })
    .input(
      z.object({
        environmentId: z.string(),
        data: UpdateEnvironmentSchema,
      }),
    )
    .output(EnvironmentSchema),

  deleteEnvironment: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.environment.manage],
  })
    .route({ method: "DELETE" })
    .input(z.object({ environmentId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /**
   * Desired-set assignment of a system's environments. Diffs the supplied
   * set against current membership: adds missing links, prunes stale ones
   * (mirrors the GitOps System->environments reconcile).
   */
  setSystemEnvironments: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.environment.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        environmentIds: z.array(z.string()),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  /**
   * Returns the environments a system currently belongs to (with custom
   * fields). Used by host plugins to render the per-system environment
   * picker. Server-side join — no client-side filtering needed.
   */
  getSystemEnvironments: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.environment.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(EnvironmentSchema)),

  // ==========================================================================
  // VIEW MANAGEMENT (userType: "user")
  // ==========================================================================

  getViews: proc({
    operationType: "query",
    userType: "user",
    access: [catalogAccess.view.read],
  }).output(z.array(ViewSchema)),

  createView: proc({
    operationType: "mutation",
    userType: "user",
    access: [catalogAccess.view.manage],
  })
    .input(CreateViewInputSchema)
    .output(ViewSchema),

  // ==========================================================================
  // SERVICE INTERFACE (userType: "service" - backend-to-backend only)
  // ==========================================================================

  /**
   * Get the catalog group IDs that contain a specific system.
   * Returns raw group IDs (not namespaced with notification prefix).
   * Used by the dependency plugin for batched notification deduplication.
   */
  getSystemGroupIds: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ groupIds: z.array(z.string()) })),

  /**
   * Service-grade read of a system's current environments (id + name +
   * custom fields). Called by the healthcheck plugin at run time to resolve
   * the effective fan-out set. Backend-to-backend only.
   */
  resolveSystemEnvironments: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(EnvironmentSchema)),

  /**
   * Service-grade resolve of an explicit set of environment ids (the
   * explicit-subset fan-out case). Unknown ids are silently dropped.
   * Backend-to-backend only.
   */
  resolveEnvironments: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ environmentIds: z.array(z.string()) }))
    .output(z.array(EnvironmentSchema)),
};

// Export contract type
export type CatalogContract = typeof catalogContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(CatalogApi);
export const CatalogApi = createClientDefinition(
  catalogContract,
  pluginMetadata,
);
