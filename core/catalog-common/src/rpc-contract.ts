import { oc } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import type { ProcedureMetadata } from "@checkmate/common";
import { z } from "zod";
import { SystemSchema, GroupSchema, ViewSchema } from "./types";
import { permissions } from "./permissions";

// Base builder with full metadata support
const _base = oc.$meta<ProcedureMetadata>({});

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
    description: z.string().nullable().optional(), // Allow nullable for updates
    owner: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(), // Allow nullable
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
    metadata: z.record(z.string(), z.unknown()).nullable().optional(), // Allow nullable
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
  // ENTITY READ ENDPOINTS (userType: "public" - accessible by anyone with permission)
  // ==========================================================================

  getEntities: _base
    .meta({ userType: "public", permissions: [permissions.catalogRead.id] })
    .output(
      z.object({
        systems: z.array(SystemSchema),
        groups: z.array(GroupSchema),
      })
    ),

  getSystems: _base
    .meta({ userType: "public", permissions: [permissions.catalogRead.id] })
    .output(z.array(SystemSchema)),

  getGroups: _base
    .meta({ userType: "public", permissions: [permissions.catalogRead.id] })
    .output(z.array(GroupSchema)),

  // ==========================================================================
  // SYSTEM MANAGEMENT (userType: "user" with manage permission)
  // ==========================================================================

  createSystem: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
    .input(CreateSystemInputSchema)
    .output(SystemSchema),

  updateSystem: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
    .input(UpdateSystemInputSchema)
    .output(SystemSchema),

  deleteSystem: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
    .input(z.string())
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // GROUP MANAGEMENT (userType: "user" with manage permission)
  // ==========================================================================

  createGroup: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
    .input(CreateGroupInputSchema)
    .output(GroupSchema),

  updateGroup: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
    .input(UpdateGroupInputSchema)
    .output(GroupSchema),

  deleteGroup: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
    .input(z.string())
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // SYSTEM-GROUP RELATIONSHIPS (userType: "user" with manage permission)
  // ==========================================================================

  addSystemToGroup: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
    .input(
      z.object({
        groupId: z.string(),
        systemId: z.string(),
      })
    )
    .output(z.object({ success: z.boolean() })),

  removeSystemFromGroup: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
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

  getViews: _base
    .meta({ userType: "user", permissions: [permissions.catalogRead.id] })
    .output(z.array(ViewSchema)),

  createView: _base
    .meta({ userType: "user", permissions: [permissions.catalogManage.id] })
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
  notifySystemSubscribers: _base
    .meta({ userType: "service" })
    .input(
      z.object({
        systemId: z
          .string()
          .describe("The system ID to notify subscribers for"),
        title: z.string().describe("Notification title"),
        description: z.string().describe("Notification description"),
        importance: z.enum(["info", "warning", "critical"]).optional(),
        actions: z
          .array(
            z.object({
              label: z.string(),
              href: z.string(),
              variant: z
                .enum(["primary", "secondary", "destructive"])
                .optional(),
            })
          )
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

// Export contract type for frontend
export type CatalogContract = typeof catalogContract;

// Export typed client for backend-to-backend communication
export type CatalogClient = ContractRouterClient<typeof catalogContract>;
