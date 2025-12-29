import { oc } from "@orpc/contract";
import { z } from "zod";
import { SystemSchema, GroupSchema, ViewSchema, IncidentSchema } from "./types";

// Input schemas that match the service layer expectations
const CreateSystemInputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  owner: z.string().optional(),
  status: z.enum(["healthy", "degraded", "unhealthy"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdateSystemInputSchema = z.object({
  id: z.string(),
  data: z.object({
    name: z.string().optional(),
    description: z.string().nullable().optional(), // Allow nullable for updates
    owner: z.string().nullable().optional(),
    status: z.string().optional(),
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

const CreateIncidentInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
  severity: z.string().optional(),
  systemId: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
});

// Catalog RPC Contract using oRPC's contract-first pattern
export const catalogContract = {
  // Entity management
  getEntities: oc.output(
    z.object({
      systems: z.array(SystemSchema),
      groups: z.array(GroupSchema),
    })
  ),

  // Convenience methods
  getSystems: oc.output(z.array(SystemSchema)),
  getGroups: oc.output(z.array(GroupSchema)),

  // System management
  createSystem: oc.input(CreateSystemInputSchema).output(SystemSchema),

  updateSystem: oc.input(UpdateSystemInputSchema).output(SystemSchema),

  deleteSystem: oc.input(z.string()).output(z.object({ success: z.boolean() })),

  // Group management
  createGroup: oc.input(CreateGroupInputSchema).output(GroupSchema),

  updateGroup: oc.input(UpdateGroupInputSchema).output(GroupSchema),

  deleteGroup: oc.input(z.string()).output(z.object({ success: z.boolean() })),

  // System-Group relationships
  addSystemToGroup: oc
    .input(
      z.object({
        groupId: z.string(),
        systemId: z.string(),
      })
    )
    .output(z.object({ success: z.boolean() })),

  removeSystemFromGroup: oc
    .input(
      z.object({
        groupId: z.string(),
        systemId: z.string(),
      })
    )
    .output(z.object({ success: z.boolean() })),

  // View management
  getViews: oc.output(z.array(ViewSchema)),
  createView: oc.input(CreateViewInputSchema).output(ViewSchema),

  // Incident management
  getIncidents: oc.output(z.array(IncidentSchema)),
  createIncident: oc.input(CreateIncidentInputSchema).output(IncidentSchema),
};

// Export contract type for frontend
export type CatalogContract = typeof catalogContract;
