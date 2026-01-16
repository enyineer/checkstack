import { createClientDefinition, proc } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";
import { z } from "zod";
import { SystemSchema, GroupSchema, ViewSchema } from "./types";
import { catalogAccess } from "./access";

// Input schemas that match the service layer expectations
const CreateSystemInputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  owner: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateSystemInputSchema = z.object({
  id: z.string(),
  data: z.object({
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    owner: z.string().nullable().optional(),
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
    })
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
  })
    .input(z.object({ systemId: z.string() }))
    .output(SystemSchema.nullable()),

  getGroups: proc({
    operationType: "query",
    userType: "public",
    access: [catalogAccess.group.read],
  }).output(z.array(GroupSchema)),

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
    .input(UpdateSystemInputSchema)
    .output(SystemSchema),

  deleteSystem: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
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
    .input(UpdateGroupInputSchema)
    .output(GroupSchema),

  deleteGroup: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.group.manage],
  })
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
      })
    )
    .output(z.object({ success: z.boolean() })),

  removeSystemFromGroup: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [catalogAccess.system.manage],
  })
    .input(
      z.object({
        groupId: z.string(),
        systemId: z.string(),
      })
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
   * Notify all users subscribed to a system (and optionally its groups).
   * This is used by other plugins (e.g., maintenance) to send notifications
   * to system subscribers without needing direct access to the notification service.
   *
   * Deduplication: If includeGroupSubscribers is true, subscribers are
   * deduplicated so users subscribed to both the system AND its groups
   * receive only one notification.
   */
  notifySystemSubscribers: proc({
    operationType: "mutation",
    userType: "service",
    access: [], // Service-to-service, no access rules needed
  })
    .input(
      z.object({
        systemId: z
          .string()
          .describe("The system ID to notify subscribers for"),
        title: z.string().describe("Notification title"),
        body: z.string().describe("Notification body (supports markdown)"),
        importance: z.enum(["info", "warning", "critical"]).optional(),
        action: z
          .object({
            label: z.string(),
            url: z.string(),
          })
          .optional(),
        includeGroupSubscribers: z
          .boolean()
          .optional()
          .describe(
            "If true, also notify subscribers of groups that contain this system"
          ),
      })
    )
    .output(z.object({ notifiedCount: z.number() })),
};

// Export contract type
export type CatalogContract = typeof catalogContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(CatalogApi);
export const CatalogApi = createClientDefinition(
  catalogContract,
  pluginMetadata
);
