import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { incidentAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  IncidentWithSystemsSchema,
  IncidentDetailSchema,
  IncidentUpdateSchema,
  CreateIncidentInputSchema,
  UpdateIncidentInputSchema,
  AddIncidentUpdateInputSchema,
  IncidentStatusEnum,
} from "./schemas";

export const incidentContract = {
  /** List all incidents with optional filters */
  listIncidents: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
  })
    .input(
      z
        .object({
          status: IncidentStatusEnum.optional(),
          systemId: z.string().optional(),
          includeResolved: z.boolean().optional().default(false),
        })
        .optional(),
    )
    .output(z.object({ incidents: z.array(IncidentWithSystemsSchema) })),

  /** Get a single incident with all details */
  getIncident: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
  })
    .input(z.object({ id: z.string() }))
    .output(IncidentDetailSchema.nullable()),

  /** Get active incidents for a specific system */
  getIncidentsForSystem: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.array(IncidentWithSystemsSchema)),

  /** Get active incidents for multiple systems in a single request.
   * Used for efficient dashboard rendering to avoid N+1 queries.
   */
  getBulkIncidentsForSystems: proc({
    operationType: "query",
    userType: "public",
    access: [incidentAccess.incident.read],
    instanceAccess: { recordKey: "incidents" },
  })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        incidents: z.record(z.string(), z.array(IncidentWithSystemsSchema)),
      }),
    ),

  /** Create a new incident */
  createIncident: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
  })
    .input(CreateIncidentInputSchema)
    .output(IncidentWithSystemsSchema),

  /** Update an existing incident */
  updateIncident: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
  })
    .input(UpdateIncidentInputSchema)
    .output(IncidentWithSystemsSchema),

  /** Add a status update to an incident */
  addUpdate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
  })
    .input(AddIncidentUpdateInputSchema)
    .output(IncidentUpdateSchema),

  /** Resolve an incident (sets status to resolved) */
  resolveIncident: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
  })
    .input(z.object({ id: z.string(), message: z.string().optional() }))
    .output(IncidentWithSystemsSchema),

  /** Delete an incident */
  deleteIncident: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [incidentAccess.incident.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /**
   * Check if a system has an active incident with notification suppression enabled.
   * Used by the health check system to suppress notifications during acknowledged incidents.
   */
  hasActiveIncidentWithSuppression: proc({
    operationType: "query",
    userType: "service",
    access: [incidentAccess.incident.read],
  })
    .input(z.object({ systemId: z.string() }))
    .output(z.object({ suppressed: z.boolean() })),
};

// Export contract type
export type IncidentContract = typeof incidentContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(IncidentApi);
export const IncidentApi = createClientDefinition(
  incidentContract,
  pluginMetadata,
);
