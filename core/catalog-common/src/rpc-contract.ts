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
} from "./types";
import { catalogAccess } from "./access";

// Input schemas that match the service layer expectations
const CreateSystemInputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateSystemInputSchema = z.object({
  id: z.string(),
  data: z.object({
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});

const CreateGroupInputSchema = z.object({
  name: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateGroupInputSchema = z.object({
  id: z.string(),
  data: z.object({
    name: z.string().optional(),
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

  getSystemContacts: proc({
    operationType: "query",
    userType: "public",
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
};

// Export contract type
export type CatalogContract = typeof catalogContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(CatalogApi);
export const CatalogApi = createClientDefinition(
  catalogContract,
  pluginMetadata,
);
